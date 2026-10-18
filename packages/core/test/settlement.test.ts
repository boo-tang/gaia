import { describe, expect, it } from 'vitest';
import { rangeWidth, rowWidthsFromRanges, settleChunk, settlePlan } from '../src/settlement';

describe('settleChunk', () => {
  it('continues each chunk to the end of its row', () => {
    // 3 + 5 = 8 squares: the chunk passes maxSquares = 6 in row 1 and ends with that row.
    expect(settleChunk([3, 5, 4, 2], 6)).toEqual({ fromRow: 0, toRow: 2, squares: 8, last: false });
    expect(settleChunk([3, 5, 4, 2], 6, 2)).toEqual({ fromRow: 2, toRow: 4, squares: 6, last: true });
  });

  it('settles a row that is wider than maxSquares in one chunk', () => {
    expect(settleChunk([10, 2], 4)).toEqual({ fromRow: 0, toRow: 1, squares: 10, last: false });
  });

  it('settles all rows with maxSquares = 0', () => {
    expect(settleChunk([3, 5, 4], 0)).toEqual({ fromRow: 0, toRow: 3, squares: 12, last: true });
  });

  it('starts at the first row that holds squares and stops at the last one', () => {
    expect(settleChunk([0, 0, 2, 3, 0], 2)).toEqual({ fromRow: 2, toRow: 3, squares: 2, last: false });
    expect(settleChunk([0, 0, 2, 3, 0], 2, 3)).toEqual({ fromRow: 3, toRow: 4, squares: 3, last: true });
  });

  it('returns undefined for a settled shape or a shape with no squares', () => {
    expect(settleChunk([3, 5], 6, 2)).toBeUndefined();
    expect(settleChunk([0, 0], 6)).toBeUndefined();
    expect(settleChunk([], 6)).toBeUndefined();
  });
});

describe('settlePlan', () => {
  it('gives all chunks from the cursor to the end', () => {
    expect(settlePlan([1, 1, 1, 1, 1], 2).map((c) => [c.fromRow, c.toRow])).toEqual([
      [0, 2],
      [2, 4],
      [4, 5],
    ]);
    expect(settlePlan([1, 1, 1, 1, 1], 2, 3).map((c) => c.squares)).toEqual([2]);
    expect(settlePlan([4, 4], 1).map((c) => c.squares)).toEqual([4, 4]);
  });

  it('settles each square once', () => {
    const widths = [3, 7, 1, 0, 0];
    const plan = settlePlan(widths, 5);
    expect(plan.reduce((sum, c) => sum + c.squares, 0)).toBe(11);
    expect(plan.at(-1)?.last).toBe(true);
  });
});

describe('row ranges', () => {
  it('counts the squares of a range, also across the antimeridian', () => {
    expect(rangeWidth(501, 508)).toBe(8);
    expect(rangeWidth(7, 7)).toBe(1);
    expect(rangeWidth(35998, 1)).toBe(4);
  });

  it('gives 0 for an empty row', () => {
    expect(rowWidthsFromRanges([{ first: 504, last: 508 }, undefined, { first: 35999, last: 0 }])).toEqual([
      5, 0, 2,
    ]);
  });
});
