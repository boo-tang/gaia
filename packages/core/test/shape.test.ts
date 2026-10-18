import { describe, expect, it } from 'vitest';
import type { Square } from '../src/grid';
import {
  SHAPE_ERROR_TEXT,
  bidAmountFor,
  computeBidTotal,
  nextBidFor,
  packLocs,
  sortLocs,
  squareCostFor,
  validateShape,
  type ShapeLimits,
} from '../src/shape';

const limits: ShapeLimits = { minShapeSquares: 1n, maxShapeSquares: 100n, maxShapeAspectRatio: 4n };

/** The squares of a shape, one `[firstLng, lastLng]` range per row, from row `lat0` north. */
const rows = (lat0: number, ranges: [number, number][]): Square[] =>
  ranges.flatMap(([first, last], r) => {
    const squares: Square[] = [];
    for (let lng = first; ; lng = (lng + 1) % 36000) {
      squares.push({ lat: lat0 + r, lng });
      if (lng === last) break;
    }
    return squares;
  });

const reason = (locs: Square[], l: ShapeLimits = limits) => {
  const result = validateShape(locs, l);
  return result.valid ? 'valid' : result.reason;
};

describe('packLocs', () => {
  it('packs each square as (lat << 16) | lng, in order', () => {
    expect(
      packLocs([
        { lat: 1, lng: 2 },
        { lat: 0, lng: 35999 },
        { lat: 17999, lng: 0 },
      ]),
    ).toEqual([65538, 35999, 17999 * 65536]);
  });
});

describe('sortLocs', () => {
  it('sorts by latitude, then west to east', () => {
    const sorted = sortLocs([
      { lat: 6, lng: 11 },
      { lat: 5, lng: 11 },
      { lat: 6, lng: 10 },
      { lat: 5, lng: 10 },
    ]);
    expect(sorted).toEqual([
      { lat: 5, lng: 10 },
      { lat: 5, lng: 11 },
      { lat: 6, lng: 10 },
      { lat: 6, lng: 11 },
    ]);
  });

  it('continues across the antimeridian: 35998, 35999, 0, 1', () => {
    const sorted = sortLocs([0, 35999, 1, 35998].map((lng) => ({ lat: 7, lng })));
    expect(sorted.map((s) => s.lng)).toEqual([35998, 35999, 0, 1]);
    expect(validateShape(sorted, limits)).toEqual({ valid: true });
  });

  it('does not change the input array', () => {
    const input = [
      { lat: 2, lng: 0 },
      { lat: 1, lng: 0 },
    ];
    sortLocs(input);
    expect(input[0].lat).toBe(2);
  });
});

describe('validateShape', () => {
  it('accepts a rectangle, a plus shape and a shape across the antimeridian', () => {
    expect(reason(rows(10, [[100, 103], [100, 103]]))).toBe('valid');
    expect(reason(rows(10, [[101, 101], [100, 102], [101, 101]]))).toBe('valid');
    expect(reason(rows(10, [[35998, 1], [35999, 0]]))).toBe('valid');
    expect(reason([{ lat: 17999, lng: 35999 }])).toBe('valid');
  });

  it('EmptyShape: no squares', () => {
    expect(reason([])).toBe('EmptyShape');
  });

  it('ShapeTooSmall: fewer than minShapeSquares', () => {
    expect(reason(rows(10, [[100, 102]]), { ...limits, minShapeSquares: 4n })).toBe('ShapeTooSmall');
  });

  it('ShapeTooLarge: more than maxShapeSquares', () => {
    expect(reason(rows(10, [[100, 103]]), { ...limits, maxShapeSquares: 3n })).toBe('ShapeTooLarge');
  });

  it('InvalidCoordinates: lng 36000 or more', () => {
    expect(reason([{ lat: 0, lng: 36000 }])).toBe('InvalidCoordinates');
    expect(reason([{ lat: 0, lng: 35999 }, { lat: 0, lng: 36000 }])).toBe('InvalidCoordinates');
  });

  it('InvalidCoordinates: lat 18000 or more', () => {
    expect(reason([{ lat: 18000, lng: 0 }])).toBe('InvalidCoordinates');
    expect(reason(rows(17999, [[0, 1], [0, 1]]))).toBe('InvalidCoordinates');
  });

  it('InvalidCoordinates: a value that is not a uint16', () => {
    expect(reason([{ lat: -1, lng: 0 }])).toBe('InvalidCoordinates');
    expect(reason([{ lat: 0, lng: 0.5 }])).toBe('InvalidCoordinates');
  });

  it('GapBetweenLongitudes: a gap or a duplicate in a row', () => {
    expect(reason([{ lat: 5, lng: 10 }, { lat: 5, lng: 12 }])).toBe('GapBetweenLongitudes');
    expect(reason([{ lat: 5, lng: 10 }, { lat: 5, lng: 10 }])).toBe('GapBetweenLongitudes');
  });

  it('Unsorted: a row south of the row before it', () => {
    expect(reason([{ lat: 5, lng: 10 }, { lat: 4, lng: 10 }])).toBe('Unsorted');
  });

  it('NonConsecutiveLatitudes: a missing row', () => {
    expect(reason([{ lat: 5, lng: 10 }, { lat: 7, lng: 10 }])).toBe('NonConsecutiveLatitudes');
  });

  it('NoLatAdjacency: a row that does not touch the row before it', () => {
    expect(reason(rows(5, [[10, 11], [12, 13]]))).toBe('NoLatAdjacency');
    // The same rule for a row in the middle of the shape.
    expect(reason(rows(5, [[10, 11], [12, 13], [12, 13]]))).toBe('NoLatAdjacency');
  });

  it('NotConvexStart: the west edge goes east, then west', () => {
    expect(reason(rows(5, [[10, 12], [11, 12], [10, 12]]))).toBe('NotConvexStart');
  });

  it('NotConvexEnd: the east edge goes west, then east', () => {
    expect(reason(rows(5, [[10, 12], [10, 11], [10, 12]]))).toBe('NotConvexEnd');
    expect(reason(rows(5, [[10, 12], [10, 11], [10, 12], [10, 12]]))).toBe('NotConvexEnd');
  });

  it('AspectRatioExceeded: the longer side is more than maxShapeAspectRatio times the shorter', () => {
    expect(reason(rows(5, [[10, 13]]))).toBe('valid');
    expect(reason(rows(5, [[10, 14]]))).toBe('AspectRatioExceeded');
    expect(reason(rows(5, [[35998, 2]]))).toBe('AspectRatioExceeded');
  });

  it('has a text for each error', () => {
    for (const text of Object.values(SHAPE_ERROR_TEXT)) expect(text.length).toBeGreaterThan(0);
  });
});

