// The Gaia square grid, independent of any map library.
//
// A square is (lat, lng) in 1/100 degree, the same values as the contracts
// (contracts/interfaces/GaiaTypes.sol). The values are the south-west corner of the square:
// row 0 starts at 90°S, row 17999 ends at 90°N, column 0 starts at 180°W. Longitude wraps:
// column 35999 and column 0 are neighbours.

export const PRECISION = 100;
export const LAT_ROWS = 180 * PRECISION; // 18,000
export const LNG_COLUMNS = 360 * PRECISION; // 36,000

export interface Square {
  lat: number;
  lng: number;
}

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

const wrapColumn = (column: number) => ((column % LNG_COLUMNS) + LNG_COLUMNS) % LNG_COLUMNS;

/** The square that contains a map point. `lngDeg` can be outside -180..180 (world copies). */
export const squareAt = (latDeg: number, lngDeg: number): Square => ({
  lat: Math.min(LAT_ROWS - 1, Math.max(0, Math.floor((latDeg + 90) * PRECISION))),
  lng: wrapColumn(Math.floor((lngDeg + 180) * PRECISION)),
});

/** The edges of a square in degrees, from its south-west corner. */
export const squareBounds = ({ lat, lng }: Square): Bounds => ({
  south: lat / PRECISION - 90,
  west: lng / PRECISION - 180,
  north: (lat + 1) / PRECISION - 90,
  east: (lng + 1) / PRECISION - 180,
});

/** The contract packing, `(lat << 16) | lng`. Also a good map key. */
export const packSquare = ({ lat, lng }: Square) => lat * 65536 + lng;
export const unpackSquare = (key: number): Square => ({ lat: Math.floor(key / 65536), lng: key % 65536 });

/**
 * The grid lines inside `bounds`, in degrees. Integer steps, so no floating-point drift. Returns
 * no lines in a direction when there are more than `maxLines` (too dense to see).
 */
export const gridLines = (bounds: Bounds, maxLines = 400): { lats: number[]; lngs: number[] } => {
  const first = (deg: number, offset: number) => Math.ceil((deg + offset) * PRECISION);
  const last = (deg: number, offset: number) => Math.floor((deg + offset) * PRECISION);

  const latFrom = Math.max(0, first(bounds.south, 90));
  const latTo = Math.min(LAT_ROWS, last(bounds.north, 90));
  const lngFrom = first(bounds.west, 180);
  const lngTo = last(bounds.east, 180);

  const lats: number[] = [];
  if (latTo - latFrom <= maxLines) {
    for (let i = latFrom; i <= latTo; i++) lats.push(i / PRECISION - 90);
  }
  // Longitudes are not wrapped here: a map shows world copies at -540..540, and each copy needs
  // its own lines.
  const lngs: number[] = [];
  if (lngTo - lngFrom <= maxLines) {
    for (let i = lngFrom; i <= lngTo; i++) lngs.push(i / PRECISION - 180);
  }
  return { lats, lngs };
};

export const describeSquare = (square: Square) => {
  const b = squareBounds(square);
  return `row ${square.lat}, column ${square.lng} (SW corner ${b.south.toFixed(2)}°, ${b.west.toFixed(2)}°) · packed ${packSquare(square)}`;
};
