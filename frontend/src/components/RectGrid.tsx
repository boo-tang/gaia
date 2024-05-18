import { useMemo, useState } from 'react';
import { useMapEvents } from 'react-leaflet';
import { round as _round } from 'lodash';

import { COOR_PRECISION } from '../constants';
import Rect from './Rect';
import { LatLngBounds } from 'leaflet';
import { Loc, LocTuple } from '../types';
import { fromCoorToUint } from '../utils/location';

export const TILE_WIDTH = 1 / COOR_PRECISION;

const roundLoc = (num: number) =>
  Math.round((num + Number.EPSILON) * COOR_PRECISION) / COOR_PRECISION;

const getGridInBounds = (bounds: LatLngBounds) => {
  const locs = [];
  // we calculate which grid locations to render given the current map bounds
  const southWest = bounds.getSouthWest();
  const northEast = bounds.getNorthEast();

  // get lng bounds and add 1 sq on each size
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
      const loc = {
        lat,
        lng,
      };
      locs.push(loc);
      lat += TILE_WIDTH;
    }
    lng += TILE_WIDTH;
  }

  return locs;
};

const RectGrid = ({
  userLocations = [],
  selectedLocations = [],
  toggleLocation,
  mapReady,
}: {
  userLocations: Loc[];
  selectedLocations: Loc[];
  toggleLocation: (loc: Loc) => void;
  mapReady: boolean;
}) => {
  const [showGrid, changeShowGrid] = useState(true);
  const map = useMapEvents({
    zoomend: () => {
      console.log('zoom: ', map.getZoom());
      if (map.getZoom() < 11) {
        changeShowGrid(false);
      } else if (!showGrid) {
        changeShowGrid(true);
      }
    },
    moveend: () => {
      if (!showGrid) return;
      const _locs = getGridInBounds(map.getBounds());
      setLocs(_locs);
    },
  });
  const [locs, setLocs] = useState(getGridInBounds(map.getBounds()));

  const ownedLocsSet = useMemo(
    () => new Set(userLocations.map(({ lat, lng }) => `${lat}.${lng}`)),
    [userLocations],
  );
  const selectedLocsSet = useMemo(
    () =>
      new Set(
        selectedLocations.map((loc: Loc) => {
          const intLoc = fromCoorToUint(loc);
          return `${intLoc.lat}.${intLoc.lng}`;
        }),
      ),
    [selectedLocations],
  );

  // useEffect(() => {
  //   if (!mapReady) {
  //     return
  //   }
  //   const calculateNewGrid = () => {
  //     if (!showGrid) return
  //     const _locs = getGridInBounds(map.getBounds(), setLocs)
  //     setLocs(_locs)
  //   }
  //   calculateNewGrid()
  // }, [mapReady, map, showGrid])

  // QUICK FIX, don't render if number of locations is too big
  // it's a bug with zooming in/out and getting the wrong bounds
  if (!showGrid || locs.length > 5000) {
    return null;
  }

  console.log('selectedLocations: ', selectedLocations);
  console.log('ownedLocsSet: ', userLocations);

  return (
    <>
      {locs.map((loc) => {
        const intLoc = fromCoorToUint(loc);
        let isOwned = ownedLocsSet.has(`${intLoc.lat}.${intLoc.lng}`);
        let isSelected = selectedLocsSet.has(`${intLoc.lat}.${intLoc.lng}`);

        return (
          <Rect
            loc={loc}
            key={`${loc.lat}-${loc.lng}`}
            toggleLocation={toggleLocation}
            isOwned={isOwned}
            isSelected={isSelected}
          />
        );
      })}
    </>
  );
};

export default RectGrid;
