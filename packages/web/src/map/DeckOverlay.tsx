// deck.gl in MapLibre's own WebGL context ("interleaved"): our layers go into the map's layer
// order (under the place names) and move in the same frame as the map. Use `MapLibreOverlay` of
// `@deck.gl/maplibre`. `MapboxOverlay` of `@deck.gl/mapbox` reads `map.transform`, which
// MapLibre 6 does not have, and its interleaved mode crashes.
import { MapLibreOverlay, type MapLibreOverlayProps } from '@deck.gl/maplibre';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { useControl } from 'react-map-gl/maplibre';

import { placeDepthClear } from './clear-depth';

type DeckOverlayProps = MapLibreOverlayProps & { beforeId?: string };

export const DeckOverlay = ({ beforeId, ...props }: DeckOverlayProps) => {
  const mapRef = useRef<MapLibreMap | undefined>(undefined);
  const overlay = useControl<MapLibreOverlay>(({ map }) => {
    mapRef.current = map.getMap();
    return new MapLibreOverlay({ ...props, interleaved: true });
  });

  useEffect(() => {
    overlay.setProps(props);
    // deck.gl can add or move its layer group at each update: put the depth clear before it.
    if (mapRef.current !== undefined) {
      placeDepthClear(mapRef.current, beforeId);
    }
  });

  return null;
};
