// The server data as TanStack Query hooks.
import type { Address, AuctionResponse, StreamMessage } from '@gaia/core';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { isAddressEqual } from 'viem';

import { bidsStore, useBidsSelector, useStreamState } from '../bids/useBids';
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

/** The query key of `GET /bidder/:address`. */
export const bidderKey = (address: Address | undefined) => ['bidder', address?.toLowerCase()];

/**
 * True when a stream message can change the refund of `address`: a bid of the bidder, a bid that
 * takes squares of the bidder (the old amounts become refunds), or a cancel (all bids become
 * refunds).
 */
export const changesRefundOf = (message: StreamMessage, address: Address) => {
  if (message.type === 'shapeBid') {
    return (
      isAddressEqual(message.bidder, address) || message.taken.some(taken => isAddressEqual(taken.bidder, address))
    );
  }
  if (message.type === 'auctionStatus') {
    return message.status.cancelled;
  }
  return false;
};

/** The bidder view loads again at most once in this time after stream messages. */
const BIDDER_RELOAD_MS = 2_000;

/**
 * The view of one bidder (`GET /bidder/:address`): their shapes, history and refund. It loads
 * again after each stream message that can change the refund (at most once each 2 s), and every
 * 30 s while the stream is not open. After a transaction of the bidder, invalidate
 * `bidderKey(address)`.
 */
export const useBidder = (address: Address | undefined) => {
  const queryClient = useQueryClient();
  const streamOpen = useStreamState() === 'open';

  useEffect(() => {
    if (address === undefined) {
      return undefined;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let waiting = false;
    const reload = () => void queryClient.invalidateQueries({ queryKey: bidderKey(address) });
    const stop = bidsStore.onMessage(message => {
      if (!changesRefundOf(message, address)) {
        return;
      }
      if (timer !== undefined) {
        waiting = true;
        return;
      }
      reload();
      timer = setTimeout(() => {
        timer = undefined;
        if (waiting) {
          waiting = false;
          reload();
        }
      }, BIDDER_RELOAD_MS);
    });
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, [queryClient, address]);

  return useQuery({
    queryKey: bidderKey(address),
    queryFn: () => apiClient.getBidder(address as Address),
    enabled: address !== undefined,
    refetchInterval: streamOpen ? false : 30_000,
    retry: retryServerErrors,
  });
};
