// The chunk rule of GaiaAuction.settleShape(shapeId, maxSquares).
//
// A shape settles row by row, from south to north. `shapeSettleCursor(shapeId)` is the next row
// to settle, relative to the first row of the shape. A chunk adds whole rows until it has at
// least `maxSquares` squares, so a chunk always continues to the end of its row. Thus
// `maxSquares` is not a strict limit: the widest row of a shape must settle in one call.
// `maxSquares = 0` settles all rows in one call.
import { LNG_COLUMNS } from './grid';

export interface SettleChunk {
  /** First row of the chunk (the cursor before the call). */
  fromRow: number;
  /** The row after the last row of the chunk (the cursor after the call). */
  toRow: number;
  /** Number of squares that the chunk settles. */
  squares: number;
  /** True if this is the last chunk. The country then goes to the winner. */
  last: boolean;
}

/**
 * The number of squares in a row range, from `first` to `last` (both included). The range can
 * cross the antimeridian (for example 35998 to 1 is 4 squares).
 */
export const rangeWidth = (first: number, last: number): number => ((last - first + LNG_COLUMNS) % LNG_COLUMNS) + 1;

/**
 * The row widths of a shape, from its row ranges. `undefined` is an empty row (the shape lost all
 * squares of the row).
 */
export const rowWidthsFromRanges = (ranges: readonly ({ first: number; last: number } | undefined)[]): number[] =>
  ranges.map(range => (range === undefined ? 0 : rangeWidth(range.first, range.last)));

/**
 * The next `settleShape` chunk. `rowWidths[r]` is the number of squares that the shape holds in
 * row r (0 for an empty row). `cursor` is `shapeSettleCursor(shapeId)`. Returns `undefined` if
 * the shape is settled (the contract reverts with `ShapeAlreadySettled`) or holds no squares.
 */
export const settleChunk = (rowWidths: readonly number[], maxSquares: number, cursor = 0): SettleChunk | undefined => {
  const loRow = rowWidths.findIndex(width => width > 0);
  if (loRow < 0) {
    return undefined;
  }
  let hiRow = rowWidths.length - 1;
  while (rowWidths[hiRow] === 0) {
    hiRow--;
  }

  const fromRow = Math.max(cursor, loRow);
  if (fromRow > hiRow) {
    return undefined;
  }

  let toRow = fromRow;
  let squares = 0;
  while (toRow <= hiRow) {
    squares += rowWidths[toRow];
    toRow++;
    if (maxSquares !== 0 && squares >= maxSquares) {
      break;
    }
  }
  return { fromRow, toRow, squares, last: toRow > hiRow };
};

/** All `settleShape` chunks of a shape, from `cursor` to the end. */
export const settlePlan = (rowWidths: readonly number[], maxSquares: number, cursor = 0): SettleChunk[] => {
  const chunks: SettleChunk[] = [];
  let chunk = settleChunk(rowWidths, maxSquares, cursor);
  while (chunk !== undefined) {
    chunks.push(chunk);
    chunk = chunk.last ? undefined : settleChunk(rowWidths, maxSquares, chunk.toRow);
  }
  return chunks;
};
