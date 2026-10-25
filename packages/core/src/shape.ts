// Square order, packing and prices of GaiaAuction, for the bid of the app. The shape rules are
// only in the contract: the simulation of `bidOnShape` checks them.
//
// The prices follow GaiaAuction.sol (_nextBid, _bidAmount, _takeSquares). The squares are
// contract values (see grid.ts). Sort them by latitude, then west to east in each row
// (sortLocs). Longitude wraps, so a row can be 35998, 35999, 0, 1.
import { LNG_COLUMNS, type Square, packSquare } from './grid';

/**
 * The west edge of a set of squares: the column after the largest gap between occupied columns.
 * The gap that wraps around the antimeridian is included. `locs` must not be empty.
 */
export const westEdgeLng = (locs: readonly Square[]): number => {
  const lngs = [...new Set(locs.map(loc => loc.lng))].sort((a, b) => a - b);
  let west = lngs[0];
  let largestGap = lngs[0] + LNG_COLUMNS - lngs[lngs.length - 1];
  for (let i = 1; i < lngs.length; i++) {
    const gap = lngs[i] - lngs[i - 1];
    if (gap > largestGap) {
      largestGap = gap;
      west = lngs[i];
    }
  }
  return west;
};

/**
 * Packs squares as `bidOnShape` takes them and as the `ShapeBid` event gives them:
 * `(lat << 16) | lng`.
 */
export const packLocs = (locs: readonly Square[]): number[] => locs.map(packSquare);

/** Sorts squares by latitude, then west to east in each row, across the antimeridian. */
export const sortLocs = (locs: readonly Square[]): Square[] => {
  if (locs.length === 0) {
    return [];
  }
  const west = westEdgeLng(locs);
  const eastOfWest = (lng: number) => (lng - west + LNG_COLUMNS) % LNG_COLUMNS;
  return [...locs].sort((a, b) => a.lat - b.lat || eastOfWest(a.lng) - eastOfWest(b.lng));
};

export interface BidRules {
  minBidPerSquareWei: bigint;
  minBidIncrementBps: bigint;
}

/**
 * The minimum next bid on a square at `currentAmount` (GaiaAuction.sol: _nextBid). The step is
 * the larger of `minBidPerSquareWei` and `minBidIncrementBps` of the current bid.
 */
export const nextBidFor = (currentAmount: bigint, rules: BidRules): bigint => {
  if (currentAmount < rules.minBidPerSquareWei) {
    return rules.minBidPerSquareWei;
  }
  const relative = (currentAmount * rules.minBidIncrementBps) / 10_000n;
  return currentAmount + (relative > rules.minBidPerSquareWei ? relative : rules.minBidPerSquareWei);
};

/** The amount that a bid puts on a square: the next bid, or `floorPerSquare` if that is larger. */
export const bidAmountFor = (currentAmount: bigint, rules: BidRules, floorPerSquare = 0n): bigint => {
  const next = nextBidFor(currentAmount, rules);
  return floorPerSquare > next ? floorPerSquare : next;
};

/** The current highest bid on a square. `own` is true if the bidder is the connected account. */
export interface CurrentBid {
  amount: bigint;
  own: boolean;
}

/**
 * The ETH that a bid pays for one square (GaiaAuction.sol: _takeSquares). A square with no bid
 * or with the bid of a different bidder: bidAmountFor. An own square: 0, or only the increase if
 * `raiseOwnSquares` is true.
 */
export const squareCostFor = (
  current: CurrentBid,
  rules: BidRules,
  floorPerSquare = 0n,
  raiseOwnSquares = false,
): bigint => {
  if (!current.own) {
    return bidAmountFor(current.amount, rules, floorPerSquare);
  }
  if (!raiseOwnSquares) {
    return 0n;
  }
  return bidAmountFor(current.amount, rules, floorPerSquare) - current.amount;
};

/** The `msg.value` of a bid: the sum of squareCostFor over all squares of the bid. */
export const computeBidTotal = (
  currentBids: readonly CurrentBid[],
  rules: BidRules,
  floorPerSquare = 0n,
  raiseOwnSquares = false,
): bigint =>
  currentBids.reduce((sum, current) => sum + squareCostFor(current, rules, floorPerSquare, raiseOwnSquares), 0n);
