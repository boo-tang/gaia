import {
  Address,
  Hex,
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  webSocket,
} from "viem";

import { upsertBid } from "./bidService";

// Minimal ABI for HighestBidIncreased(address,uint256,uint16,uint16)
const auctionAbi = [
  {
    type: "event",
    name: "HighestBidIncreased",
    inputs: [
      { name: "bidder", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "lat", type: "uint16", indexed: false },
      { name: "lng", type: "uint16", indexed: false },
    ],
    anonymous: false,
  },
] as const;

type HighestBidEvent = {
  bidder: Address;
  amount: bigint;
  lat: number;
  lng: number;
};

const AUCTION_ADDRESS = (process.env.AUCTION_ADDRESS || "").toLowerCase();
const WS_URL = process.env.RPC_WS_URL;
const HTTP_URL = process.env.RPC_HTTP_URL;

export function startAuctionIndexer() {
  if (!AUCTION_ADDRESS || (!WS_URL && !HTTP_URL)) {
    console.warn("Indexer disabled - missing AUCTION_ADDRESS or RPC urls");
    return () => {};
  }

  let stopCurrent: (() => void) | null = null;
  let backoffMs = 1_000;
  const maxBackoffMs = 30_000;

  const subscribe = () => {
    try {
      const transport = WS_URL ? webSocket(WS_URL) : http(HTTP_URL!);
      const client = createPublicClient({ transport });

      const unwatch = client.watchEvent({
        address: AUCTION_ADDRESS as Address,
        events: auctionAbi,
        onLogs: async (logs) => {
          for (const log of logs) {
            try {
              const decoded = decodeEventLog({
                abi: auctionAbi,
                data: log.data as Hex,
                topics: log.topics as Hex[],
              });
              if (decoded.eventName !== "HighestBidIncreased") continue;
              const args = decoded.args as unknown as HighestBidEvent;
              await upsertBid({
                lat: Number(args.lat),
                lng: Number(args.lng),
                bidder: getAddress(args.bidder),
                amountWei: args.amount.toString(),
                updatedAt: Math.floor(Date.now() / 1000),
              });
            } catch (err) {
              console.error("indexer log error", err);
            }
          }
        },
        onError: (err) => {
          console.warn("watchEvent error", err);
          // attempt reconnect with backoff
          try {
            unwatch();
          } catch {}
          stopCurrent = null;
          setTimeout(() => {
            backoffMs = Math.min(backoffMs * 2, maxBackoffMs);
            subscribe();
          }, backoffMs);
        },
      });

      stopCurrent = () => {
        try {
          unwatch();
        } catch {}
      };
      backoffMs = 1_000; // reset backoff on successful subscribe
      console.log("Auction indexer subscribed");
    } catch (err) {
      console.warn("subscribe failed", err);
      setTimeout(subscribe, backoffMs);
      backoffMs = Math.min(backoffMs * 2, maxBackoffMs);
    }
  };

  subscribe();

  return () => {
    if (stopCurrent) stopCurrent();
  };
}
