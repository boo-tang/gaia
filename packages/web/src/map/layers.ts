// The deck.gl layers of the map: bids, grid, selection, drag preview and hover square. deck.gl draws them in
// MapLibre's canvas (interleaved), under the place names (`beforeId`).
import { type Bounds, type Square, gridLines, squareBounds, unpackSquare } from '@gaia/core';

import { PathLayer, PolygonLayer, SolidPolygonLayer } from '@deck.gl/layers';

import type { HeldBid } from '../bids/bids-reducer';
import type { SelectionCell } from '../selection/selection-cells';
import { bidderColor } from './bidder-colors';
import { MERCATOR_MAX_LAT, clampToMercator } from './viewport';

type Ring = [number, number][];

/** One square with a bid: the packed square ID and the bid. */
export type BidRow = readonly [number, HeldBid];

/** The layer IDs. The 3D view and the shape selection use the same layers. */
export const LAYER_IDS = {
  bids: 'bids',
  grid: 'grid',
  selection: 'selection',
  preview: 'preview',
  hover: 'hover',
} as const;

const SELECTION_RED = [220, 38, 38] as const;
const OWN_GREEN = [22, 163, 74] as const;

/**
 * The fill of each selected square: green for own squares, else red with an alpha from 40 (the
 * lowest cost of the selection) to 160 (the highest), so the expensive squares show. A square
 * with no price gets alpha 100.
 */
export const selectionFill = (cells: readonly SelectionCell[]) => {
  let low: bigint | undefined;
  let high: bigint | undefined;
  for (const { cost, own } of cells) {
    if (!own && cost !== undefined) {
      low = low === undefined || cost < low ? cost : low;
      high = high === undefined || cost > high ? cost : high;
    }
  }
  return ({ cost, own }: SelectionCell): [number, number, number, number] => {
    if (own) {
      return [...OWN_GREEN, 90];
    }
    if (cost === undefined || low === undefined || high === undefined || high === low) {
      return [...SELECTION_RED, 100];
    }
    return [...SELECTION_RED, 40 + Math.round((Number(cost - low) / Number(high - low)) * 120)];
  };
};

const ring = (square: Square): Ring => {
  const b = squareBounds(square);
  return [
    [b.west, b.south],
    [b.east, b.south],
    [b.east, b.north],
    [b.west, b.north],
  ];
};

// A square beyond ±85.0511° has no place on a flat map: deck.gl would draw it far outside the
// map. On the globe all rows show.
const onFlatMap = (square: Square) => {
  const b = squareBounds(square);
  return b.south >= -MERCATOR_MAX_LAT && b.north <= MERCATOR_MAX_LAT;
};

/** The squares with a bid that the map can show. Make it again only when the bids change. */
export const bidRows = (bids: ReadonlyMap<number, HeldBid>, globe: boolean): BidRow[] => {
  const rows: BidRow[] = [];
  for (const row of bids) {
    if (globe || onFlatMap(unpackSquare(row[0]))) {
      rows.push(row);
    }
  }
  return rows;
};

/** The grid lines of `view` (the padded visible area). At most 800 lines in each direction. */
export const gridPaths = (view: Bounds | undefined, globe: boolean): Ring[] => {
  if (view === undefined) {
    return [];
  }
  const area = globe ? view : clampToMercator(view);
  if (area.south >= area.north) {
    return [];
  }
  const { lats, lngs } = gridLines(area, 800);
  const paths: Ring[] = [];
  for (const lat of lats) {
    paths.push([
      [area.west, lat],
      [area.east, lat],
    ]);
  }
  for (const lng of lngs) {
    paths.push([
      [lng, area.south],
      [lng, area.north],
    ]);
  }
  return paths;
};

/** The grid fades in from zoom 9 (alpha 0) to zoom 14 (alpha 0.35 of 255). */
export const gridAlpha = (zoom: number) => Math.round(255 * Math.max(0, Math.min(0.35, ((zoom - 9) / 5) * 0.35)));

