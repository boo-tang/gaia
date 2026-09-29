import { useEffect, useState } from 'react';
import { useMapEvents } from 'react-leaflet';

import { Loc } from '../../types';
import GridCell from './GridCell';
import { CellViewModel } from './types';
import { getGridInBounds } from './viewportGrid';

// Renders the world as a grid of clickable squares. Knows nothing about auctions, bids, or
// ownership — callers supply per-square styling, so this same layer can be reused for the
// post-auction map (finalized countries, flat-fee availability) without changes.
const GridLayer = ({
  getCellViewModel,
  isSelected,
  isDisabled,
  onCellClick,
  onVisibleLocsChange,
  minZoom = 11,
}: {
  getCellViewModel: (loc: Loc) => CellViewModel;
  isSelected?: (loc: Loc) => boolean;
  isDisabled?: (loc: Loc) => boolean;
  onCellClick?: (loc: Loc) => void;
  onVisibleLocsChange?: (locs: Loc[]) => void;
  minZoom?: number;
}) => {
  const [showGrid, setShowGrid] = useState(true);
  const map = useMapEvents({
    zoomend: () => {
      if (map.getZoom() < minZoom) {
        setShowGrid(false);
      } else if (!showGrid) {
        setShowGrid(true);
      }
    },
    moveend: () => {
      if (!showGrid) return;
      setLocs(getGridInBounds(map.getBounds()));
    },
  });
  const [locs, setLocs] = useState(getGridInBounds(map.getBounds()));

  useEffect(() => {
    onVisibleLocsChange?.(locs);
  }, [locs, onVisibleLocsChange]);

  if (!showGrid) {
    return null;
  }

  return (
    <>
      {locs.map((loc) => (
        <GridCell
          key={`${loc.lat}-${loc.lng}`}
          loc={loc}
          viewModel={getCellViewModel(loc)}
          selected={isSelected?.(loc) ?? false}
          disabled={isDisabled?.(loc) ?? false}
          onClick={onCellClick}
        />
      ))}
    </>
  );
};

export default GridLayer;
