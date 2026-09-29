import { Loc } from '../types';

// Mirrors GaiaAuction.sol's shape-validity rules (contracts/GaiaAuction.sol: _validateShapeMem /
// _validateAndComputeTotal) so the client can give live feedback before submitting a bid.
// Operates on chain (uint16) coordinates, sorted lat asc then lng asc within each row.

export interface ShapeLimits {
  minShapeSquares: bigint;
  maxShapeSquares: bigint;
  maxShapeAspectRatio: bigint;
}

export type ShapeValidation = { valid: true } | { valid: false; reason: string };

export const sortLocs = (locs: Loc[]): Loc[] =>
  [...locs].sort((a, b) => a.lat - b.lat || a.lng - b.lng);

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

  let currentLat = locs[0].lat;
  let prevLngInLat = locs[0].lng;
  let longitudeRangeStart = locs[0].lng;
  let longitudeRangeEnd = locs[0].lng;
  let globalMinLng = locs[0].lng;
  let globalMaxLng = locs[0].lng;
  let prevRangeStart = locs[0].lng;
  let prevRangeEnd = locs[0].lng;
  let isFirstLat = true;
  let latHasAdjacent = true;
  let leftFlipped = false;
  let rightFlipped = false;

  for (let i = 1; i < len; i++) {
    const { lat, lng } = locs[i];

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

// Mirrors GaiaAuction.sol's _nextBid: the minimum amount required to become the highest bidder
// on a square currently at `currentAmount`.
export const nextBidFor = (currentAmount: bigint, minBidPerSquareWei: bigint): bigint =>
  currentAmount < minBidPerSquareWei ? minBidPerSquareWei : currentAmount + minBidPerSquareWei;

// Sum of nextBidFor across all squares, given their current highest bids (same order as `locs`).
export const computeBidTotal = (currentAmounts: bigint[], minBidPerSquareWei: bigint): bigint =>
  currentAmounts.reduce((sum, amount) => sum + nextBidFor(amount, minBidPerSquareWei), 0n);
