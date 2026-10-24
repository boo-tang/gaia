// The map data of the app: one store, one live stream. React reads it with these hooks.
import { useSyncExternalStore } from 'react';

import { apiClient } from '../api/app-client';
import { type BidsView, createBidsStore } from './bids-store';

export const bidsStore = createBidsStore({ client: apiClient, openEventSource: url => new EventSource(url) });

export const useBidsSelector = <T>(select: (view: BidsView) => T): T =>
  useSyncExternalStore(bidsStore.subscribe, () => select(bidsStore.getView()));

/** All map data. The component renders again at each change. */
export const useBids = () => useBidsSelector(view => view);

/** The live stream state: `idle`, `connecting`, `open` or `down`. */
export const useStreamState = () => useBidsSelector(view => view.stream);
