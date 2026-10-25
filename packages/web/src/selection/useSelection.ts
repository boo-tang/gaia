// The selection of the app, and the bid on it: the one place where the bid panel, the map and
// the bid flow get the sorted, packed squares and the total.
import {
  type AuctionRules,
  type BidRules,
  type PricedSelection,
  type Viewport,
  priceSelection,
  selectionExtent,
  unpackSquare,
} from '@gaia/core';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useAccount } from 'wagmi';

import { useAuction } from '../api/queries';
import { sameViewport, viewportHolds } from '../bids/areas';
import type { BidsState } from '../bids/bids-reducer';
import { bidsStore, useBidsSelector } from '../bids/useBids';
import { type SelectionCell, selectionCells } from './selection-cells';
import { type SelectionState, createSelectionStore } from './selection-store';

export const selectionStore = createSelectionStore();

export const useSelection = <T>(select: (state: SelectionState) => T): T =>
  useSyncExternalStore(selectionStore.subscribe, () => select(selectionStore.getState()));

/** The bid on the current selection. */
export interface BidInput {
  /** True when the bid can go to the simulation: squares, known prices, a valid price. */
  ready: boolean;
  squareCount: number;
  /** The `squares` argument of `bidOnShape`: sorted and packed. */
  packed: number[];
  /** The `floorPerSquare` argument: the price per square, or 0 for the minimum bid. */
  floorPerSquare: bigint;
  /** The `msg.value` before the margin. Undefined while `ready` is false. */
  total?: bigint;
  /** All numbers of the selection. Undefined while the rules are not loaded or no square is selected. */
  priced?: PricedSelection;
  /** The bids of some squares are not loaded yet. */
  loading: boolean;
  /** The bids of some squares could not load. `retry` asks again. */
  loadFailed: boolean;
  retry: () => void;
}

const bidRules = (rules: AuctionRules): BidRules => ({
  minBidPerSquareWei: BigInt(rules.minBidPerSquareWei),
  minBidIncrementBps: BigInt(rules.minBidIncrementBps),
});

interface Computed {
  priced?: PricedSelection;
  /** The extent of the squares that are not loaded. */
  missing?: Viewport;
}

// The bid panel and the map use the same values: compute them once for each change.
let cache:
  { selection: SelectionState; data: BidsState; address?: string; rules: AuctionRules; computed: Computed } | undefined;

const compute = (selection: SelectionState, data: BidsState, address: string | undefined, rules: AuctionRules) => {
  if (
    cache !== undefined &&
    cache.selection === selection &&
    cache.data === data &&
    cache.address === address &&
    cache.rules === rules
  ) {
    return cache.computed;
  }
  let computed: Computed = {};
  if (selection.squareIds.size > 0) {
    const isLoaded = (squareId: number) => data.snapshotAreas.some(area => viewportHolds(area, squareId));
    const squares = [...selection.squareIds].map(unpackSquare);
    const priced = priceSelection(squares, squareId => data.bids.get(squareId), isLoaded, bidRules(rules), {
      ownAddress: address,
      pricePerSquare: selection.priceMode === 'perSquare' ? selection.pricePerSquare : undefined,
    });
    const missing =
      priced.missingCount > 0
        ? selectionExtent([...selection.squareIds].filter(id => !isLoaded(id)).map(unpackSquare))
        : undefined;
    computed = { priced, missing };
  }
  cache = { selection, data, address, rules, computed };
  return computed;
};

/**
 * The bid on the current selection: the squares for `bidOnShape`, `floorPerSquare` and the total.
 * It asks the bids store for the squares that are not loaded. The bid uses
 * `raiseOwnSquares = false`: own squares cost 0.
 */
export const useSelectionBid = (): BidInput => {
  const selection = useSelection(state => state);
  const data = useBidsSelector(view => view.data);
  const selectionError = useBidsSelector(view => view.selectionError);
  const { address } = useAccount();
  const rules = useAuction().data?.rules;

  const { priced, missing } = rules === undefined ? ({} as Computed) : compute(selection, data, address, rules);
  const missingKey = missing === undefined ? '' : `${missing.south},${missing.north},${missing.west},${missing.east}`;

  // The store does not ask again for an area that failed: "Try again" does. A different area loads.
  useEffect(() => {
    if (missing !== undefined) {
      bidsStore.loadArea(missing);
    }
    // `missingKey` holds the values of `missing`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingKey]);
  const failed = missing !== undefined && selectionError !== undefined && sameViewport(missing, selectionError);

  const priceValid =
    selection.priceMode === 'minimum' || (selection.pricePerSquare !== undefined && priced?.priceTooLow === false);
  const ready = priced !== undefined && priced.missingCount === 0 && priceValid;
  return {
    ready,
    squareCount: selection.squareIds.size,
    packed: priced?.packed ?? [],
    floorPerSquare: priced?.floorPerSquare ?? 0n,
    total: ready ? priced.total : undefined,
    priced,
    loading: missing !== undefined && !failed,
    loadFailed: failed,
    retry: () => {
      if (missing !== undefined) {
        bidsStore.loadArea(missing, { retry: true });
      }
    },
  };
};

/**
 * The selected squares for the map: with prices when the bid has them, else with no price (for
 * example before `GET /auction` loads, or when it fails).
 */
export const useSelectionCells = (): readonly SelectionCell[] => {
  const squareIds = useSelection(state => state.squareIds);
  const { priced } = useSelectionBid();
  return useMemo(() => selectionCells(squareIds, priced), [squareIds, priced]);
};
