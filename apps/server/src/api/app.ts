// The HTTP API: read endpoints and the live stream (SSE). No write endpoints. All input is
// checked with zod. The types of the answers are in packages/core/src/api.ts.

import {
  formatPosition,
  isBefore,
  LAT_ROWS,
  LNG_COLUMNS,
  parsePosition,
  type Address,
  type AuctionResponse,
  type AuctionRules,
  type BidderView,
  type Position,
  type StreamMessage,
  type ViewportSnapshot,
} from '@gaia/core';
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { getAddress, isAddress } from 'viem';
import { z } from 'zod';

import type { Hub } from '../live';
import { messageMatches, type Store } from '../store/store';

export interface AppOptions {
  store: Store;
  hub: Hub;
  rules: AuctionRules;
  /** What `withdraw` sends to the bidder now (read from the contract). */
  refundOf: (bidder: Address, cancelled: boolean) => Promise<bigint>;
  /** A snapshot with more bids gets HTTP 400 ("zoom in"). */
  maxSnapshotBids: number;
  /** The time between two stream heartbeats when no message comes, in milliseconds. */
  heartbeatMs?: number;
}

const integer = (max: number) =>
  z
    .string()
    .regex(/^\d{1,5}$/, 'must be a whole number')
    .transform(Number)
    .pipe(z.number().max(max));

const viewportQuery = z
  .object({
    south: integer(LAT_ROWS - 1),
    north: integer(LAT_ROWS - 1),
    west: integer(LNG_COLUMNS - 1),
    east: integer(LNG_COLUMNS - 1),
  })
  .refine((v) => v.south <= v.north, { message: 'south must not be above north', path: ['south'] });

const address = z
  .string()
  .refine((value) => isAddress(value, { strict: false }), 'must be a 20-byte hex address')
  .transform((value) => getAddress(value) as Address);

const position = z
  .string()
  .transform((value, ctx) => {
    const p = parsePosition(value);
    if (p === undefined) ctx.addIssue({ code: 'custom', message: 'must be <block>:<logIndex>' });
    return p as Position;
  });

const streamQuery = z.object({ after: position.optional(), bidder: address.optional() });

// Checks `input` with `schema`. Returns the value, or a 400 answer that names each wrong value.
const check = <T>(c: Context, schema: z.ZodType<T>, input: unknown): { value: T } | { answer: Response } => {
  const result = schema.safeParse(input);
  if (result.success) return { value: result.data };
  const problems = result.error.issues.map((i) => `${i.path.join('.') || '(input)'}: ${i.message}`);
  return { answer: c.json({ error: 'Invalid input', problems }, 400) };
};

export const createApp = (options: AppOptions) => {
  const { store, hub, rules, refundOf, maxSnapshotBids } = options;
  const heartbeatMs = options.heartbeatMs ?? 30_000;
  const app = new Hono();

  app.get('/health', async (c) => c.json({ position: await store.position(), cursor: await store.cursor() }));

  app.get('/auction', async (c) => {
    // Read the position first: a block applied between the two reads is then also in the status.
    const position = await store.position();
    const body: AuctionResponse = { position, rules, status: await store.status() };
    return c.json(body);
  });

  app.get('/bids', async (c) => {
    const input = check(c, viewportQuery, c.req.query());
    if ('answer' in input) return input.answer;
    const viewport = input.value;
    const { position, bids, complete } = await store.bidsInViewport(viewport, maxSnapshotBids);
    if (!complete) {
      return c.json({ error: `The viewport has more than ${maxSnapshotBids} bids. Zoom in.` }, 400);
    }
    const body: ViewportSnapshot = { position, viewport, status: await store.status(), bids };
    return c.json(body);
  });

  app.get('/bidder/:address', async (c) => {
    const input = check(c, address, c.req.param('address'));
    if ('answer' in input) return input.answer;
    const bidder = input.value;
    const view = await store.bidder(bidder);
    const { cancelled } = await store.status();
    const body: BidderView = { ...view, refund: (await refundOf(bidder, cancelled)).toString() };
    return c.json(body);
  });

  app.get('/stream', async (c) => {
    const input = check(c, streamQuery, c.req.query());
    if ('answer' in input) return input.answer;
    const query = input.value;
    // The browser sends Last-Event-ID when it reconnects. It is newer than `after` in the URL.
    const header = c.req.header('Last-Event-ID');
    const resumeFrom = header === undefined ? undefined : parsePosition(header);
    if (header !== undefined && resumeFrom === undefined) {
      return c.json({ error: 'Invalid input', problems: ['Last-Event-ID: must be <block>:<logIndex>'] }, 400);
    }
    const filter = { bidder: query.bidder };

    return streamSSE(c, async (stream) => {
      // Listen first, then read the store: a message is then in the store, in `pending`, or
      // in both (sent once, by position).
      const pending: StreamMessage[] = [];
      let wake: (() => void) | undefined;
      const unsubscribe = hub.subscribe((message) => {
        if (!messageMatches(message, filter)) return;
        pending.push(message);
        wake?.();
      });
      let closed = false;
      stream.onAbort(() => {
        closed = true;
        wake?.();
      });
      const send = (message: StreamMessage) =>
        stream.writeSSE({ id: formatPosition(message.position), event: message.type, data: JSON.stringify(message) });

      try {
        const now = await store.position();
        let last = resumeFrom ?? query.after ?? now;
        if (isBefore(now, last)) {
          // The client has data that the chain dropped.
          await send({ type: 'reorg', position: now });
          last = now;
        }
        for (const message of await store.messagesAfter(last, filter)) {
          await send(message);
          last = message.position;
        }
        while (!closed) {
          while (pending.length > 0) {
            const message = pending.shift() as StreamMessage;
            if (message.type !== 'reorg' && !isBefore(last, message.position)) continue;
            await send(message);
            last = message.position;
          }
          const timedOut = await new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => resolve(true), heartbeatMs);
            wake = () => {
              clearTimeout(timer);
              resolve(false);
            };
          });
          wake = undefined;
          if (timedOut && !closed) await stream.write(': heartbeat\n\n');
        }
      } finally {
        unsubscribe();
      }
    });
  });

  app.notFound((c) => c.json({ error: 'Not found' }, 404));
  app.onError((error, c) => {
    console.error(error);
    return c.json({ error: 'Server error' }, 500);
  });
  return app;
};
