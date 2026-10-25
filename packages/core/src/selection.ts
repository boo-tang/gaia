// The shape selection of the app: rectangles of squares and the prices of a bid on the selected
// squares. There is no shape rule here: the contract checks the shape (the app simulates the bid).
//
// A rectangle is a `Viewport` (api.ts): rows `south` to `north` and columns `west` to `east`, all
// included. `west > east` means that the rectangle crosses the antimeridian.
import type { Viewport } from './api';
import { LNG_COLUMNS, PRECISION, type Square, packSquare } from './grid';
import { type BidRules, bidAmountFor, packLocs, sortLocs, squareCostFor, westEdgeLng } from './shape';

// The columns from `west` to `east`, eastwards, across the antimeridian.
const columnSpan = (west: number, east: number) => ((east - west + LNG_COLUMNS) % LNG_COLUMNS) + 1;

/**
 * The rectangle from square `a` to square `b` (the corners of a drag). The columns go the shorter
 * way around the globe, so a drag across the antimeridian gives `west > east`.
 */
export const rectangleBetween = (a: Square, b: Square): Viewport => {
  const eastwards = (b.lng - a.lng + LNG_COLUMNS) % LNG_COLUMNS;
  const toEast = eastwards <= LNG_COLUMNS / 2;
  return {
    south: Math.min(a.lat, b.lat),
    north: Math.max(a.lat, b.lat),
    west: toEast ? a.lng : b.lng,
    east: toEast ? b.lng : a.lng,
  };
};

/** The rows, the columns and the number of squares of a rectangle. */
export const rectangleSize = (rect: Viewport) => {
  const rows = rect.north - rect.south + 1;
  const columns = columnSpan(rect.west, rect.east);
  return { rows, columns, count: rows * columns };
};

/** The squares of a rectangle, by row from south to north, each row from west to east. */
export const rectangleSquares = (rect: Viewport): Square[] => {
  const { columns } = rectangleSize(rect);
  const squares: Square[] = [];
  for (let lat = rect.south; lat <= rect.north; lat++) {
    for (let c = 0; c < columns; c++) {
      squares.push({ lat, lng: (rect.west + c) % LNG_COLUMNS });
    }
  }
  return squares;
};

/**
 * The outline of a rectangle as one closed line of `[lng, lat]` points in degrees. Each edge has
 * points at most `stepDeg` apart, so it follows the parallels on a globe. Across the antimeridian
 * the east edge is above 180°, so the line does not go around the globe the wrong way.
 */
export const rectangleOutline = (rect: Viewport, stepDeg = 0.5): [number, number][] => {
  const south = rect.south / PRECISION - 90;
  const north = (rect.north + 1) / PRECISION - 90;
  const west = rect.west / PRECISION - 180;
  const east = west + columnSpan(rect.west, rect.east) / PRECISION;
  const edge = (from: [number, number], to: [number, number]): [number, number][] => {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1])) / stepDeg));
    const points: [number, number][] = [];
    for (let i = 0; i < steps; i++) {
      points.push([from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps]);
    }
    return points;
  };
  return [
    ...edge([west, south], [east, south]),
    ...edge([east, south], [east, north]),
    ...edge([east, north], [west, north]),
    ...edge([west, north], [west, south]),
    [west, south],
  ];
};

/** The smallest rectangle that holds all `squares`. Undefined when there are no squares. */
export const selectionExtent = (squares: readonly Square[]): Viewport | undefined => {
  if (squares.length === 0) {
    return undefined;
  }
  const west = westEdgeLng(squares);
  let south = squares[0].lat;
  let north = squares[0].lat;
  let widest = 0;
  for (const { lat, lng } of squares) {
    south = Math.min(south, lat);
    north = Math.max(north, lat);
    widest = Math.max(widest, (lng - west + LNG_COLUMNS) % LNG_COLUMNS);
  }
  return { south, north, west, east: (west + widest) % LNG_COLUMNS };
};

/** The current highest bid on a square, as the app's bid data has it. */
export interface SelectionBid {
  shapeId: number;
  bidder: string;
  amount: bigint;
}

