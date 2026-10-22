// The HTTP API: read endpoints and the live stream (SSE). No write endpoints. All input is
// checked with zod. The types of the answers are in packages/core/src/api.ts.
import {
  type Address,
  type AuctionResponse,
  type AuctionRules,
  type BidderView,
  type EventId,
  LAT_ROWS,
  LNG_COLUMNS,
  type StreamMessage,
  type ViewportSnapshot,
  formatEventId,
  isBefore,
  parseEventId,
} from '@gaia/core';

import { type Context, Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { getAddress, isAddress } from 'viem';
import { z } from 'zod';

import type { LiveMessageBus } from '../live-message-bus';
import { type AuctionStore, matchesStreamMessageFilter } from '../store/auction-store';

export interface HttpApiOptions {
  store: AuctionStore;
  liveMessageBus: LiveMessageBus;
  rules: AuctionRules;
  /** What `withdraw` sends to the bidder now (read from the contract). */
  refundOf: (bidder: Address, cancelled: boolean) => Promise<bigint>;
  /** A snapshot with more bids gets HTTP 400 ("zoom in"). */
  maxSnapshotBids: number;
  /** The time between two stream heartbeats when no message comes, in milliseconds. */
  heartbeatMs?: number;
}

const gridIndexParam = (max: number) =>
  z
    .string()
    .regex(/^\d{1,5}$/, 'must be a whole number')
    .transform(Number)
    .pipe(z.number().max(max));

const viewportQuery = z
  .object({
    south: gridIndexParam(LAT_ROWS - 1),
    north: gridIndexParam(LAT_ROWS - 1),
    west: gridIndexParam(LNG_COLUMNS - 1),
    east: gridIndexParam(LNG_COLUMNS - 1),
  })
  .refine(v => v.south <= v.north, { message: 'south must not be above north', path: ['south'] });

const addressParam = z
  .string()
  .refine(value => isAddress(value, { strict: false }), 'must be a 20-byte hex address')
  .transform(value => getAddress(value) as Address);

const eventIdParam = z.string().transform((value, ctx) => {
  const id = parseEventId(value);
  if (id === undefined) {
    ctx.addIssue({ code: 'custom', message: 'must be <block>:<logIndex>' });
  }
  return id as EventId;
});

const streamQuery = z.object({ after: eventIdParam.optional(), bidder: addressParam.optional() });

// Checks `input` with `schema`. Returns the value, or a 400 answer that names each wrong value.
const parseInputOr400 = <T>(c: Context, schema: z.ZodType<T>, input: unknown): { value: T } | { answer: Response } => {
  const result = schema.safeParse(input);
  if (result.success) {
    return { value: result.data };
  }
  const problems = result.error.issues.map(i => `${i.path.join('.') || '(input)'}: ${i.message}`);
  return { answer: c.json({ error: 'Invalid input', problems }, 400) };
};

export const createHttpApi = (options: HttpApiOptions) => {
  const { store, liveMessageBus, rules, refundOf, maxSnapshotBids } = options;
  const heartbeatMs = options.heartbeatMs ?? 30_000;
  const app = new Hono();

  app.get('/health', async c => c.json({ lastEventId: await store.lastEventId(), lastBlock: await store.lastBlock() }));

  app.get('/auction', async c => {
    // Read the event ID first: a block applied between the two reads is then also in the status.
    const lastEventId = await store.lastEventId();
    const body: AuctionResponse = { lastEventId, rules, status: await store.status() };
    return c.json(body);
  });

  app.get('/bids', async c => {
    const input = parseInputOr400(c, viewportQuery, c.req.query());
    if ('answer' in input) {
      return input.answer;
    }
    const viewport = input.value;
    const { lastEventId, bids, complete } = await store.bidsInViewport(viewport, maxSnapshotBids);
    if (!complete) {
      return c.json({ error: `The viewport has more than ${maxSnapshotBids} bids. Zoom in.` }, 400);
    }
    const body: ViewportSnapshot = { lastEventId, viewport, status: await store.status(), bids };
    return c.json(body);
  });

  app.get('/bidder/:address', async c => {
    const input = parseInputOr400(c, addressParam, c.req.param('address'));
    if ('answer' in input) {
      return input.answer;
    }
    const bidder = input.value;
    const view = await store.bidder(bidder);
    const { cancelled } = await store.status();
    const body: BidderView = { ...view, refund: (await refundOf(bidder, cancelled)).toString() };
    return c.json(body);
  });

  app.get('/stream', c => {
    const input = parseInputOr400(c, streamQuery, c.req.query());
    if ('answer' in input) {
      return input.answer;
    }
    const query = input.value;
    // The browser sends Last-Event-ID when it reconnects. It is newer than `after` in the URL.
    const header = c.req.header('Last-Event-ID');
    const resumeFrom = header === undefined ? undefined : parseEventId(header);
    if (header !== undefined && resumeFrom === undefined) {
      return c.json({ error: 'Invalid input', problems: ['Last-Event-ID: must be <block>:<logIndex>'] }, 400);
    }
    const filter = { bidder: query.bidder };

    return streamSSE(c, async stream => {
      // Listen first, then read the store: a message is then in the store, in `pending`, or
      // in both (sent once, by event ID).
      const pending: StreamMessage[] = [];
      let wake: (() => void) | undefined;
      const unsubscribe = liveMessageBus.subscribe(message => {
        if (!matchesStreamMessageFilter(message, filter)) {
          return;
        }
        pending.push(message);
        wake?.();
      });
      let closed = false;
      stream.onAbort(() => {
        closed = true;
        wake?.();
      });
      // The ID of the last event that the client has. A reorg message has no event of its own:
      // its SSE id is the last event that the server still has.
      let last: EventId | undefined = resumeFrom ?? query.after;
      const send = async (message: StreamMessage) => {
        last = message.type === 'reorg' ? message.lastEventId : message.id;
        await stream.writeSSE({
          id: last === undefined ? undefined : formatEventId(last),
          event: message.type,
          data: JSON.stringify(message),
        });
      };

      try {
        const serverLast = await store.lastEventId();
        if (last !== undefined && (serverLast === undefined || isBefore(serverLast, last))) {
          // The client has events that the chain dropped.
          await send({ type: 'reorg', lastEventId: serverLast });
        }
        for (const message of await store.messagesAfter(last, filter)) {
          await send(message);
        }
        while (!closed) {
          while (pending.length > 0) {
            const message = pending.shift() as StreamMessage;
            const isNew = message.type === 'reorg' || last === undefined || isBefore(last, message.id);
            if (isNew) {
              await send(message);
            }
          }
          const timedOut = await new Promise<boolean>(resolve => {
            const timer = setTimeout(() => resolve(true), heartbeatMs);
            wake = () => {
              clearTimeout(timer);
              resolve(false);
            };
          });
          wake = undefined;
          if (timedOut && !closed) {
            await stream.write(': heartbeat\n\n');
          }
        }
      } finally {
        unsubscribe();
      }
    });
  });

  app.notFound(c => c.json({ error: 'Not found' }, 404));
  app.onError((error, c) => {
    console.error(error);
    return c.json({ error: 'Server error' }, 500);
  });
  return app;
};
