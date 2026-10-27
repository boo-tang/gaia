// The shapes of one bidder for "Your bids", from `GET /bidder/:address` (pure).
import type { BidderView, ShapeBidMessage } from '@gaia/core';

import { isAddressEqual } from 'viem';

/** One shape of the bidder and what it holds now. */
export interface ShapeSummary {
  shapeId: number;
  /** Unix seconds, from the block of the bid. */
  timestamp: number;
  bidSquareIds: readonly number[];
  bidCount: number;
  heldCount: number;
  /** Wei: the sum of the amounts of the held squares. Undefined when the shape has no `shapeBid` message. */
  heldAmount?: bigint;
  /** Wei: what the bid spent. Undefined when the shape has no `shapeBid` message. */
  paid?: bigint;
}

export interface ShapeTotals {
  /** The shapes that still hold squares. */
  winningShapes: number;
  heldSquares: number;
  /** Wei: the sum of the amounts of all held squares. */
  heldAmount: bigint;
  /** False when a shape that holds squares has no `shapeBid` message: then `heldAmount` is not complete. */
  amountKnown: boolean;
}

/**
 * The shapes of the bidder, newest first, and the totals of the held squares. The amount of a held
 * square is its amount in the `shapeBid` message of its shape: when a later bid changes the amount
 * of a square, the server moves the square to the new shape.
 */
export const summarizeShapes = (view: BidderView): { shapes: ShapeSummary[]; totals: ShapeTotals } => {
  // `history` also has the bids of other bidders that took squares of this bidder.
  const messages = new Map<number, ShapeBidMessage>();
  for (const message of view.history) {
    if (message.type === 'shapeBid' && isAddressEqual(message.bidder, view.bidder)) {
      messages.set(message.shapeId, message);
    }
  }

  const totals: ShapeTotals = { winningShapes: 0, heldSquares: 0, heldAmount: 0n, amountKnown: true };
  const shapes = view.shapes.map((shape): ShapeSummary => {
    const message = messages.get(shape.shapeId);
    let heldAmount: bigint | undefined;
    if (message !== undefined) {
      const amounts = new Map(message.squareIds.map((id, i) => [id, BigInt(message.amounts[i])]));
      heldAmount = shape.heldSquareIds.reduce((sum, id) => sum + (amounts.get(id) ?? 0n), 0n);
    }
    const heldCount = shape.heldSquareIds.length;
    if (heldCount > 0) {
      totals.winningShapes += 1;
      totals.heldSquares += heldCount;
      if (heldAmount === undefined) {
        totals.amountKnown = false;
      } else {
        totals.heldAmount += heldAmount;
      }
    }
    return {
      shapeId: shape.shapeId,
      timestamp: shape.timestamp,
      bidSquareIds: shape.bidSquareIds,
      bidCount: shape.bidSquareIds.length,
      heldCount,
      heldAmount,
      paid: message === undefined ? undefined : BigInt(message.paid),
    };
  });
  shapes.sort((a, b) => b.shapeId - a.shapeId);
  return { shapes, totals };
};
