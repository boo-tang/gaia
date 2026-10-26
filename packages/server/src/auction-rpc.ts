// The calls to the chain: the RPC client, the auction rules, the refund of a bidder, and the
// auction events of a block range.
import { type Address, type AuctionRules, type Deployment, gaiaAuctionAbi } from '@gaia/core';

import { BlockNotFoundError, type Hex, type PublicClient, createPublicClient, fallback, http } from 'viem';

import { AUCTION_EVENT_NAMES, type AuctionEvent } from './indexer/auction-events';

/** One client for all RPC URLs: the first is the main provider, the others are fallbacks. */
export const createRpcClient = (rpcUrls: string[]): PublicClient =>
  createPublicClient({
    transport: fallback(rpcUrls.map(url => http(url, { retryCount: 2 }))),
  });

/** Reads the constructor values of the auction. They never change, so the server reads them once. */
export const readAuctionRules = async (client: PublicClient, deployment: Deployment): Promise<AuctionRules> => {
  const address = deployment.contracts.GaiaAuction;
  const read = <
    F extends
      | 'startTime'
      | 'maxEndTime'
      | 'extensionWindow'
      | 'minBidPerSquareWei'
      | 'minBidIncrementBps'
      | 'minShapeSquares'
      | 'maxShapeSquares'
      | 'maxShapeAspectRatio',
  >(
    functionName: F,
  ) => client.readContract({ address, abi: gaiaAuctionAbi, functionName });
  const [startTime, maxEndTime, extensionWindow, minBid, incrementBps, minSquares, maxSquares, aspect] =
    await Promise.all([
      read('startTime'),
      read('maxEndTime'),
      read('extensionWindow'),
      read('minBidPerSquareWei'),
      read('minBidIncrementBps'),
      read('minShapeSquares'),
      read('maxShapeSquares'),
      read('maxShapeAspectRatio'),
    ]);
  return {
    chainId: deployment.chainId,
    auction: address,
    startTime: Number(startTime),
    maxEndTime: Number(maxEndTime),
    extensionWindow: Number(extensionWindow),
    minBidPerSquareWei: minBid.toString(),
    minBidIncrementBps: Number(incrementBps),
    minShapeSquares: Number(minSquares),
    maxShapeSquares: Number(maxSquares),
    maxShapeAspectRatio: Number(aspect),
  };
};

/**
 * What `withdraw` sends to `bidder` now: `pendingReturns`, plus `activeBids` after a cancel.
 */
export const readBidderRefund = async (client: PublicClient, auction: Address, bidder: Address, cancelled: boolean) => {
  const pending = await client.readContract({
    address: auction,
    abi: gaiaAuctionAbi,
    functionName: 'pendingReturns',
    args: [bidder],
  });
  if (!cancelled) {
    return pending;
  }
  const bids = await client.readContract({
    address: auction,
    abi: gaiaAuctionAbi,
    functionName: 'activeBids',
    args: [bidder],
  });
  return pending + bids;
};

/** The hash of a block, or undefined when the chain has no such block (for example after a reorg). */
export const readBlockHash = async (client: PublicClient, number: number): Promise<Hex | undefined> => {
  try {
    return (await client.getBlock({ blockNumber: BigInt(number) })).hash;
  } catch (error) {
    if (error instanceof BlockNotFoundError) {
      return undefined;
    }
    throw error;
  }
};

/** An auction event with the block that holds it. */
export interface AuctionEventLog {
  blockNumber: number;
  blockHash: Hex;
  /** Unix seconds, when the RPC gives it in the log. */
  blockTimestamp: number | undefined;
  event: AuctionEvent;
}

/** The auction events of blocks `from` to `to`, in (block, log index) order. */
export const fetchAuctionEvents = async (
  client: PublicClient,
  auction: Address,
  from: number,
  to: number,
): Promise<AuctionEventLog[]> => {
  const logs = await client.getContractEvents({
    address: auction,
    abi: gaiaAuctionAbi,
    fromBlock: BigInt(from),
    toBlock: BigInt(to),
    strict: true,
  });
  const events: AuctionEventLog[] = [];
  for (const log of logs) {
    if (!(AUCTION_EVENT_NAMES as readonly string[]).includes(log.eventName)) {
      continue;
    }
    const timestamp = (log as { blockTimestamp?: bigint | Hex }).blockTimestamp;
    events.push({
      blockNumber: Number(log.blockNumber),
      blockHash: log.blockHash,
      blockTimestamp: timestamp === undefined ? undefined : Number(timestamp),
      event: { logIndex: log.logIndex, eventName: log.eventName, args: log.args } as AuctionEvent,
    });
  }
  return events.sort((a, b) => a.blockNumber - b.blockNumber || a.event.logIndex - b.event.logIndex);
};
