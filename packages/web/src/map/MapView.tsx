// The map: MapLibre GL (globe, our own style) with the deck.gl layers of layers.ts, on the data of
// the bids store. Loaded lazily (LazyMap.tsx), because MapLibre and deck.gl are large.
import { type Bounds, type Square, describeSquare, packSquare, squareAt } from '@gaia/core';

import type { Map as MapLibreMap, TransformConstrainFunction } from 'maplibre-gl';
// eslint-disable-next-line no-restricted-imports -- the CSS file of the package, not our build
import 'maplibre-gl/dist/maplibre-gl.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  GeolocateControl,
  Map as MapGL,
  type MapLayerMouseEvent,
  type MapRef,
  NavigationControl,
} from 'react-map-gl/maplibre';
import { formatEther } from 'viem';
import { useAccount } from 'wagmi';

import { bidsStore, useBids } from '../bids/useBids';
import { webConfig } from '../config/app-config';
import { DeckOverlay } from './DeckOverlay';
import { type CameraView, browserTimeZone, firstView, readSavedView, saveView } from './first-view';
import { type GaiaStyle, loadGaiaStyle } from './gaia-style';
import { bidRows, buildLayers, gridPaths } from './layers';
import './maplibre-worker';
import { boundsToViewport, padBounds } from './viewport';

export interface MapViewProps {
  /** The selected squares (drawn with a red outline). */
  selected: readonly Square[];
  /** A click on the map: the square under the pointer. */
  onSquareClick: (square: Square) => void;
}

// The time between the end of a move and the snapshot request.
const REQUEST_DELAY_MS = 250;
// Near a pole, MapLibre draws Web Mercator from zoom 12 and the view breaks.
const POLE_MAX_ZOOM = 11.5;

// MapLibre keeps the centre below 85.05°, also on the globe. This lets it go to the poles. A map
// option (not `setTransformConstrain` after the load), so that a first view near a pole stays.
const constrainNearPoles: TransformConstrainFunction = (lngLat, zoom) => ({
  center: lngLat.wrap(),
  zoom: Math.abs(lngLat.lat) > 85 ? Math.min(zoom, POLE_MAX_ZOOM) : zoom,
});

// `localStorage` can throw (blocked site data).
const browserStorage = () => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

// True when a pole is on the visible side of the globe and in the canvas.
const poleInView = (map: MapLibreMap) => {
  const canvas = map.getCanvas();
  const centerLat = map.getCenter().lat;
  return [90, -90].some(lat => {
    if (Math.sign(lat) !== Math.sign(centerLat)) {
      return false;
    }
    const point = map.project([0, lat]);
    return point.x >= 0 && point.y >= 0 && point.x <= canvas.clientWidth && point.y <= canvas.clientHeight;
  });
};

const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

const MapView = ({ selected, onSquareClick }: MapViewProps) => {
  const mapRef = useRef<MapRef>(null);
  const requestTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [gaiaStyle, setGaiaStyle] = useState<GaiaStyle>();
  const [styleError, setStyleError] = useState(false);
  const [initialView] = useState<CameraView>(() => firstView(readSavedView(browserStorage()), browserTimeZone()));
  const [view, setView] = useState<Bounds>();
  const [zoom, setZoom] = useState(initialView.zoom);
  const [globe, setGlobe] = useState(true);
  const [hover, setHover] = useState<Square>();
  const { address } = useAccount();
  const { data, tooMany, serverError, stream } = useBids();

  useEffect(() => {
    let active = true;
    loadGaiaStyle(webConfig.mapStyleUrl).then(
      style => active && setGaiaStyle(style),
      (error: unknown) => {
        console.error(error);
        if (active) {
          setStyleError(true);
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => () => clearTimeout(requestTimer.current), []);

  // After each move: the grid of the visible area, the snapshot request, the saved view.
  const updateView = useCallback(() => {
    const map = mapRef.current?.getMap();
    if (map === undefined) {
      return;
    }
    const b = map.getBounds();
    const padded = padBounds({ south: b.getSouth(), north: b.getNorth(), west: b.getWest(), east: b.getEast() });
    const isGlobe = map.getProjection()?.type === 'globe';
    const center = map.getCenter();
    setZoom(map.getZoom());
    setView(padded);
    setGlobe(isGlobe);
    saveView(browserStorage(), { longitude: center.lng, latitude: center.lat, zoom: map.getZoom() });
    const viewport = boundsToViewport(padded, isGlobe && poleInView(map));
    clearTimeout(requestTimer.current);
    requestTimer.current = setTimeout(() => bidsStore.requestArea(viewport), REQUEST_DELAY_MS);
  }, []);

  const onMouseMove = useCallback((event: MapLayerMouseEvent) => {
    const square = squareAt(event.lngLat.lat, event.lngLat.lng);
    setHover(old => (old !== undefined && old.lat === square.lat && old.lng === square.lng ? old : square));
  }, []);

  const onClick = useCallback(
    (event: MapLayerMouseEvent) => onSquareClick(squareAt(event.lngLat.lat, event.lngLat.lng)),
    [onSquareClick],
  );

  // `data.bids` changes in place: `data.version` tells when.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rows = useMemo(() => bidRows(data.bids, globe), [data.bids, data.version, globe]);
  const grid = useMemo(() => gridPaths(view, globe), [view, globe]);
  const layers = useMemo(
    () =>
      buildLayers({
        rows,
        version: data.version,
        ownAddress: address,
        grid,
        zoom,
        selected,
        hover,
        beforeId: gaiaStyle?.beforeId,
        globe,
      }),
    [rows, data.version, address, grid, zoom, selected, hover, gaiaStyle?.beforeId, globe],
  );

  // The square under the pointer; on a touch screen (no pointer) the selected square.
  const shown = hover ?? selected[0];
  const shownBid = shown === undefined ? undefined : data.bids.get(packSquare(shown));

  return (
    <div className="map-view">
      {gaiaStyle !== undefined && (
        <MapGL
          ref={mapRef}
          initialViewState={initialView}
          mapStyle={gaiaStyle.style}
          projection="globe"
          maxPitch={70}
          onLoad={updateView}
          transformConstrain={constrainNearPoles}
          onMoveEnd={updateView}
          onMouseMove={onMouseMove}
          onMouseOut={() => setHover(undefined)}
          onClick={onClick}
          cursor="pointer"
          style={{ width: '100%', height: '100%' }}
        >
          <NavigationControl position="top-right" visualizePitch />
          <GeolocateControl position="top-right" />
          <DeckOverlay layers={layers} beforeId={gaiaStyle.beforeId} />
        </MapGL>
      )}
      {gaiaStyle === undefined && (
        <p className="map-status">{styleError ? 'Cannot load the map.' : 'Loading the map…'}</p>
      )}
      <div className="map-notices" role="status">
        {stream === 'down' && <p className="map-notice">Live updates failed. Please refresh the page.</p>}
        {tooMany && <p className="map-notice">Zoom in to load the bids.</p>}
        {serverError && <p className="map-notice">Cannot load the bids from the server.</p>}
      </div>
      {shown !== undefined && (
        <p className="map-readout">
          {describeSquare(shown)}
          <br />
          {shownBid === undefined
            ? 'No bid'
            : `${formatEther(shownBid.amount)} ETH · ${shortAddress(shownBid.bidder)}${
                address !== undefined && shownBid.bidder.toLowerCase() === address.toLowerCase() ? ' (you)' : ''
              }`}
        </p>
      )}
    </div>
  );
};

export default MapView;
