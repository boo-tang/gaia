import { useMemo } from 'react';
import { useAccount, useChainId, useConfig, useReadContracts, useWriteContract } from 'wagmi';
import { readContracts } from 'wagmi/actions';

import { gaiaAuctionAbi } from './abis';
import addresses from './addresses';
import { Loc } from '../types';

export interface AuctionConfig {
  startTime: bigint;
  endTime: bigint;
  minBidPerSquareWei: bigint;
  minShapeSquares: bigint;
  maxShapeSquares: bigint;
  maxShapeAspectRatio: bigint;
}

export const useAuctionAddress = () => {
  const chainId = useChainId();
  return addresses.GaiaAuction[chainId];
};

// Auction parameters are immutable on-chain; fetch once and reuse everywhere.
export const useAuctionConfig = () => {
  const address = useAuctionAddress();
  const contract = { address, abi: gaiaAuctionAbi } as const;

  const { data, isLoading, error } = useReadContracts({
    contracts: [
      { ...contract, functionName: 'startTime' },
      { ...contract, functionName: 'endTime' },
      { ...contract, functionName: 'minBidPerSquareWei' },
      { ...contract, functionName: 'minShapeSquares' },
      { ...contract, functionName: 'maxShapeSquares' },
      { ...contract, functionName: 'maxShapeAspectRatio' },
    ],
    query: { staleTime: Infinity },
  });

  const config: AuctionConfig | undefined = useMemo(() => {
    if (!data || data.some((d) => d.status !== 'success')) return undefined;
    const [startTime, endTime, minBidPerSquareWei, minShapeSquares, maxShapeSquares, maxShapeAspectRatio] =
      data.map((d) => d.result as bigint);
    return { startTime, endTime, minBidPerSquareWei, minShapeSquares, maxShapeSquares, maxShapeAspectRatio };
  }, [data]);

  return { config, isLoading, error };
};

export const usePendingReturns = () => {
  const address = useAuctionAddress();
  const { address: account } = useAccount();

  return useReadContracts({
    contracts: [
      {
        address,
        abi: gaiaAuctionAbi,
        functionName: 'pendingReturns',
        args: [account ?? '0x0000000000000000000000000000000000000000'],
      },
    ],
    query: { enabled: !!account, refetchInterval: 10_000 },
  });
};

// Fresh, exact-value read of the current highest bid per square, used right before submitting
// a bid so payment isn't computed from the (potentially stale) server-cached bid feed.
export const useFetchHighestBids = () => {
  const config = useConfig();
  const address = useAuctionAddress();

  return async (locs: Loc[]) => {
    const results = await readContracts(config, {
      contracts: locs.map((loc) => ({
        address,
        abi: gaiaAuctionAbi,
        functionName: 'highestBids',
        args: [loc.lat, loc.lng],
      })),
    });

    return results.map((result, i) => {
      if (result.status !== 'success') {
        throw new Error(`Failed to read highest bid for (${locs[i].lat}, ${locs[i].lng})`);
      }
      const [, amount] = result.result as [string, bigint];
      return amount;
    });
  };
};

export const useBidOnShape = () => {
  const address = useAuctionAddress();
  const { writeContractAsync, ...rest } = useWriteContract();

  const bidOnShape = (locs: Loc[], value: bigint) =>
    writeContractAsync({
      address,
      abi: gaiaAuctionAbi,
      functionName: 'bidOnShape',
      args: [locs],
      value,
    });

  return { bidOnShape, ...rest };
};

export const useWithdraw = () => {
  const address = useAuctionAddress();
  const { writeContractAsync, ...rest } = useWriteContract();

  const withdraw = () =>
    writeContractAsync({ address, abi: gaiaAuctionAbi, functionName: 'withdraw' });

  return { withdraw, ...rest };
};
