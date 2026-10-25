// The selected squares as the map draws them: with their prices when the bid has them, else
// with no price (for example while the rules of `GET /auction` load).
import { type PricedSelection, type Square, unpackSquare } from '@gaia/core';

/** One selected square and what the bid pays for it. */
export interface SelectionCell {
  square: Square;
  /** Undefined while the price is not known. */
  cost?: bigint;
  /** The square of the connected wallet: it costs 0. */
  own: boolean;
}

/** The cells of the selection. `priced` is used when it is there. */
export const selectionCells = (
  squareIds: ReadonlySet<number>,
  priced: PricedSelection | undefined,
): SelectionCell[] => {
  if (priced !== undefined) {
    return priced.sorted.map((square, i) => ({ square, cost: priced.costs[i], own: priced.own[i] }));
  }
  return [...squareIds].map(squareId => ({ square: unpackSquare(squareId), own: false }));
};
