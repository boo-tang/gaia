import { Rectangle as RectangleType, PathOptions } from 'leaflet';
import React, { useRef } from 'react';
import { Rectangle, Tooltip } from 'react-leaflet';

import { Loc } from '../../types';
import { getLocationBounds } from '../../utils/location';
import { CellViewModel } from './types';

const pathOptions = (viewModel: CellViewModel, selected: boolean): PathOptions => ({
  color: selected ? 'red' : 'black',
  weight: selected ? 3 : 1,
  opacity: selected ? 0.9 : 0.25,
  fill: true,
  fillColor: viewModel.fillColor ?? undefined,
  fillOpacity: viewModel.fillColor ? viewModel.fillOpacity ?? 0.5 : 0,
});

const GridCell = ({
  loc,
  viewModel,
  selected,
  disabled,
  onClick,
}: {
  loc: Loc;
  viewModel: CellViewModel;
  selected: boolean;
  disabled: boolean;
  onClick?: (loc: Loc) => void;
}) => {
  const bounds = getLocationBounds(loc);

  const rectRef = useRef() as React.MutableRefObject<RectangleType>;
  const standardStyle = pathOptions(viewModel, selected);
  const eventHandlers = {
    mouseover: () => {
      if (disabled) return;
      rectRef.current?.setStyle({
        ...standardStyle,
        opacity: 1,
        fillOpacity: (standardStyle.fillOpacity ?? 0) > 0 ? 0.75 : 0.3,
        fillColor: viewModel.fillColor ?? 'white',
      });
    },
    mouseout: () => {
      rectRef.current?.setStyle(standardStyle);
    },
    click: () => {
      if (!disabled) onClick?.(loc);
    },
  };

  return (
    <Rectangle
      pathOptions={standardStyle}
      bounds={bounds}
      eventHandlers={eventHandlers}
      ref={rectRef}
    >
      {viewModel.tooltip && <Tooltip>{viewModel.tooltip}</Tooltip>}
    </Rectangle>
  );
};

export default React.memo(GridCell);
