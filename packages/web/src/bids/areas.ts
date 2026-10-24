// Grid rectangles (`Viewport` of packages/core, rows and columns of the contracts): which squares
// a rectangle holds, and which rectangle holds another. A rectangle with `west > east` crosses
// the antimeridian.
import { LNG_COLUMNS, type Viewport, unpackSquare } from '@gaia/core';

type ColumnRange = [number, number];

// The columns of a rectangle as one or two ranges that do not cross the antimeridian.
const columnRanges = ({ west, east }: Viewport): ColumnRange[] => {
  if (west <= east) {
    return [[west, east]];
  }
  return [
    [west, LNG_COLUMNS - 1],
    [0, east],
  ];
};

/** True when the square `squareId` (packed) is in `viewport`. */
export const viewportHolds = (viewport: Viewport, squareId: number) => {
  const { lat, lng } = unpackSquare(squareId);
  if (lat < viewport.south || lat > viewport.north) {
    return false;
  }
  return columnRanges(viewport).some(([from, to]) => lng >= from && lng <= to);
};

/** True when each square of `inner` is in `outer`. */
export const viewportContains = (outer: Viewport, inner: Viewport) => {
  if (inner.south < outer.south || inner.north > outer.north) {
    return false;
  }
  const outerRanges = columnRanges(outer);
  return columnRanges(inner).every(([from, to]) =>
    outerRanges.some(([outerFrom, outerTo]) => from >= outerFrom && to <= outerTo),
  );
};
