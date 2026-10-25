import { describe, expect, it } from 'vitest';

import { packSquare } from '../src/grid';
import {
  type SelectionBid,
  priceSelection,
  rectangleBetween,
  rectangleOutline,
  rectangleSize,
  rectangleSquares,
  selectionExtent,
} from '../src/selection';
import { type BidRules, computeBidTotal } from '../src/shape';

const rules: BidRules = { minBidPerSquareWei: 1000n, minBidIncrementBps: 500n };
const ALICE = '0x00000000000000000000000000000000000000Aa';
const BOB = '0x00000000000000000000000000000000000000bB';

describe('rectangleBetween', () => {
  it('orders the rows and goes east from the west corner', () => {
    expect(rectangleBetween({ lat: 20, lng: 300 }, { lat: 11, lng: 281 })).toEqual({
      south: 11,
      north: 20,
      west: 281,
      east: 300,
    });
  });

  it('takes the shorter way across the antimeridian', () => {
    expect(rectangleBetween({ lat: 5, lng: 35998 }, { lat: 5, lng: 1 })).toEqual({
      south: 5,
      north: 5,
      west: 35998,
      east: 1,
    });
    expect(rectangleBetween({ lat: 5, lng: 1 }, { lat: 5, lng: 35998 })).toEqual({
      south: 5,
      north: 5,
      west: 35998,
      east: 1,
    });
    expect(rectangleSize(rectangleBetween({ lat: 0, lng: 35999 }, { lat: 0, lng: 0 })).columns).toBe(2);
  });

  it('gives one square for a drag that stays in its square', () => {
    expect(rectangleSize(rectangleBetween({ lat: 3, lng: 4 }, { lat: 3, lng: 4 }))).toEqual({
      rows: 1,
      columns: 1,
      count: 1,
    });
  });
});

describe('rectangleSquares', () => {
  it('gives 200 squares for 10 rows of 20 columns', () => {
    const rect = rectangleBetween({ lat: 14170, lng: 17800 }, { lat: 14179, lng: 17819 });
    expect(rectangleSize(rect)).toEqual({ rows: 10, columns: 20, count: 200 });
    const squares = rectangleSquares(rect);
    expect(squares).toHaveLength(200);
    expect(new Set(squares.map(packSquare)).size).toBe(200);
  });

  it('sorts and packs a rectangle across the antimeridian as the contract expects', () => {
    const rect = rectangleBetween({ lat: 7220, lng: 35998 }, { lat: 7221, lng: 1 });
    const priced = priceSelection(
      rectangleSquares(rect).reverse(),
      () => undefined,
      () => true,
      rules,
      {},
    );
    expect(priced.sorted.map(s => s.lng)).toEqual([35998, 35999, 0, 1, 35998, 35999, 0, 1]);
    expect(priced.packed.slice(0, 4)).toEqual([35998, 35999, 0, 1].map(lng => 7220 * 65536 + lng));
  });
});

describe('rectangleOutline', () => {
  it('is a closed line around the rectangle in degrees', () => {
    const outline = rectangleOutline({ south: 9000, north: 9009, west: 18000, east: 18009 });
    expect(outline[0]).toEqual([0, 0]);
    expect(outline[outline.length - 1]).toEqual([0, 0]);
    const lngs = outline.map(p => p[0]);
    const lats = outline.map(p => p[1]);
    expect(Math.max(...lngs)).toBeCloseTo(0.1);
    expect(Math.max(...lats)).toBeCloseTo(0.1);
  });

  it('puts the east edge above 180° across the antimeridian, with steps of at most stepDeg', () => {
    const outline = rectangleOutline({ south: 9000, north: 9000, west: 35900, east: 99 }, 0.5);
    expect(Math.min(...outline.map(p => p[0]))).toBeCloseTo(179);
    expect(Math.max(...outline.map(p => p[0]))).toBeCloseTo(181);
    for (let i = 1; i < outline.length; i++) {
      expect(Math.abs(outline[i][0] - outline[i - 1][0])).toBeLessThanOrEqual(0.5 + 1e-9);
    }
  });
});