describe('prices', () => {
  // 0.001 ETH and 5%, the example of docs/square-ownership/how-it-works.md. The percentage step
  // is larger than the absolute step above 0.02 ETH.
  const milli = 10n ** 15n;
  const rules = { minBidPerSquareWei: milli, minBidIncrementBps: 500n };

  it('nextBidFor: the first bid is minBidPerSquareWei', () => {
    expect(nextBidFor(0n, rules)).toBe(milli);
    expect(nextBidFor(milli - 1n, rules)).toBe(milli);
  });

  it('nextBidFor: below the crossover, the absolute step', () => {
    expect(nextBidFor(10n * milli, rules)).toBe(11n * milli);
    expect(nextBidFor(20n * milli, rules)).toBe(21n * milli);
  });

  it('nextBidFor: above the crossover, the percentage step', () => {
    expect(nextBidFor(20n * milli + 20n, rules)).toBe(21n * milli + 21n);
    expect(nextBidFor(1000n * milli, rules)).toBe(1050n * milli);
  });

  it('bidAmountFor: the next bid, or floorPerSquare if that is larger', () => {
    expect(bidAmountFor(10n * milli, rules)).toBe(11n * milli);
    expect(bidAmountFor(10n * milli, rules, 5n * milli)).toBe(11n * milli);
    expect(bidAmountFor(10n * milli, rules, 30n * milli)).toBe(30n * milli);
  });

  it('squareCostFor: a square of a different bidder costs the bid amount', () => {
    expect(squareCostFor({ amount: 0n, own: false }, rules)).toBe(milli);
    expect(squareCostFor({ amount: 10n * milli, own: false }, rules, 30n * milli)).toBe(30n * milli);
  });

  it('squareCostFor: an own square costs 0 without a raise', () => {
    expect(squareCostFor({ amount: 10n * milli, own: true }, rules)).toBe(0n);
    expect(squareCostFor({ amount: 10n * milli, own: true }, rules, 30n * milli)).toBe(0n);
  });

  it('squareCostFor: an own square with a raise costs only the increase', () => {
    expect(squareCostFor({ amount: 10n * milli, own: true }, rules, 0n, true)).toBe(milli);
    expect(squareCostFor({ amount: 10n * milli, own: true }, rules, 30n * milli, true)).toBe(
      20n * milli,
    );
  });

  it('computeBidTotal: the example of a re-bid on own squares', () => {
    // Alice holds four squares at 0.001 ETH. Bob takes the east square for 0.002 ETH. Alice bids
    // again on all four with raiseOwnSquares = false and pays only for the east square.
    const current = [
      { amount: milli, own: true },
      { amount: milli, own: true },
      { amount: milli, own: true },
      { amount: 2n * milli, own: false },
    ];
    expect(computeBidTotal(current, rules)).toBe(3n * milli);
    expect(computeBidTotal(current, rules, 0n, true)).toBe(6n * milli);
    expect(computeBidTotal([], rules)).toBe(0n);
  });
});
