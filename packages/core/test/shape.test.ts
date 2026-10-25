import { describe, expect, it } from 'vitest';

import { bidAmountFor, computeBidTotal, nextBidFor, packLocs, sortLocs, squareCostFor } from '../src/shape';

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
    const sorted = sortLocs([0, 35999, 1, 35998].map(lng => ({ lat: 7, lng })));
    expect(sorted.map(s => s.lng)).toEqual([35998, 35999, 0, 1]);
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
    expect(squareCostFor({ amount: 10n * milli, own: true }, rules, 30n * milli, true)).toBe(20n * milli);
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
