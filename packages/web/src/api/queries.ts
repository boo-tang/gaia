// The server data as TanStack Query hooks.
import type { AuctionResponse } from '@gaia/core';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useBidsSelector, useStreamState } from '../bids/useBids';
import { ApiError } from './api-client';
import { apiClient } from './app-client';

export { apiClient };

/** Tries again up to 3 times after a network or server error. A 4xx answer does not change. */
export const retryServerErrors = (failureCount: number, error: Error) =>
  !(error instanceof ApiError && error.status < 500) && failureCount < 3;

const AUCTION_KEY = ['auction'];

/**
 * The auction rules and status (`GET /auction`). While the live stream is open, its status
 * messages change the status and the hook loads only on window focus. Else it loads every 30 s.
 */
export const useAuction = () => {
  const queryClient = useQueryClient();
  const streamOpen = useStreamState() === 'open';
  const liveStatus = useBidsSelector(view => view.data.status);

  useEffect(() => {
    if (liveStatus !== undefined) {
      queryClient.setQueryData<AuctionResponse>(AUCTION_KEY, old => old && { ...old, status: liveStatus });
    }
  }, [queryClient, liveStatus]);

  return useQuery({
    queryKey: AUCTION_KEY,
    queryFn: () => apiClient.getAuction(),
    refetchInterval: streamOpen ? false : 30_000,
    retry: retryServerErrors,
  });
};