describe('selectionExtent', () => {
  it('is undefined for no squares', () => {
    expect(selectionExtent([])).toBeUndefined();
  });

  it('holds all squares, also across the antimeridian', () => {
    expect(
      selectionExtent([
        { lat: 4, lng: 1 },
        { lat: 2, lng: 35998 },
        { lat: 3, lng: 0 },
      ]),
    ).toEqual({ south: 2, north: 4, west: 35998, east: 1 });
  });
});

describe('priceSelection', () => {
  // Square (1, 1): no bid. (1, 2): Bob at 10,000. (1, 3): Alice at 100,000. (1, 4): Bob at 2,000.
  const bids = new Map<number, SelectionBid>([
    [packSquare({ lat: 1, lng: 2 }), { shapeId: 7, bidder: BOB, amount: 10_000n }],
    [packSquare({ lat: 1, lng: 3 }), { shapeId: 3, bidder: ALICE, amount: 100_000n }],
    [packSquare({ lat: 1, lng: 4 }), { shapeId: 7, bidder: BOB, amount: 2_000n }],
  ]);
  const squares = [1, 2, 3, 4].map(lng => ({ lat: 1, lng }));
  const price = (options: Parameters<typeof priceSelection>[4], loaded = (_id: number) => true) =>
    priceSelection(squares, id => bids.get(id), loaded, rules, options);

  it('gives the minimum next bid of each square, and 0 for own squares', () => {
    const priced = price({ ownAddress: ALICE.toLowerCase() });
    // No bid: 1,000. 10,000: plus 1,000 (5% is 500). Own: 0. 2,000: plus 1,000.
    expect(priced.costs).toEqual([1000n, 11_000n, 0n, 3000n]);
    expect(priced.own).toEqual([false, false, true, false]);
    expect(priced.total).toBe(15_000n);
    expect(priced.floorPerSquare).toBe(0n);
    expect(priced.minPricePerSquare).toBe(11_000n);
    expect(priced.priceTooLow).toBe(false);
    expect([priced.newCount, priced.outbidCount, priced.ownCount, priced.missingCount]).toEqual([1, 2, 1, 0]);
    expect(priced.cuts).toEqual([
      { shapeId: 3, bidder: ALICE, squareCount: 1, own: true },
      { shapeId: 7, bidder: BOB, squareCount: 2, own: false },
    ]);
  });

  it('matches computeBidTotal of packages/core', () => {
    const priced = price({ ownAddress: ALICE, pricePerSquare: 20_000n });
    const current = squares.map(s => {
      const bid = bids.get(packSquare(s));
      return { amount: bid?.amount ?? 0n, own: bid?.bidder === ALICE };
    });
    expect(priced.total).toBe(computeBidTotal(current, rules, 20_000n, false));
  });

  it('gives the price per square to each square that is not own', () => {
    const priced = price({ ownAddress: ALICE, pricePerSquare: 20_000n });
    expect(priced.costs).toEqual([20_000n, 20_000n, 0n, 20_000n]);
    expect(priced.total).toBe(60_000n);
    expect(priced.floorPerSquare).toBe(20_000n);
    expect(priced.priceTooLow).toBe(false);
  });

  it('tells when the price per square is below the minimum', () => {
    expect(price({ ownAddress: ALICE, pricePerSquare: 10_999n }).priceTooLow).toBe(true);
    expect(price({ ownAddress: ALICE, pricePerSquare: 11_000n }).priceTooLow).toBe(false);
  });

  it('counts the own square as outbid with no wallet', () => {
    const priced = price({});
    expect(priced.costs[2]).toBe(105_000n);
    expect(priced.minPricePerSquare).toBe(105_000n);
    expect(priced.ownCount).toBe(0);
    expect(priced.outbidCount).toBe(3);
  });

  it('counts the squares outside the loaded data', () => {
    const priced = price({}, id => id !== packSquare({ lat: 1, lng: 1 }));
    expect(priced.missingCount).toBe(1);
  });

  it('is empty for no squares', () => {
    const priced = priceSelection(
      [],
      () => undefined,
      () => true,
      rules,
      {},
    );
    expect(priced.total).toBe(0n);
    expect(priced.packed).toEqual([]);
    expect(priced.minPricePerSquare).toBe(0n);
  });
});
