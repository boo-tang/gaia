export const NetworkContextName = "NETWORK";

export const COOR_PRECISION = 100;

// Number of longitude columns on chain (GaiaAuction.sol: LOC_MAX_LNG). Column 0 is east of the
// last column: longitude wraps at the antimeridian.
export const LNG_COLUMNS = 360 * COOR_PRECISION;
