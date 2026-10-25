// The shape selection: the selected squares, the tool and the price of the bid. The map, the bid
// panel and the bid flow read it (`useSyncExternalStore`, see useSelection.ts).
//
// The client does not check the shape rules: the simulation of the bid does (the contract is the
// only place that has them).
import { type Square, packSquare } from '@gaia/core';

/**
 * The app does not keep more squares in the selection. A memory and speed limit, not a shape
 * rule: `maxShapeSquares` of the contract is much lower.
 */
export const MAX_SELECTION_SQUARES = 10_000;

export type ToolId = 'pan' | 'rectangle';

/** `minimum`: the minimum next bid on each square. `perSquare`: one price for each square. */
export type PriceMode = 'minimum' | 'perSquare';

export interface SelectionState {
  /** Packed square IDs. A new set at each change. */
  squareIds: ReadonlySet<number>;
  tool: ToolId;
  priceMode: PriceMode;
  /** Wei. Undefined while the input has no valid price. Used only in `perSquare` mode. */
  pricePerSquare?: bigint;
}

export interface SelectionStore {
  getState: () => SelectionState;
  subscribe: (listener: () => void) => () => void;
  setTool: (tool: ToolId) => void;
  /** Adds the squares. Returns false, with no change, when the selection would be too large. */
  addSquares: (squares: readonly Square[]) => boolean;
  /** Replaces the selection (for example, an old shape of the bidder). */
  replace: (squareIds: readonly number[]) => void;
  clear: () => void;
  setPriceMode: (mode: PriceMode) => void;
  setPricePerSquare: (wei: bigint | undefined) => void;
}

export const createSelectionStore = (): SelectionStore => {
  let state: SelectionState = { squareIds: new Set(), tool: 'pan', priceMode: 'minimum' };
  const listeners = new Set<() => void>();

  const set = (change: Partial<SelectionState>) => {
    state = { ...state, ...change };
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    getState: () => state,
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setTool: tool => {
      if (tool !== state.tool) {
        set({ tool });
      }
    },
    addSquares: squares => {
      const next = new Set(state.squareIds);
      for (const square of squares) {
        next.add(packSquare(square));
      }
      if (next.size > MAX_SELECTION_SQUARES) {
        return false;
      }
      if (next.size !== state.squareIds.size) {
        set({ squareIds: next });
      }
      return true;
    },
    replace: squareIds => set({ squareIds: new Set(squareIds.slice(0, MAX_SELECTION_SQUARES)) }),
    clear: () => {
      if (state.squareIds.size > 0) {
        set({ squareIds: new Set() });
      }
    },
    setPriceMode: priceMode => set({ priceMode }),
    setPricePerSquare: pricePerSquare => set({ pricePerSquare }),
  };
};
