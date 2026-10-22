// Starts the whole server: the RPC client, the in-memory store, the indexer (backfill, then
// polls) and the HTTP API.
import type { Deployment } from '@gaia/core';

import { type ServerType, serve } from '@hono/node-server';
import type { AddressInfo } from 'node:net';

import { createHttpApi } from './api/http-api';
import { createRpcClient, readAuctionRules, readBidderRefund } from './auction-rpc';
import { AuctionIndexer } from './indexer/auction-indexer';
import { LiveMessageBus } from './live-message-bus';
import type { ServerConfig } from './server-config';
import type { AuctionStore } from './store/auction-store';
import { MemoryAuctionStore } from './store/memory-auction-store';

export interface RunningServer {
  /** The base URL of the HTTP API. */
  url: string;
  store: AuctionStore;
  indexer: AuctionIndexer;
  liveMessageBus: LiveMessageBus;
  /** Stops the polls and the HTTP server. Open streams are closed. */
  close(): Promise<void>;
}

export const startServer = async (
  config: ServerConfig,
  deployment: Deployment,
  log: (message: string) => void = console.log,
): Promise<RunningServer> => {
  const client = createRpcClient(config.rpcUrls);
  const chainId = await client.getChainId();
  if (chainId !== deployment.chainId) {
    throw new Error(`The RPC has chain ID ${chainId}, but the deployment file is for chain ${deployment.chainId}.`);
  }
  const auction = deployment.contracts.GaiaAuction;
  const rules = await readAuctionRules(client, deployment);

  const store = new MemoryAuctionStore({
    status: { endTime: deployment.auction.endTime, paused: false, cancelled: false },
    undoDepth: config.reorgDepth,
  });
  const liveMessageBus = new LiveMessageBus();
  const indexer = new AuctionIndexer({
    client,
    store,
    liveMessageBus,
    auction,
    deployBlock: deployment.deployBlock,
    logRange: config.logRange,
    pollIntervalMs: config.pollIntervalMs,
    log,
  });

  // Backfill before the API opens, so that the first snapshot is complete.
  const started = Date.now();
  await indexer.syncOnce();
  log(`Backfill done in ${Date.now() - started} ms: at block ${(await store.lastBlock())?.number}.`);
  indexer.start();

  const app = createHttpApi({
    store,
    liveMessageBus,
    rules,
    refundOf: (bidder, cancelled) => readBidderRefund(client, auction, bidder, cancelled),
    maxSnapshotBids: config.maxSnapshotBids,
  });
  const server: ServerType = await new Promise(resolve => {
    const s = serve({ fetch: app.fetch, port: config.port }, () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;
  log(`Gaia server on ${url} (auction ${auction}, chain ${chainId}).`);

  return {
    url,
    store,
    indexer,
    liveMessageBus,
    close: async () => {
      await indexer.stop();
      await new Promise<void>(resolve => {
        server.close(() => resolve());
        // Open streams keep their connections; close them too.
        if ('closeAllConnections' in server) {
          server.closeAllConnections();
        }
      });
    },
  };
};
