// From the visible map area (degrees) to the grid rectangle of a snapshot request (rows and
// columns, see `Viewport` in packages/core).
import { type Bounds, LNG_COLUMNS, PRECISION, type Viewport, squareAt } from '@gaia/core';

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

/**
 * The area of a grid rectangle in degrees, from the south-west corner of its first square to the
 * north-east corner of its last square. Across the antimeridian (`west > east`) the east edge is
 * above 180°, so that a fit to the area does not go around the globe the wrong way.
 */
export const viewportToBounds = (area: Viewport): Bounds => {
  const west = area.west / PRECISION - 180;
  const columns = ((area.east - area.west + LNG_COLUMNS) % LNG_COLUMNS) + 1;
  return {
    south: area.south / PRECISION - 90,
    north: (area.north + 1) / PRECISION - 90,
    west,
    east: west + columns / PRECISION,
  };
};

// The map tile size of MapLibre: at zoom z the world is 512 * 2^z pixels wide.
const TILE_SIZE = 512;

/**
 * The centre and the zoom that show `bounds` in a map of `width` x `height` pixels with `padding`
 * on each side, with the Web Mercator scale at the centre (the globe uses it too). Not
 * `fitBounds`: it stops the area at 85.05°, so it cannot show a shape near a pole.
 */
export const cameraForBounds = (
  bounds: Bounds,
  size: { width: number; height: number },
  padding: number,
  maxZoom: number,
): { center: [number, number]; zoom: number } => {
  const lat = (bounds.south + bounds.north) / 2;
  const width = Math.max(1, size.width - 2 * padding);
  const height = Math.max(1, size.height - 2 * padding);
  const lngZoom = Math.log2((width * 360) / (TILE_SIZE * (bounds.east - bounds.west)));
  const latZoom = Math.log2(
    (height * 360 * Math.cos((lat * Math.PI) / 180)) / (TILE_SIZE * (bounds.north - bounds.south)),
  );
  return { center: [(bounds.west + bounds.east) / 2, lat], zoom: Math.min(maxZoom, lngZoom, latZoom) };
};
