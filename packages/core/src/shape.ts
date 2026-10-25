// Shape rules and prices of GaiaAuction, for feedback in the app before a bid.
//
// The rules follow GaiaAuction.sol (_validateShape, _shapeError, _nextBid, _bidAmount,
// _takeSquares). The squares are contract values (see grid.ts). Sort them by latitude, then
// west to east in each row (sortLocs). Longitude wraps, so a row can be 35998, 35999, 0, 1.
import { LAT_ROWS, LNG_COLUMNS, type Square, packSquare } from './grid';

export interface ShapeLimits {
  minShapeSquares: bigint;
  maxShapeSquares: bigint;
  maxShapeAspectRatio: bigint;
}

/** The name of the contract error that the bid reverts with. */
export type ShapeError =
  | 'EmptyShape'
  | 'ShapeTooSmall'
  | 'ShapeTooLarge'
  | 'InvalidCoordinates'
  | 'GapBetweenLongitudes'
  | 'Unsorted'
  | 'NonConsecutiveLatitudes'
  | 'NoLatAdjacency'
  | 'NotConvexEnd'
  | 'NotConvexStart'
  | 'AspectRatioExceeded';

export type ShapeValidation = { valid: true } | { valid: false; reason: ShapeError };

/** A short text for each shape error, for the UI. */
export const SHAPE_ERROR_TEXT: Record<ShapeError, string> = {
  EmptyShape: 'Select at least one square.',
  ShapeTooSmall: 'The shape has too few squares.',
  ShapeTooLarge: 'The shape has too many squares.',
  InvalidCoordinates: 'A square is outside the grid.',
  GapBetweenLongitudes: 'The squares in a row must touch, with no gaps or duplicates.',
  Unsorted: 'Sort the squares by row, then from west to east.',
  NonConsecutiveLatitudes: 'The rows must be consecutive, with no gaps.',
  NoLatAdjacency: 'Each row must touch the row before it.',
  NotConvexEnd: 'The east edge of the shape is not convex.',
  NotConvexStart: 'The west edge of the shape is not convex.',
  AspectRatioExceeded: 'The shape is too long and narrow.',
};

// GaiaAuction.sol: LNG_ORIGIN and _normLng.
const LNG_ORIGIN = LNG_COLUMNS / 2;
const normLng = (lng: number, refLng: number) => (lng + LNG_COLUMNS + LNG_ORIGIN - refLng) % LNG_COLUMNS;

const isUint16 = (value: number) => Number.isInteger(value) && value >= 0 && value < 65536;

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

/**
 * The shape check of `bidOnShape`. Returns the first error that the contract finds, in the same
 * order. `locs` must be sorted (see sortLocs).
 */
export const validateShape = (locs: readonly Square[], limits: ShapeLimits): ShapeValidation => {
  const len = locs.length;
  if (len === 0) {
    return { valid: false, reason: 'EmptyShape' };
  }
  if (BigInt(len) < limits.minShapeSquares) {
    return { valid: false, reason: 'ShapeTooSmall' };
  }
  if (BigInt(len) > limits.maxShapeSquares) {
    return { valid: false, reason: 'ShapeTooLarge' };
  }
  // The contract takes uint16 values. Other numbers cannot go into a bid.
  if (locs.some(loc => !isUint16(loc.lat) || !isUint16(loc.lng))) {
    return { valid: false, reason: 'InvalidCoordinates' };
  }

  const refLng = locs[0].lng;
  if (refLng >= LNG_COLUMNS) {
    return { valid: false, reason: 'InvalidCoordinates' };
  }

  let currentLat = locs[0].lat;
  let prevLngInLat = LNG_ORIGIN;
  let rangeStart = LNG_ORIGIN;
  let rangeEnd = LNG_ORIGIN;
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
    if (locs[i].lng >= LNG_COLUMNS) {
      return { valid: false, reason: 'InvalidCoordinates' };
    }
    const lng = normLng(locs[i].lng, refLng);

    if (lat === currentLat) {
      if (lng !== prevLngInLat + 1) {
        return { valid: false, reason: 'GapBetweenLongitudes' };
      }
      prevLngInLat = lng;
      rangeEnd = lng;
      if (lng > globalMaxLng) {
        globalMaxLng = lng;
      }
      if (!isFirstLat && !latHasAdjacent && lng >= prevRangeStart && lng <= prevRangeEnd) {
        latHasAdjacent = true;
      }
    } else {
      if (lat < currentLat) {
        return { valid: false, reason: 'Unsorted' };
      }
      if (lat !== currentLat + 1) {
        return { valid: false, reason: 'NonConsecutiveLatitudes' };
      }

      if (!isFirstLat) {
        if (!latHasAdjacent) {
          return { valid: false, reason: 'NoLatAdjacency' };
        }
        if (rangeEnd < prevRangeEnd && !rightFlipped) {
          rightFlipped = true;
        } else if (rightFlipped && rangeEnd > prevRangeEnd) {
          return { valid: false, reason: 'NotConvexEnd' };
        }
      }

      prevRangeStart = rangeStart;
      prevRangeEnd = rangeEnd;
      currentLat = lat;
      prevLngInLat = lng;
      rangeStart = lng;
      rangeEnd = lng;

      if (lng < globalMinLng) {
        globalMinLng = lng;
      }
      if (lng > globalMaxLng) {
        globalMaxLng = lng;
      }

      if (lng > prevRangeStart && !leftFlipped) {
        leftFlipped = true;
      } else if (leftFlipped && lng < prevRangeStart) {
        return { valid: false, reason: 'NotConvexStart' };
      }

      isFirstLat = false;
      latHasAdjacent = lng >= prevRangeStart && lng <= prevRangeEnd;
    }
  }

  if (!isFirstLat) {
    if (!latHasAdjacent) {
      return { valid: false, reason: 'NoLatAdjacency' };
    }
    if (rightFlipped && rangeEnd > prevRangeEnd) {
      return { valid: false, reason: 'NotConvexEnd' };
    }
  }

  // The squares are sorted, so the last square has the highest latitude.
  if (locs[len - 1].lat >= LAT_ROWS) {
    return { valid: false, reason: 'InvalidCoordinates' };
  }

  const height = locs[len - 1].lat - locs[0].lat + 1;
  const width = globalMaxLng - globalMinLng + 1;
  const longer = Math.max(height, width);
  const shorter = Math.min(height, width);
  if (BigInt(longer) > BigInt(shorter) * limits.maxShapeAspectRatio) {
    return { valid: false, reason: 'AspectRatioExceeded' };
  }

  return { valid: true };
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
