// The bid for React: the flow state, why the bid is disabled, and `start` with the wagmi calls.
import { gaiaAuctionAbi } from '@gaia/core';

import { useQueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { useAccount, usePublicClient, useWriteContract } from 'wagmi';

import { useAuction } from '../api/queries';
import { describeAuction } from '../components/auction-status';
import { deployment, gaiaChain } from '../config/app-config';
import { useNowSeconds } from '../hooks/useNowSeconds';
import { type BidInput, useSelectionBid } from '../selection/useSelection';
import { type TxState, runTx } from '../tx/tx-flow';
import { type BidAuctionState, type BidCall, bidDisabledReason, bidFlow, bidSteps } from './bid-flow';

/** The query key of the bidder view of `GET /bidder/:address`. */
export const bidderKey = (address: string | undefined) => ['bidder', address?.toLowerCase()];

export interface Bid {
  state: TxState<bigint>;
  input: BidInput;
  /** Why the bid is disabled, apart from the selection. */
  reason?: string;
  /** True when the Bid button is enabled. */
  canBid: boolean;
  start: () => void;
}

export const useBid = (): Bid => {
  const state = useSyncExternalStore(bidFlow.subscribe, bidFlow.getState);
  const input = useSelectionBid();
  const auction = useAuction();
  // The phase changes at the next tick of the shared clock: within one second of `endTime`.
  const now = useNowSeconds();
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();

  let auctionState: BidAuctionState = 'loading';
  if (auction.data !== undefined) {
    auctionState = describeAuction(auction.data, now).phase;
  } else if (auction.isError) {
    auctionState = 'unavailable';
  }
  const reason = bidDisabledReason({
    auction: auctionState,
    connected: address !== undefined,
    rightChain: chainId === gaiaChain.chain.id,
    chainName: gaiaChain.chain.name,
  });
  const canBid =
    reason === undefined && input.ready && input.total !== undefined && publicClient !== undefined && !bidFlow.busy();

  const start = () => {
    if (!canBid || address === undefined || input.total === undefined || publicClient === undefined) {
      return;
    }
    const call: BidCall = {
      bidder: address,
      packed: input.packed,
      floorPerSquare: input.floorPerSquare,
      value: input.total,
    };
    const contract = {
      address: deployment.contracts.GaiaAuction,
      abi: gaiaAuctionAbi,
      functionName: 'bidOnShape',
    } as const;
    void runTx(
      bidFlow,
      bidSteps(
        call,
        {
          simulate: c =>
            publicClient.simulateContract({
              ...contract,
              args: [c.packed, c.floorPerSquare, false],
              value: c.value,
              account: c.bidder,
            }),
          write: c =>
            writeContractAsync({
              ...contract,
              args: [c.packed, c.floorPerSquare, false],
              value: c.value,
              chainId: gaiaChain.chain.id,
            }),
          waitForReceipt: hash => publicClient.waitForTransactionReceipt({ hash }),
        },
        () => void queryClient.invalidateQueries({ queryKey: bidderKey(address) }),
      ),
    );
  };

  return { state, input, reason, canBid, start };
};
