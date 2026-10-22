// The event loop. Each step:
// 1. Compares the hash of the last applied block with the chain. When they differ (reorg), it finds the
//    newest applied block that the chain still has, undoes the blocks after it, and sends a reorg
//    message. When no block of the undo window matches, it clears the store (a new backfill).
// 2. Gets the auction events from the block after the last applied block to the chain head, in ranges of
//    `logRange` blocks (the backfill is the same loop from the deploy block).
// 3. Applies each block with events in (block, log index) order: reducer, then one
//    `applyBlock`, then the live messages. Then it applies the head block (with no events), so
//    that the last applied block follows the head.
//
// The steps never run at the same time: `syncOnce` waits for the step before it.
//
// More contracts (land, sale, market: milestone 2) add their events to `fetchEvents` and their
// rules to the reducer; the loop stays the same.
import type { Address } from '@gaia/core';

import type { PublicClient } from 'viem';

import { type AuctionEventLog, fetchAuctionEvents, readBlockHash } from '../auction-rpc';
import type { LiveMessageBus } from '../live-message-bus';
import { type AuctionStore, UndoWindowExceededError } from '../store/auction-store';
import type { AuctionEvent } from './auction-events';
import { reduceAuctionBlock } from './auction-reducer';

export interface AuctionIndexerOptions {
  client: PublicClient;
  store: AuctionStore;
  liveMessageBus: LiveMessageBus;
  auction: Address;
  deployBlock: number;
  logRange: number;
  pollIntervalMs: number;
  log?: (message: string) => void;
}

export class AuctionIndexer {
  private readonly o: AuctionIndexerOptions;
  private queue: Promise<void> = Promise.resolve();
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(options: AuctionIndexerOptions) {
    this.o = options;
  }

  /** Runs one step of the loop, after the step that runs now (if any). */
  syncOnce(): Promise<void> {
    const step = this.queue.then(() => this.syncToHead());
    this.queue = step.catch(() => undefined);
    return step;
  }

  /** Polls the chain every `pollIntervalMs`. An error is logged; the next poll tries again. */
  start() {
    if (this.running) {
      return;
    }
    this.running = true;
    const tick = async () => {
      try {
        await this.syncOnce();
      } catch (error) {
        this.log(`AuctionIndexer step failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (this.running) {
        this.timer = setTimeout(() => void tick(), this.o.pollIntervalMs);
      }
    };
    void tick();
  }

  /** Stops the polls and waits for the step that runs now. */
  async stop() {
    this.running = false;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
    }
    await this.queue;
  }

  private log(message: string) {
    (this.o.log ?? console.log)(message);
  }

  private async syncToHead() {
    const { client, store } = this.o;
    if (await this.undoReorgedBlocks()) {
      return;
    }

    const head = Number(await client.getBlockNumber());
    const lastBlock = await store.lastBlock();
    let from = lastBlock === undefined ? this.o.deployBlock : lastBlock.number + 1;
    if (from > head) {
      return;
    }

    while (from <= head) {
      const to = Math.min(from + this.o.logRange - 1, head);
      const events = await fetchAuctionEvents(client, this.o.auction, from, to);
      for (const group of groupEventLogsByBlock(events)) {
        await this.apply(group);
      }
      from = to + 1;
    }

    // Apply the head block, so that the next step checks the head hash.
    const last = await store.lastBlock();
    if (last === undefined || last.number < head) {
      const block = await client.getBlock({ blockNumber: BigInt(head) });
      if (block.hash === null) {
        return;
      }
      await this.applyBlock(head, block.hash, Number(block.timestamp), []);
    }
  }

  private async apply(group: AuctionEventLog[]) {
    const { blockNumber, blockHash } = group[0];
    let timestamp = group[0].blockTimestamp;
    if (timestamp === undefined) {
      timestamp = Number((await this.o.client.getBlock({ blockHash })).timestamp);
    }
    await this.applyBlock(
      blockNumber,
      blockHash,
      timestamp,
      group.map(e => e.event),
    );
  }

  private async applyBlock(number: number, hash: `0x${string}`, timestamp: number, events: AuctionEvent[]) {
    const changes = await reduceAuctionBlock(this.o.store, { block: { number, hash }, timestamp, events });
    await this.o.store.applyBlock(changes);
    this.o.liveMessageBus.publish(changes.messages);
  }

  // True when the chain no longer has the last applied block. Then undoes the dropped blocks.
  private async undoReorgedBlocks(): Promise<boolean> {
    const { client, store, liveMessageBus } = this.o;
    const lastBlock = await store.lastBlock();
    if (lastBlock === undefined) {
      return false;
    }
    if ((await readBlockHash(client, lastBlock.number)) === lastBlock.hash) {
      return false;
    }

    for (const block of await store.recentBlocks()) {
      if ((await readBlockHash(client, block.number)) !== block.hash) {
        continue;
      }
      try {
        await store.undoAfter(block.number);
        this.log(`Reorg: undid the blocks after ${block.number}.`);
      } catch (error) {
        if (!(error instanceof UndoWindowExceededError)) {
          throw error;
        }
        await store.reset();
        this.log('Reorg deeper than the undo window: cleared the store, backfill again.');
      }
      liveMessageBus.publish([{ type: 'reorg', lastEventId: await store.lastEventId() }]);
      return true;
    }
    await store.reset();
    this.log('Reorg deeper than the undo window: cleared the store, backfill again.');
    liveMessageBus.publish([{ type: 'reorg', lastEventId: await store.lastEventId() }]);
    return true;
  }
}

const groupEventLogsByBlock = (events: AuctionEventLog[]): AuctionEventLog[][] => {
  const groups: AuctionEventLog[][] = [];
  for (const event of events) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last[0].blockNumber === event.blockNumber) {
      last.push(event);
    } else {
      groups.push([event]);
    }
  }
  return groups;
};
