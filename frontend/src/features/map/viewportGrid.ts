import { LatLngBounds } from 'leaflet';
import { round as _round } from 'lodash';

import { COOR_PRECISION } from '../../constants';
import { Loc } from '../../types';

export const TILE_WIDTH = 1 / COOR_PRECISION;

const roundLoc = (num: number) =>
  Math.round((num + Number.EPSILON) * COOR_PRECISION) / COOR_PRECISION;

// Computes the grid of map squares visible within `bounds`, padded by one square on each side.
export const getGridInBounds = (bounds: LatLngBounds): Loc[] => {
  const locs: Loc[] = [];
  const southWest = bounds.getSouthWest();
  const northEast = bounds.getNorthEast();

  const lngStart = roundLoc(southWest.lng) - roundLoc(1 / COOR_PRECISION);
  const lngEnd = roundLoc(northEast.lng) + roundLoc(1 / COOR_PRECISION);

  const latStart = roundLoc(southWest.lat) - roundLoc(1 / COOR_PRECISION);
  const latEnd = roundLoc(northEast.lat) + roundLoc(1 / COOR_PRECISION);

  const lngGridLength = Math.abs(
    _round(lngStart * COOR_PRECISION - lngEnd * COOR_PRECISION),
  );
  const latGridLength = Math.abs(
    _round(latStart * COOR_PRECISION - latEnd * COOR_PRECISION),
  );

  let lng = lngStart;
  for (let i = 0; i < lngGridLength; i++) {
    let lat = latStart;
    for (let j = 0; j < latGridLength; j++) {
      locs.push({ lat, lng });
      lat += TILE_WIDTH;
    }
    lng += TILE_WIDTH;
  }

  return locs;
};
