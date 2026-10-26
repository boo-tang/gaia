// The drawing of a selection tool: the map gives it the square under the pointer, and it gives the
// preview and the squares at the end. No map library here.
import { type Square, rectangleBetween, rectangleOutline, rectangleSize, rectangleSquares } from '@gaia/core';

export interface DrawSession {
  /** The square under the pointer changed. */
  update: (square: Square) => void;
  /** The preview: lines of `[lng, lat]` points in degrees. */
  outline: () => [number, number][][];
  /** The number of squares at the end of the drawing now. */
  count: () => number;
  /** A short text for the readout, for example "12 rows × 20 columns = 240 squares". */
  describe: () => string;
  /** The squares at the end of the drawing. */
  squares: () => Square[];
}

const plural = (count: number, word: string) => `${count.toLocaleString('en-US')} ${word}${count === 1 ? '' : 's'}`;

/** A rectangle from the start square to the square under the pointer. */
export const rectangleSession = (start: Square): DrawSession => {
  let end = start;
  const rect = () => rectangleBetween(start, end);
  return {
    update: square => {
      end = square;
    },
    outline: () => [rectangleOutline(rect())],
    count: () => rectangleSize(rect()).count,
    describe: () => {
      const { rows, columns, count } = rectangleSize(rect());
      return `${plural(rows, 'row')} × ${plural(columns, 'column')} = ${plural(count, 'square')}`;
    },
    squares: () => rectangleSquares(rect()),
  };
};
