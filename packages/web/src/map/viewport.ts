// From the visible map area (degrees) to the grid rectangle of a snapshot request (rows and
// columns, see `Viewport` in packages/core).
import { type Bounds, LNG_COLUMNS, type Viewport, squareAt } from '@gaia/core';

/** Web Mercator (a flat map) ends at this latitude. */
export const MERCATOR_MAX_LAT = 85.0511287798;

// Above this latitude the globe can show a pole, and the visible columns are not one range.
const POLE_LAT = 85;

/**
 * The area plus `fraction` of its height above and below it and of its width on each side.
 * Longitudes are not wrapped (a map shows world copies). Latitudes stop at the poles.
 */
export const padBounds = (bounds: Bounds, fraction = 0.5): Bounds => {
  const latPad = (bounds.north - bounds.south) * fraction;
  const lngPad = (bounds.east - bounds.west) * fraction;
  return {
    south: Math.max(-90, bounds.south - latPad),
    north: Math.min(90, bounds.north + latPad),
    west: bounds.west - lngPad,
    east: bounds.east + lngPad,
  };
};

/**
 * The grid rectangle of a map area. All columns when the area is 360° wide or more, when it
 * reaches a pole region, or when the map shows a pole (`poleInView`). Else `west > east` when the
 * area crosses the antimeridian.
 */
export const boundsToViewport = (bounds: Bounds, poleInView = false): Viewport => {
  const south = squareAt(bounds.south, 0).lat;
  const north = squareAt(bounds.north, 0).lat;
  const allColumns =
    poleInView || bounds.east - bounds.west >= 360 || bounds.north >= POLE_LAT || bounds.south <= -POLE_LAT;
  if (allColumns) {
    return { south, north, west: 0, east: LNG_COLUMNS - 1 };
  }
  return { south, north, west: squareAt(0, bounds.west).lng, east: squareAt(0, bounds.east).lng };
};

/** The part of an area that a flat map can show. */
export const clampToMercator = (bounds: Bounds): Bounds => ({
  ...bounds,
  south: Math.max(bounds.south, -MERCATOR_MAX_LAT),
  north: Math.min(bounds.north, MERCATOR_MAX_LAT),
});
