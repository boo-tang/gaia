import { LNG_COLUMNS } from '../constants';
import { Loc } from '../types';

// Mirrors GaiaAuction.sol's shape-validity rules (contracts/GaiaAuction.sol: _validateShape)
// so the client can give live feedback before submitting a bid.
// Operates on chain (uint16) coordinates, sorted lat asc then lng west to east within each row.
// Longitude wraps, so a row can be e.g. 35998, 35999, 0, 1.

export interface ShapeLimits {
  minShapeSquares: bigint;
  maxShapeSquares: bigint;
  maxShapeAspectRatio: bigint;
}

export type ShapeValidation = { valid: true } | { valid: false; reason: string };

// Mirrors GaiaAuction.sol's LNG_ORIGIN / _normLng.
const LNG_ORIGIN = LNG_COLUMNS / 2;
const normLng = (lng: number, refLng: number) =>
  (lng + LNG_COLUMNS + LNG_ORIGIN - refLng) % LNG_COLUMNS;

// The west edge of the shape is the column after the largest gap between occupied columns,
// with the gap that wraps around the antimeridian included.
const westEdgeLng = (locs: Loc[]): number => {
  const lngs = [...new Set(locs.map((loc) => loc.lng))].sort((a, b) => a - b);
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

// Packs squares as GaiaAuction.bidOnShape takes them and as the ShapeBid event emits them:
// `(lat << 16) | lng`.
export const packLocs = (locs: Loc[]): number[] => locs.map((loc) => loc.lat * 65536 + loc.lng);

export const sortLocs = (locs: Loc[]): Loc[] => {
  if (locs.length === 0) return [];
  const west = westEdgeLng(locs);
  const eastOfWest = (lng: number) => (lng - west + LNG_COLUMNS) % LNG_COLUMNS;
  return [...locs].sort((a, b) => a.lat - b.lat || eastOfWest(a.lng) - eastOfWest(b.lng));
};

// `locs` must already be sorted (see sortLocs).
export const validateShape = (locs: Loc[], limits: ShapeLimits): ShapeValidation => {
  const len = locs.length;
  if (len === 0) return { valid: false, reason: 'Select at least one square' };
  if (BigInt(len) < limits.minShapeSquares) {
    return { valid: false, reason: `Shape needs at least ${limits.minShapeSquares} square(s)` };
  }
  if (BigInt(len) > limits.maxShapeSquares) {
    return { valid: false, reason: `Shape can have at most ${limits.maxShapeSquares} squares` };
  }

  const refLng = locs[0].lng;
  let currentLat = locs[0].lat;
  let prevLngInLat = LNG_ORIGIN;
  let longitudeRangeStart = LNG_ORIGIN;
  let longitudeRangeEnd = LNG_ORIGIN;
  let globalMinLng = LNG_ORIGIN;
  let globalMaxLng = LNG_ORIGIN;
  let prevRangeStart = LNG_ORIGIN;
  let prevRangeEnd = LNG_ORIGIN;
  let isFirstLat = true;
  let latHasAdjacent = true;
  let leftFlipped = false;
  let rightFlipped = false;

  for (let i = 1; i < len; i++) {
    const { lat } = locs[i];
    const lng = normLng(locs[i].lng, refLng);

    if (lat === currentLat) {
      if (lng !== prevLngInLat + 1) {
        return { valid: false, reason: 'Squares in a row must be contiguous, with no gaps or duplicates' };
      }
      prevLngInLat = lng;
      longitudeRangeEnd = lng;
      if (lng > globalMaxLng) globalMaxLng = lng;
      if (!isFirstLat && !latHasAdjacent && lng >= prevRangeStart && lng <= prevRangeEnd) {
        latHasAdjacent = true;
      }
    } else {
      if (lat < currentLat) return { valid: false, reason: 'Squares must be sorted by row, then column' };
      if (lat !== currentLat + 1) return { valid: false, reason: 'Rows must be consecutive, with no gaps' };

      if (!isFirstLat) {
        if (!latHasAdjacent) return { valid: false, reason: 'Each row must touch the row before it' };
        if (longitudeRangeEnd < prevRangeEnd && !rightFlipped) {
          rightFlipped = true;
        } else if (rightFlipped && longitudeRangeEnd > prevRangeEnd) {
          return { valid: false, reason: 'Shape is not convex on its right edge' };
        }
      }

      prevRangeStart = longitudeRangeStart;
      prevRangeEnd = longitudeRangeEnd;
      currentLat = lat;
      prevLngInLat = lng;
      longitudeRangeStart = lng;
      longitudeRangeEnd = lng;

      if (lng < globalMinLng) globalMinLng = lng;
      if (lng > globalMaxLng) globalMaxLng = lng;

      if (lng > prevRangeStart && !leftFlipped) {
        leftFlipped = true;
      } else if (leftFlipped && lng < prevRangeStart) {
        return { valid: false, reason: 'Shape is not convex on its left edge' };
      }

      isFirstLat = false;
      latHasAdjacent = lng >= prevRangeStart && lng <= prevRangeEnd;
    }
  }

  if (!isFirstLat) {
    if (!latHasAdjacent) return { valid: false, reason: 'Each row must touch the row before it' };
    if (rightFlipped && longitudeRangeEnd > prevRangeEnd) {
      return { valid: false, reason: 'Shape is not convex on its right edge' };
    }
  }

  const height = locs[len - 1].lat - locs[0].lat + 1;
  const width = globalMaxLng - globalMinLng + 1;
  const longer = Math.max(height, width);
  const shorter = Math.min(height, width);
  if (BigInt(longer) > BigInt(shorter) * limits.maxShapeAspectRatio) {
    return {
      valid: false,
      reason: `Shape is too elongated (longest side can be at most ${limits.maxShapeAspectRatio}x the shortest)`,
    };
  }

  return { valid: true };
};

export interface BidRules {
  minBidPerSquareWei: bigint;
  minBidIncrementBps: bigint;
}

// Mirrors GaiaAuction.sol's _nextBid: the minimum amount required to become the highest bidder
// on a square currently at `currentAmount`. The step is the larger of the absolute minimum and
// the percentage of the current bid.
export const nextBidFor = (currentAmount: bigint, rules: BidRules): bigint => {
  if (currentAmount < rules.minBidPerSquareWei) return rules.minBidPerSquareWei;
  const relative = (currentAmount * rules.minBidIncrementBps) / 10_000n;
  return currentAmount + (relative > rules.minBidPerSquareWei ? relative : rules.minBidPerSquareWei);
};

// Mirrors GaiaAuction.sol's _bidAmount: the next bid, or `floorPerSquare` if that is larger.
export const bidAmountFor = (currentAmount: bigint, rules: BidRules, floorPerSquare = 0n): bigint => {
  const next = nextBidFor(currentAmount, rules);
  return floorPerSquare > next ? floorPerSquare : next;
};

// Current highest bid on a square. `own` is true if the bidder is the connected account.
export interface CurrentBid {
  amount: bigint;
  own: boolean;
}

// Mirrors GaiaAuction.sol's _takeSquares (the `paid` part): the ETH that a bid spends on one
// square. A square of a different bidder, or with no bid: bidAmountFor. Own square: 0, or only the
// increase if `raiseOwnSquares` is true.
export const squareCostFor = (
  current: CurrentBid,
  rules: BidRules,
  floorPerSquare = 0n,
  raiseOwnSquares = false,
): bigint => {
  if (!current.own) return bidAmountFor(current.amount, rules, floorPerSquare);
  if (!raiseOwnSquares) return 0n;
  return bidAmountFor(current.amount, rules, floorPerSquare) - current.amount;
};

// Sum of squareCostFor across all squares, given their current highest bids (same order as
// `locs`). This is the `msg.value` that the bid needs.
export const computeBidTotal = (
  currentBids: CurrentBid[],
  rules: BidRules,
  floorPerSquare = 0n,
  raiseOwnSquares = false,
): bigint =>
  currentBids.reduce(
    (sum, current) => sum + squareCostFor(current, rules, floorPerSquare, raiseOwnSquares),
    0n,
  );
