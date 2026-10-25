// The server configuration, from environment variables. Each value has a default for a local
// Anvil node (`yarn chain:local`, `yarn deploy:local`).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const positiveInt = z.coerce.number().int().positive();

const serverEnvSchema = z.object({
  /**
   * The RPC URLs, separated by commas. The first is the main provider; the others are fallbacks
   * (viem `fallback` transport), in this order.
   */
  RPC_URLS: z
    .string()
    .default('http://127.0.0.1:8545')
    .transform(value =>
      value
        .split(',')
        .map(url => url.trim())
        .filter(url => url !== ''),
    )
    .pipe(z.array(z.url()).min(1, 'must have at least one URL')),
  /** The deployment file. A relative path starts at the repository root. */
  DEPLOYMENT_FILE: z
    .string()
    .default('deployments/local.json')
    .transform(file => path.resolve(REPO_ROOT, file)),
  /** The address the HTTP server listens on. `0.0.0.0` listens on all interfaces. */
  HOST: z.string().trim().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(0).max(65535).default(8787),
  /**
   * The web build (`packages/web/dist`). When set, the server also serves the web app, and the API
   * moves under `/api`. A relative path starts at the repository root.
   */
  WEB_DIR: z
    .string()
    .optional()
    .transform(dir => (dir === undefined || dir.trim() === '' ? undefined : path.resolve(REPO_ROOT, dir))),
  /**
   * The number of blocks that a reorg can undo. A reorg that goes deeper clears the store, and
   * the indexer backfills again from the deploy block.
   */
  REORG_DEPTH: positiveInt.default(64),
  /** The time between two polls of the chain head, in milliseconds. */
  POLL_INTERVAL_MS: positiveInt.default(2000),
  /** The largest block range of one `eth_getLogs` request. */
  LOG_RANGE: positiveInt.default(2000),
  /** A viewport snapshot with more bids than this gets HTTP 400 ("zoom in"). */
  MAX_SNAPSHOT_BIDS: positiveInt.default(50_000),
});

export type ServerConfig = {
  rpcUrls: string[];
  deploymentFile: string;
  host: string;
  port: number;
  /** Not there: the server serves only the API, at the root. */
  webDir?: string;
  reorgDepth: number;
  pollIntervalMs: number;
  logRange: number;
  maxSnapshotBids: number;
};

/** Reads the configuration. Throws an error that names each wrong variable. */
export const loadServerConfig = (env: NodeJS.ProcessEnv = process.env): ServerConfig => {
  const result = serverEnvSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid server configuration:\n  ${problems.join('\n  ')}`);
  }
  const e = result.data;
  return {
    rpcUrls: e.RPC_URLS,
    deploymentFile: e.DEPLOYMENT_FILE,
    host: e.HOST,
    port: e.PORT,
    webDir: e.WEB_DIR,
    reorgDepth: e.REORG_DEPTH,
    pollIntervalMs: e.POLL_INTERVAL_MS,
    logRange: e.LOG_RANGE,
    maxSnapshotBids: e.MAX_SNAPSHOT_BIDS,
  };
};