// `@deck.gl/maplibre` reads `beforeId` from each layer. Its props type is not exported.
type OverlayProps = { beforeId?: string };

// Draw on the map surface without the depth test. With the depth test, flat layers fight the
// globe surface for depth (stripes), and the grid lines disappear.
const FLAT = { depthCompare: 'always', depthWriteEnabled: false } as const;

export interface LayerInput {
  rows: BidRow[];
  /** Changes when `rows` or the bid colours change. */
  bidsVersion: number;
  /** The connected wallet, for its own colour. */
  ownAddress?: string;
  grid: Ring[];
  zoom: number;
  selection: readonly SelectionCell[];
  /** The outline of the drag of a selection tool, in degrees. */
  preview?: [number, number][][];
  hover?: Square;
  /** A square with an outline as the hover square (on a phone: the tapped square). */
  marked?: Square;
  /** The first symbol layer of the style: our layers go under it. */
  beforeId?: string;
  globe: boolean;
  /** 3D view: each square is a column, its height is the bid (ETH) times this scale. */
  metersPerEth?: number;
}

export const buildLayers = ({
  rows,
  bidsVersion,
  ownAddress,
  grid,
  zoom,
  selection,
  preview = [],
  hover,
  marked,
  beforeId,
  globe,
  metersPerEth,
}: LayerInput) => {
  const extruded = metersPerEth !== undefined;
  const alpha = gridAlpha(zoom);
  const shown = (square: Square) => globe || onFlatMap(square);
  return [
    new SolidPolygonLayer<BidRow, OverlayProps>({
      id: LAYER_IDS.bids,
      data: rows,
      getPolygon: ([squareId]) => ring(unpackSquare(squareId)),
      getFillColor: ([, bid]) => [...bidderColor(bid.bidder, ownAddress), extruded ? 230 : 140],
      extruded,
      getElevation: ([, bid]) => (extruded ? (Number(bid.amount) / 1e18) * metersPerEth : 0),
      pickable: extruded,
      updateTriggers: { getFillColor: [bidsVersion, ownAddress, extruded], getElevation: [bidsVersion, metersPerEth] },
      // Columns need the depth test, so that near columns hide far ones.
      parameters: extruded ? {} : FLAT,
      beforeId,
    }),
    new PathLayer<Ring, OverlayProps>({
      id: LAYER_IDS.grid,
      data: grid,
      visible: alpha > 0,
      getPath: path => path,
      getColor: [17, 24, 39, alpha],
      getWidth: 1,
      widthUnits: 'pixels',
      updateTriggers: { getColor: alpha },
      parameters: FLAT,
      beforeId,
    }),
    // A new `selection` array at each change of the selection or its prices: deck.gl computes
    // the attributes again (at most MAX_SELECTION_SQUARES squares).
    new PolygonLayer<SelectionCell, OverlayProps>({
      id: LAYER_IDS.selection,
      data: selection.filter(cell => shown(cell.square)),
      getPolygon: cell => ring(cell.square),
      getFillColor: selectionFill(selection),
      getLineColor: [...SELECTION_RED, 255],
      getLineWidth: 2,
      lineWidthUnits: 'pixels',
      stroked: true,
      parameters: FLAT,
      beforeId,
    }),
    new PathLayer<[number, number][], OverlayProps>({
      id: LAYER_IDS.preview,
      data: preview,
      getPath: path => path,
      getColor: [...SELECTION_RED, 255],
      getWidth: 2,
      widthUnits: 'pixels',
      parameters: FLAT,
      beforeId,
    }),
    new PolygonLayer<Square, OverlayProps>({
      id: LAYER_IDS.hover,
      data: [hover, marked].filter((square): square is Square => square !== undefined && shown(square)),
      getPolygon: ring,
      filled: false,
      stroked: true,
      getLineColor: [17, 24, 39, 255],
      getLineWidth: 2,
      lineWidthUnits: 'pixels',
      parameters: FLAT,
      beforeId,
    }),
  ];
};