export interface PriceOptions {
  /** The connected wallet. Its squares cost 0 (the app bids with `raiseOwnSquares = false`). */
  ownAddress?: string;
  /** Undefined: the minimum next bid on each square. Else the price per square in wei. */
  pricePerSquare?: bigint;
}

/** A shape that the selection takes squares from. */
export interface SelectionCut {
  shapeId: number;
  bidder: string;
  /** The squares of the selection that the shape holds now. */
  squareCount: number;
  own: boolean;
}

export interface PricedSelection {
  /** The squares in the order of the contract (sortLocs). */
  sorted: Square[];
  /** The `squares` argument of `bidOnShape`: packLocs(sorted). */
  packed: number[];
  /** The cost of each square of `sorted` (squareCostFor). An own square costs 0. */
  costs: bigint[];
  /** True for each square of `sorted` that the connected wallet holds. */
  own: boolean[];
  /** The `msg.value` of the bid: the sum of `costs`. */
  total: bigint;
  /** `floorPerSquare` of the bid: `pricePerSquare`, or 0 for the minimum bid. */
  floorPerSquare: bigint;
  /**
   * The lowest price per square that is not below the minimum next bid of any square of the
   * selection (own squares are not included). 0 when all squares are own squares.
   */
  minPricePerSquare: bigint;
  /** True when `pricePerSquare` is below `minPricePerSquare`. */
  priceTooLow: boolean;
  /** Squares with no bid. */
  newCount: number;
  /** Squares with the bid of a different bidder. */
  outbidCount: number;
  /** Squares with the bid of `ownAddress`. */
  ownCount: number;
  /** Squares outside the loaded data. Their bids are not known, so `total` is not final. */
  missingCount: number;
  /** The shapes that the selection takes squares from, by shape ID. */
  cuts: SelectionCut[];
}

/**
 * The prices of a bid on `squares` (GaiaAuction.sol: _takeSquares, with
 * `raiseOwnSquares = false`). `bidOf` gives the current bid of a packed square ID, `isLoaded`
 * tells if the data has that square.
 */
export const priceSelection = (
  squares: readonly Square[],
  bidOf: (squareId: number) => SelectionBid | undefined,
  isLoaded: (squareId: number) => boolean,
  rules: BidRules,
  { ownAddress, pricePerSquare }: PriceOptions,
): PricedSelection => {
  const sorted = sortLocs(squares);
  const floorPerSquare = pricePerSquare ?? 0n;
  const owner = ownAddress?.toLowerCase();
  const costs: bigint[] = [];
  const own: boolean[] = [];
  const cuts = new Map<number, SelectionCut>();
  let total = 0n;
  let minPricePerSquare = 0n;
  let newCount = 0;
  let outbidCount = 0;
  let ownCount = 0;
  let missingCount = 0;

  for (const square of sorted) {
    const squareId = packSquare(square);
    if (!isLoaded(squareId)) {
      missingCount++;
    }
    const bid = bidOf(squareId);
    const isOwn = bid !== undefined && owner !== undefined && bid.bidder.toLowerCase() === owner;
    const amount = bid?.amount ?? 0n;
    const cost = squareCostFor({ amount, own: isOwn }, rules, floorPerSquare, false);
    costs.push(cost);
    own.push(isOwn);
    total += cost;
    if (!isOwn) {
      const minimum = bidAmountFor(amount, rules);
      if (minimum > minPricePerSquare) {
        minPricePerSquare = minimum;
      }
    }
    if (bid === undefined) {
      newCount++;
    } else {
      if (isOwn) {
        ownCount++;
      } else {
        outbidCount++;
      }
      const cut = cuts.get(bid.shapeId);
      if (cut === undefined) {
        cuts.set(bid.shapeId, { shapeId: bid.shapeId, bidder: bid.bidder, squareCount: 1, own: isOwn });
      } else {
        cut.squareCount++;
      }
    }
  }

  return {
    sorted,
    packed: packLocs(sorted),
    costs,
    own,
    total,
    floorPerSquare,
    minPricePerSquare,
    priceTooLow: pricePerSquare !== undefined && pricePerSquare < minPricePerSquare,
    newCount,
    outbidCount,
    ownCount,
    missingCount,
    cuts: [...cuts.values()].sort((a, b) => a.shapeId - b.shapeId),
  };
};
