import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { loadServerConfig } from '../src/server-config';

describe('loadServerConfig', () => {
  it('has defaults for a local Anvil node', () => {
    const config = loadServerConfig({});
    expect(config.rpcUrls).toEqual(['http://127.0.0.1:8545']);
    expect(config.deploymentFile.endsWith(path.join('deployments', 'local.json'))).toBe(true);
    expect(path.isAbsolute(config.deploymentFile)).toBe(true);
    expect(config.webDir).toBeUndefined();
    expect(config).toMatchObject({
      host: '127.0.0.1',
      port: 8787,
      reorgDepth: 64,
      pollIntervalMs: 2000,
      logRange: 2000,
      maxSnapshotBids: 50_000,
    });
  });

  it('reads the values from the environment', () => {
    const config = loadServerConfig({
      RPC_URLS: 'https://a.example/key, https://b.example',
      DEPLOYMENT_FILE: '/tmp/base-sepolia.json',
      HOST: '0.0.0.0',
      PORT: '3000',
      WEB_DIR: '/srv/gaia/web',
      REORG_DEPTH: '10',
      POLL_INTERVAL_MS: '500',
      LOG_RANGE: '500',
      MAX_SNAPSHOT_BIDS: '100',
    });
    expect(config).toEqual({
      rpcUrls: ['https://a.example/key', 'https://b.example'],
      deploymentFile: '/tmp/base-sepolia.json',
      host: '0.0.0.0',
      port: 3000,
      webDir: '/srv/gaia/web',
      reorgDepth: 10,
      pollIntervalMs: 500,
      logRange: 500,
      maxSnapshotBids: 100,
    });
  });

  it('reads a relative WEB_DIR from the repository root', () => {
    const config = loadServerConfig({ WEB_DIR: 'packages/web/dist' });
    expect(config.webDir).toBe(path.resolve(path.dirname(config.deploymentFile), '..', 'packages', 'web', 'dist'));
  });

  it('names each wrong variable', () => {
    expect(() => loadServerConfig({ RPC_URLS: 'not a url', REORG_DEPTH: '0' })).toThrow(/RPC_URLS[\s\S]*REORG_DEPTH/);
    expect(() => loadServerConfig({ RPC_URLS: ' , ' })).toThrow(/RPC_URLS: must have at least one URL/);
  });
});
