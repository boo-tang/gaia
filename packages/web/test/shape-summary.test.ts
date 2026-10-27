import type { Address, BidderView, ShapeBidMessage } from '@gaia/core';

import { describe, expect, it } from 'vitest';

import { summarizeShapes } from '../src/bidder/shape-summary';

const ME = '0x00000000000000000000000000000000000000aa' as Address;
const OTHER = '0x00000000000000000000000000000000000000bb' as Address;

const bid = (
  shapeId: number,
  bidder: Address,
  squareIds: number[],
  amounts: number[],
  paid: number,
): ShapeBidMessage => ({
  type: 'shapeBid',
  id: { block: shapeId, logIndex: 0 },
  timestamp: 1_000 + shapeId,
  shapeId,
  bidder,
  squareIds,
  amounts: amounts.map(String),
  paid: String(paid),
  taken: [],
});

const shape = (shapeId: number, bidSquareIds: number[], heldSquareIds: number[]) => ({
  shapeId,
  bidder: ME,
  block: shapeId,
  timestamp: 1_000 + shapeId,
  bidSquareIds,
  heldSquareIds,
});

const view = (shapes: BidderView['shapes'], history: BidderView['history']): BidderView => ({
  bidder: ME,
  shapes,
  refund: '0',
  history,
});

describe('summarizeShapes', () => {
  it('lists the shapes newest first with the amounts of the held squares', () => {
    const { shapes, totals } = summarizeShapes(
      view(
        [shape(1, [10, 11, 12], [10, 12]), shape(4, [20, 21], [20, 21])],
        [bid(1, ME, [10, 11, 12], [5, 6, 7], 18), bid(4, ME, [20, 21], [3, 3], 6)],
      ),
    );
    expect(shapes.map(s => s.shapeId)).toEqual([4, 1]);
    expect(shapes[1]).toEqual({
      shapeId: 1,
      timestamp: 1_001,
      bidSquareIds: [10, 11, 12],
      bidCount: 3,
      heldCount: 2,
      heldAmount: 12n,
      paid: 18n,
    });
    expect(totals).toEqual({ winningShapes: 2, heldSquares: 4, heldAmount: 18n, amountKnown: true });
  });

  it('counts a shape that lost all its squares only in the list', () => {
    const { shapes, totals } = summarizeShapes(view([shape(2, [10, 11], [])], [bid(2, ME, [10, 11], [5, 5], 10)]));
    expect(shapes[0]).toMatchObject({ heldCount: 0, heldAmount: 0n, paid: 10n });
    expect(totals).toEqual({ winningShapes: 0, heldSquares: 0, heldAmount: 0n, amountKnown: true });
  });

  it('uses only the messages of the bidder', () => {
    // Shape 3 of a different bidder took square 11: its message is in the history too.
    const { shapes } = summarizeShapes(
      view([shape(1, [10, 11], [10])], [bid(1, ME, [10, 11], [5, 5], 10), bid(1, OTHER, [11], [9], 9)]),
    );
    expect(shapes[0]).toMatchObject({ heldAmount: 5n, paid: 10n });
  });

  it('takes the amount of a re-bid square from the newer shape', () => {
    // Shape 5 raised square 11 of shape 1, so the server moved it to shape 5.
    const { shapes, totals } = summarizeShapes(
      view(
        [shape(1, [10, 11], [10]), shape(5, [11], [11])],
        [bid(1, ME, [10, 11], [5, 5], 10), bid(5, ME, [11], [8], 3)],
      ),
    );
    expect(shapes.map(s => s.heldAmount)).toEqual([8n, 5n]);
    expect(totals.heldAmount).toBe(13n);
  });

  it('marks a shape with no message as not known, and leaves its amount out of the total', () => {
    const { shapes, totals } = summarizeShapes(
      view([shape(1, [10], [10]), shape(2, [20], [20])], [bid(2, ME, [20], [4], 4)]),
    );
    expect(shapes[1]).toMatchObject({ shapeId: 1, heldCount: 1, heldAmount: undefined, paid: undefined });
    expect(totals).toEqual({ winningShapes: 2, heldSquares: 2, heldAmount: 4n, amountKnown: false });
  });
});
