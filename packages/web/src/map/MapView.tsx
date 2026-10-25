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
import type { DragSession } from '../selection/drag';
import type { SelectionCell } from '../selection/selection-cells';
import { MAX_SELECTION_SQUARES } from '../selection/selection-store';
import type { SelectionTool } from '../selection/tools';
import { DeckOverlay } from './DeckOverlay';
import { type CameraView, browserTimeZone, firstView, readSavedView, saveView } from './first-view';
import { type GaiaStyle, loadGaiaStyle } from './gaia-style';
import { bidRows, buildLayers, gridPaths } from './layers';
import './maplibre-worker';
import { boundsToViewport, padBounds } from './viewport';

export interface MapViewProps {
  /** The selected squares, with their prices when they are known (useSelectionCells). */
  selection: readonly SelectionCell[];
  /** The active selection tool. */
  tool: SelectionTool;
  /** False on a phone: no selection, a tap shows one square in the readout. */
  selectionEnabled: boolean;
  /** Adds the squares of a drag. Returns false when the selection would be too large. */
  onSelect: (squares: Square[]) => boolean;
  /** A click on a square: removes it when it is selected, else adds it. */
  onToggle: (square: Square) => void;
}

/** The readout line of a selected square. */
const cellText = ({ own, cost }: SelectionCell) => {
  if (own) {
    return 'Your square: 0 ETH';
  }
  if (cost === undefined) {
    return 'Selected';
  }
  return `You bid ${formatEther(cost)} ETH on this square`;
};

interface DragPreview {
  outline: [number, number][][];
  text: string;
}

// The time between the end of a move and the snapshot request.
const REQUEST_DELAY_MS = 250;
// How long the map shows that a drag selected too many squares.
const TOO_LARGE_NOTICE_MS = 4_000;
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
const sameSquare = (a: Square | undefined, b: Square) => a !== undefined && a.lat === b.lat && a.lng === b.lng;

