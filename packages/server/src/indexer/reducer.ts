// The auction rules of the indexer: from the decoded events of one block to the changes that the
// store saves. This is the only place with these rules; each store only saves the result.
//
// The rules (GaiaAuction.sol, and the test "rebuilds every shape and current bid from ShapeBid
// events only" in test/Gaia_Auction.ts):
// - `ShapeBid` makes a new shape. Each square of the event goes to the new shape with its amount
//   from the event. A square belongs to the newest shape that contains it, so each older shape
//   that held one of these squares loses it. This also applies to a re-bid on own squares.
// - `AuctionExtended` sets `endTime`. `AuctionPaused`, `AuctionUnpaused` and `AuctionCancelled`
//   set the flags.
// - `ShapeSquaresSettled` adds a settlement chunk; `ShapeSettled` marks the settlement as done.

import type { AuctionStatus, EventId, Settlement, StreamMessage, TakenSquares } from '@gaia/core';

import type { AuctionStore, BlockChanges, BlockRef, StoredShape, StoredSquare } from '../store/auction-store';
import type { AuctionEvent } from './events';

export type StoreReader = Pick<AuctionStore, 'squares' | 'shapes' | 'status'>;

/** A block and its auction events, in log order. */
export interface BlockEvents {
  block: BlockRef;
  /** Unix seconds. */
  timestamp: number;
  events: AuctionEvent[];
}

/**
 * A shape or country ID as a number. The contracts count these IDs up from 1, so they stay far
 * below 2^53; a larger value means a wrong event.
 */
const toId = (value: bigint, name: string) => {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${name} ${value} is too large.`);
  return Number(value);
};

/** Applies the events of one block to the state that `read` gives, and returns the changes. */
export const reduceBlock = async (read: StoreReader, { block, timestamp, events }: BlockEvents): Promise<BlockChanges> => {
  // The values that this block changed. A later event of the same block reads them here first.
  const squares = new Map<number, StoredSquare>();
  const shapes = new Map<number, StoredShape>();
  let status: AuctionStatus | undefined;
  const messages: StreamMessage[] = [];

  // Read the current owners of all squares of the block at once.
  const bidSquareIds = events.flatMap((e) => (e.eventName === 'ShapeBid' ? e.args.squares : []));
  const owners = new Map((await read.squares(bidSquareIds)).map((s) => [s.squareId, s]));

  const getShape = async (shapeId: number): Promise<StoredShape> => {
    const changed = shapes.get(shapeId);
    if (changed !== undefined) return changed;
    const [stored] = await read.shapes([shapeId]);
    if (stored === undefined) throw new Error(`Shape ${shapeId} is not in the store.`);
    return stored;
  };
  const getStatus = async () => status ?? (await read.status());

  let lastLogIndex = -1;
  for (const event of events) {
    if (event.logIndex <= lastLogIndex) throw new Error(`The events of block ${block.number} are not in log order.`);
    lastLogIndex = event.logIndex;
    const id: EventId = { block: block.number, logIndex: event.logIndex };

    if (event.eventName === 'ShapeBid') {
      const { bidder, squares: squareIds, amounts, paid } = event.args;
      const shapeId = toId(event.args.shapeId, 'Shape ID');
      if (squareIds.length !== amounts.length) throw new Error(`ShapeBid ${shapeId}: squares and amounts differ in length.`);

      // The squares that each older shape loses, in bid order.
      const taken = new Map<number, number[]>();
      squareIds.forEach((squareId, i) => {
        const old = squares.get(squareId) ?? owners.get(squareId);
        if (old !== undefined) taken.set(old.shapeId, [...(taken.get(old.shapeId) ?? []), squareId]);
        squares.set(squareId, { squareId, shapeId, amount: amounts[i] });
      });

      const takenSquares: TakenSquares[] = [];
      for (const [oldId, lost] of taken) {
        const old = await getShape(oldId);
        shapes.set(oldId, { ...old, heldSquareCount: old.heldSquareCount - lost.length });
        takenSquares.push({ shapeId: oldId, bidder: old.bidder, squareIds: lost });
      }
      shapes.set(shapeId, {
        shapeId,
        bidder,
        block: block.number,
        timestamp,
        bidSquareIds: [...squareIds],
        heldSquareCount: squareIds.length,
        settlement: undefined,
      });
      messages.push({
        type: 'shapeBid',
        id,
        timestamp,
        shapeId,
        bidder,
        squareIds: [...squareIds],
        amounts: amounts.map((a) => a.toString()),
        paid: paid.toString(),
        taken: takenSquares,
      });
    } else if (event.eventName === 'ShapeSquaresSettled' || event.eventName === 'ShapeSettled') {
      const shape = await getShape(toId(event.args.shapeId, 'Shape ID'));
      const countryId = toId(event.args.countryId, 'Country ID');
      const settlement: Settlement =
        event.eventName === 'ShapeSquaresSettled'
          ? {
              countryId,
              settledSquareCount: (shape.settlement?.settledSquareCount ?? 0) + Number(event.args.count),
              done: false,
            }
          : { countryId, settledSquareCount: Number(event.args.totalSquares), done: true };
      shapes.set(shape.shapeId, { ...shape, settlement });
      messages.push({ type: 'settlement', id, timestamp, shapeId: shape.shapeId, bidder: shape.bidder, settlement });
    } else {
      const current = await getStatus();
      if (event.eventName === 'AuctionExtended') {
        status = { ...current, endTime: Number(event.args.endTime) };
      } else if (event.eventName === 'AuctionPaused') {
        status = { ...current, paused: true };
      } else if (event.eventName === 'AuctionUnpaused') {
        status = { ...current, paused: false };
      } else {
        status = { ...current, cancelled: true };
      }
      messages.push({ type: 'auctionStatus', id, timestamp, status });
    }
  }

  return { block, squares: [...squares.values()], shapes: [...shapes.values()], status, messages };
};
