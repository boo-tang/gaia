// The outlines of groups of squares (a selection, the shapes of the bids): the edges between a square
// of a group and a square that is not in the same group. The map draws them as lines over the squares.
import { LAT_ROWS, LNG_COLUMNS, packSquare, squareBounds, unpackSquare } from '@gaia/core';

/** A line between two `[lng, lat]` points in degrees. */
export type Edge = [[number, number], [number, number]];

/** One outline edge and the group that it belongs to. */
export interface OutlineEdge {
  path: Edge;
  group: number;
}

/**
 * The outline edges of the squares of `groups` (key: the packed square ID, value: its group). An
 * edge is in the outline when the square on its other side is in a different group or in none.
 * Two touching groups each get their edge, so each group has a closed outline.
 */
export const outlineEdges = (groups: ReadonlyMap<number, number>): OutlineEdge[] => {
  const edges: OutlineEdge[] = [];
  const other = (lat: number, lng: number, group: number) =>
    groups.get(packSquare({ lat, lng: (lng + LNG_COLUMNS) % LNG_COLUMNS })) !== group;
  for (const [squareId, group] of groups) {
    const square = unpackSquare(squareId);
    const { lat, lng } = square;
    const { south, west, north, east } = squareBounds(square);
    const add = (path: Edge) => edges.push({ path, group });
    if (lat === LAT_ROWS - 1 || other(lat + 1, lng, group)) {
      add([
        [west, north],
        [east, north],
      ]);
    }
    if (lat === 0 || other(lat - 1, lng, group)) {
      add([
        [west, south],
        [east, south],
      ]);
    }
    if (other(lat, lng + 1, group)) {
      add([
        [east, south],
        [east, north],
      ]);
    }
    if (other(lat, lng - 1, group)) {
      add([
        [west, south],
        [west, north],
      ]);
    }
  }
  return edges;
};