const MapView = ({ selection, tool, selectionEnabled, onSelect, onToggle }: MapViewProps) => {
  const mapRef = useRef<MapRef>(null);
  const requestTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [gaiaStyle, setGaiaStyle] = useState<GaiaStyle>();
  const [styleError, setStyleError] = useState(false);
  const [initialView] = useState<CameraView>(() => firstView(readSavedView(browserStorage()), browserTimeZone()));
  const [view, setView] = useState<Bounds>();
  const [zoom, setZoom] = useState(initialView.zoom);
  const [globe, setGlobe] = useState(true);
  const [hover, setHover] = useState<Square>();
  // On a phone: the tapped square.
  const [marked, setMarked] = useState<Square>();
  const drag = useRef<DragSession>(undefined);
  const [preview, setPreview] = useState<DragPreview>();
  const [tooLarge, setTooLarge] = useState(false);
  const tooLargeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
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

  useEffect(
    () => () => {
      clearTimeout(requestTimer.current);
      clearTimeout(tooLargeTimer.current);
    },
    [],
  );

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

  const selectedCount = selection.length;
  const showDrag = useCallback(
    (session: DragSession) => {
      const tooMany = session.count() + selectedCount > MAX_SELECTION_SQUARES;
      setPreview({
        outline: session.outline(),
        text: tooMany
          ? `${session.describe()}. Too many: select at most ${MAX_SELECTION_SQUARES.toLocaleString('en-US')}.`
          : session.describe(),
      });
    },
    [selectedCount],
  );

  const onMouseMove = useCallback(
    (event: MapLayerMouseEvent) => {
      const square = squareAt(event.lngLat.lat, event.lngLat.lng);
      setHover(old => (sameSquare(old, square) ? old : square));
      const session = drag.current;
      if (session !== undefined) {
        session.update(square);
        showDrag(session);
      }
    },
    [showDrag],
  );

  const select = useCallback(
    (squares: Square[]) => {
      if (!onSelect(squares)) {
        setTooLarge(true);
        clearTimeout(tooLargeTimer.current);
        tooLargeTimer.current = setTimeout(() => setTooLarge(false), TOO_LARGE_NOTICE_MS);
      }
    },
    [onSelect],
  );

  // Removes the window listeners of the current drag.
  const endDrag = useRef<() => void>(undefined);
  useEffect(() => () => endDrag.current?.(), []);

  // A selection tool: the drag starts on the map and ends at a mouse-up anywhere in the page. The
  // listeners are added here, not in an effect, so a fast click does not end before they exist.
  // Ctrl or Cmd + drag turns the map (MapLibre), so it does not select.
  const onMouseDown = useCallback(
    (event: MapLayerMouseEvent) => {
      const { button, ctrlKey, metaKey } = event.originalEvent;
      if (!selectionEnabled || tool.begin === undefined || button !== 0 || ctrlKey || metaKey) {
        return;
      }
      endDrag.current?.();
      const session = tool.begin(squareAt(event.lngLat.lat, event.lngLat.lng));
      drag.current = session;
      showDrag(session);

      const stop = () => {
        window.removeEventListener('mouseup', onMouseUp);
        window.removeEventListener('keydown', onKeyDown);
        endDrag.current = undefined;
        drag.current = undefined;
        setPreview(undefined);
      };
      const onMouseUp = () => {
        stop();
        // A drag that stays in one square is a click.
        const squares = session.squares();
        if (squares.length === 1) {
          onToggle(squares[0]);
        } else {
          select(squares);
        }
      };
      const onKeyDown = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key === 'Escape') {
          stop();
        }
      };
      window.addEventListener('mouseup', onMouseUp);
      window.addEventListener('keydown', onKeyDown);
      endDrag.current = stop;
    },
    [selectionEnabled, tool, showDrag, select, onToggle],
  );

  // A click with the pan tool selects or deselects the square (MapLibre sends no click after a
  // pan). A selection tool does it at the mouse-up of its drag. On a phone a tap only shows the
  // square.
  const onClick = useCallback(
    (event: MapLayerMouseEvent) => {
      const square = squareAt(event.lngLat.lat, event.lngLat.lng);
      if (!selectionEnabled) {
        setMarked(old => (sameSquare(old, square) ? undefined : square));
      } else if (tool.panOnDrag) {
        onToggle(square);
      }
    },
    [selectionEnabled, tool, onToggle],
  );

  const cellIndex = useMemo(() => new Map(selection.map((cell, i) => [packSquare(cell.square), i])), [selection]);

  // `data.bids` changes in place: `data.bidsVersion` tells when.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rows = useMemo(() => bidRows(data.bids, globe), [data.bids, data.bidsVersion, globe]);
  const grid = useMemo(() => gridPaths(view, globe), [view, globe]);
  const layers = useMemo(
    () =>
      buildLayers({
        rows,
        bidsVersion: data.bidsVersion,
        ownAddress: address,
        grid,
        zoom,
        selection,
        preview: preview?.outline,
        hover,
        marked,
        beforeId: gaiaStyle?.beforeId,
        globe,
      }),
    [rows, data.bidsVersion, address, grid, zoom, selection, preview, hover, marked, gaiaStyle?.beforeId, globe],
  );

  // The square under the pointer; on a touch screen (no pointer) the tapped square.
  const shown = hover ?? marked;
  const shownBid = shown === undefined ? undefined : data.bids.get(packSquare(shown));
  const shownCell = shown === undefined ? undefined : selection[cellIndex.get(packSquare(shown)) ?? -1];
  const dragPan = !selectionEnabled || tool.panOnDrag;

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
          onMouseDown={onMouseDown}
          onClick={onClick}
          dragPan={dragPan}
          boxZoom={dragPan}
          cursor={selectionEnabled ? tool.cursor : undefined}
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
        {tooLarge && (
          <p className="map-notice">
            Too many squares. Select at most {MAX_SELECTION_SQUARES.toLocaleString('en-US')}.
          </p>
        )}
      </div>
      {preview !== undefined && <p className="map-readout">{preview.text}</p>}
      {preview === undefined && shown !== undefined && (
        <p className="map-readout">
          {describeSquare(shown)}
          <br />
          {shownBid === undefined
            ? 'No bid'
            : `${formatEther(shownBid.amount)} ETH · ${shortAddress(shownBid.bidder)}${
                address !== undefined && shownBid.bidder.toLowerCase() === address.toLowerCase() ? ' (you)' : ''
              }`}
          {shownCell !== undefined && (
            <>
              <br />
              {cellText(shownCell)}
            </>
          )}
        </p>
      )}
    </div>
  );
};

export default MapView;
