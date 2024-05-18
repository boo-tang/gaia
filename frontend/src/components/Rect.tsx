import { Rectangle as RectangleType, PathOptions } from 'leaflet';
import React, { useRef } from 'react';
import { Rectangle } from 'react-leaflet';

import { Loc } from '../types';
import { getLocationBounds } from '../utils/location';

const pathOptions = (isSelected: boolean, isOwned: boolean) => {
  return {
    color: 'black',
    opacity: 0.25,
    weight: 2,
    fill: true,
    fillColor: isOwned ? 'green' : isSelected ? 'red' : null,
    fillOpacity: isSelected || isOwned ? 0.5 : 0,
  } as PathOptions;
};

const Rect = ({
  loc,
  toggleLocation,
  isOwned,
  isSelected,
}: {
  loc: Loc;
  toggleLocation: (loc: Loc) => void;
  isOwned: boolean;
  isSelected: boolean;
}) => {
  // get bounds from loc
  const bounds = getLocationBounds(loc);

  const rectRef = useRef() as React.MutableRefObject<RectangleType>;
  const standardStyle = pathOptions(isSelected, isOwned);
  const eventHandlers = {
    mouseover: () => {
      rectRef.current?.setStyle({
        ...standardStyle,
        opacity: 1,
        fillOpacity: isSelected ? 0.75 : 0.5,
        fillColor: isOwned ? 'green' : isSelected ? 'red' : 'white',
      });
    },
    mouseout: () => {
      rectRef.current?.setStyle(standardStyle);
    },
    click: () => {
      if (!isOwned) {
        toggleLocation(loc);
      }
    },
  };

  return (
    <Rectangle
      pathOptions={standardStyle}
      bounds={bounds}
      eventHandlers={eventHandlers}
      ref={rectRef}
    />
  );
};

export default React.memo(Rect);
