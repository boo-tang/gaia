import { useMemo } from 'react';
import {
  useAccount,
  useChainId,
  useConfig,
  useReadContract,
  useReadContracts,
  useWriteContract,
} from 'wagmi';
import { readContracts } from 'wagmi/actions';

import { gaiaAuctionAbi } from './abis';
import addresses from './addresses';
import { Loc } from '../types';

export interface AuctionConfig {
  startTime: bigint;
  endTime: bigint;
  maxEndTime: bigint;
  extensionWindow: bigint;
  minBidPerSquareWei: bigint;
  minBidIncrementBps: bigint;
  minShapeSquares: bigint;
  maxShapeSquares: bigint;
  maxShapeAspectRatio: bigint;
}

export const useAuctionAddress = () => {
  const chainId = useChainId();
  return addresses.GaiaAuction[chainId];
};

// All auction parameters are immutable on-chain except `endTime`: a bid near the end moves it
// (soft close, up to `maxEndTime`). Fetch the immutable ones once and poll `endTime`.
export const useAuctionConfig = () => {
  const address = useAuctionAddress();
  const contract = { address, abi: gaiaAuctionAbi } as const;

  const { data, isLoading, error } = useReadContracts({
    contracts: [
      { ...contract, functionName: 'startTime' },
      { ...contract, functionName: 'maxEndTime' },
      { ...contract, functionName: 'extensionWindow' },
      { ...contract, functionName: 'minBidPerSquareWei' },
      { ...contract, functionName: 'minBidIncrementBps' },
      { ...contract, functionName: 'minShapeSquares' },
      { ...contract, functionName: 'maxShapeSquares' },
      { ...contract, functionName: 'maxShapeAspectRatio' },
    ],
    query: { staleTime: Infinity },
  });

  const endTimeRead = useReadContract({
    ...contract,
    functionName: 'endTime',
    query: { refetchInterval: 5_000 },
  });
  const endTime = endTimeRead.data as bigint | undefined;

  const config: AuctionConfig | undefined = useMemo(() => {
    if (!data || data.some((d) => d.status !== 'success') || endTime === undefined) return undefined;
    const [
      startTime,
      maxEndTime,
      extensionWindow,
      minBidPerSquareWei,
      minBidIncrementBps,
      minShapeSquares,
      maxShapeSquares,
      maxShapeAspectRatio,
    ] = data.map((d) => d.result as bigint);
    return {
      startTime,
      endTime,
      maxEndTime,
      extensionWindow,
      minBidPerSquareWei,
      minBidIncrementBps,
      minShapeSquares,
      maxShapeSquares,
      maxShapeAspectRatio,
    };
  }, [data, endTime]);

  return { config, isLoading: isLoading || endTimeRead.isLoading, error: error ?? endTimeRead.error };
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
      const [bidder, amount] = result.result as [string, bigint];
      return { bidder, amount };
    });
  };
};

export const useBidOnShape = () => {
  const address = useAuctionAddress();
  const { writeContractAsync, ...rest } = useWriteContract();

  // `floorPerSquare` > 0 is a jump bid: each square gets at least this amount. With
  // `raiseOwnSquares`, squares where the caller is already the highest bidder also go up.
  const bidOnShape = (locs: Loc[], value: bigint, floorPerSquare = 0n, raiseOwnSquares = false) =>
    writeContractAsync({
      address,
      abi: gaiaAuctionAbi,
      functionName: 'bidOnShape',
      args: [locs, floorPerSquare, raiseOwnSquares],
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
