// The integration test against a real Anvil node. It starts its own Anvil on a free port,
// deploys with `npm run deploy:local` and seeds with `npm run seed:local` (deployment id
// `server-test-<port>`, so deployments/local.json does not change), then starts the server with
// an empty store.
//
// It needs `anvil` (Foundry) on the PATH and the contract build (`npx hardhat compile`). Without
// `anvil` the test is skipped.

import { execFile, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  gaiaAuctionAbi,
  packSquare,
  parseDeployment,
  type Address,
  type BidderView,
  type Deployment,
  type ShapeBidMessage,
  type StreamMessage,
  type ViewportSnapshot,
} from '@gaia/core';
import { createPublicClient, createWalletClient, getAddress, http, zeroAddress, type PublicClient } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { anvil } from 'viem/chains';

import { loadConfig } from '../src/config';
import { startServer, type RunningServer } from '../src/server';
import { SseReader } from './sse';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MNEMONIC = 'test test test test test test test test test test test junk';
const hasAnvil = spawnSync('anvil', ['--version']).status === 0;
const run = promisify(execFile);

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });

const until = async <T>(read: () => Promise<T | undefined>, what: string, timeoutMs = 10_000): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Timed out: ${what}.`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

const rect = (lat: number, lng: number, rows: number, cols: number) => {
  const squares: number[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) squares.push(packSquare({ lat: lat + r, lng: lng + c }));
  return squares;
};
// The seed bids (scripts/seed-local.ts): Anvil accounts 3, 4 and 5, near London.
const SEED = [rect(14150, 17990, 2, 2), rect(14150, 18000, 3, 2), rect(14160, 17990, 1, 4)];
const LONDON = { south: 14100, north: 14200, west: 17900, east: 18100 };
const query = (v: typeof LONDON) => `south=${v.south}&north=${v.north}&west=${v.west}&east=${v.east}`;

describe.skipIf(!hasAnvil)('server against Anvil', { timeout: 30_000 }, () => {
  let anvilProcess: ChildProcess | undefined;
  let rpcUrl = '';
  let deploymentId = '';
  let deployment: Deployment;
  let client: PublicClient;
  let server: RunningServer | undefined;

  const env = () => ({ ...process.env, LOCAL_RPC_URL: rpcUrl, LOCAL_DEPLOYMENT_ID: deploymentId });
  const start = async () =>
    startServer(
      { ...loadConfig({ RPC_URLS: rpcUrl, PORT: '0', POLL_INTERVAL_MS: '100', LOG_RANGE: '5' }) },
      deployment,
      () => undefined,
    );
  const get = async <T>(urlPath: string): Promise<T> => {
    const response = await fetch(`${server?.url}${urlPath}`);
    expect(response.status, urlPath).toBe(200);
    return (await response.json()) as T;
  };
  const wallet = (index: number) =>
    createWalletClient({ account: mnemonicToAccount(MNEMONIC, { addressIndex: index }), chain: anvil, transport: http(rpcUrl) });
  const bid = async (index: number, squares: number[], value: bigint, raiseOwnSquares = false) => {
    const hash = await wallet(index).writeContract({
      address: deployment.contracts.GaiaAuction,
      abi: gaiaAuctionAbi,
      functionName: 'bidOnShape',
      args: [squares, 0n, raiseOwnSquares],
      value,
    });
    const receipt = await client.waitForTransactionReceipt({ hash });
    expect(receipt.status).toBe('success');
    return receipt;
  };
  const openStream = async (urlPath: string, headers: Record<string, string> = {}) => {
    const response = await fetch(`${server?.url}${urlPath}`, { headers });
    expect(response.status).toBe(200);
    return new SseReader(response);
  };

  beforeAll(async () => {
    const port = await freePort();
    rpcUrl = `http://127.0.0.1:${port}`;
    deploymentId = `server-test-${port}`;
    anvilProcess = spawn('anvil', ['--port', String(port), '--silent'], { stdio: 'ignore' });
    client = createPublicClient({ chain: anvil, transport: http(rpcUrl), pollingInterval: 50 });
    await until(() => client.getChainId().then(() => true).catch(() => undefined), 'Anvil starts');

    const hardhat = (script: string) =>
      run('npx', ['hardhat', 'run', script, '--network', 'anvil'], { cwd: REPO_ROOT, env: env() });
    await hardhat('scripts/deploy-local.ts');
    await hardhat('scripts/seed-local.ts');
    const file = path.join(REPO_ROOT, 'deployments', `${deploymentId}.json`);
    deployment = parseDeployment(JSON.parse(fs.readFileSync(file, 'utf8')));
  }, 240_000);

  afterAll(async () => {
    await server?.close();
    anvilProcess?.kill();
    if (deploymentId !== '') {
      fs.rmSync(path.join(REPO_ROOT, 'deployments', `${deploymentId}.json`), { force: true });
      fs.rmSync(path.join(REPO_ROOT, 'deployments', `${deploymentId}.parameters.json`), { force: true });
      fs.rmSync(path.join(REPO_ROOT, 'ignition', 'deployments', deploymentId), { recursive: true, force: true });
    }
  });

  it('shows the three seed bids in the snapshot after a backfill', async () => {
    server = await start();
    const snapshot = await get<ViewportSnapshot>(`/bids?${query(LONDON)}`);
    const byShape = new Map<string, number[]>();
    for (const b of snapshot.bids) byShape.set(b.shapeId, [...(byShape.get(b.shapeId) ?? []), b.squareId]);
    expect([...byShape.keys()].sort()).toEqual(['1', '2', '3']);
    SEED.forEach((squares, i) => expect(byShape.get(String(i + 1))?.sort()).toEqual([...squares].sort()));
    const bidders = new Set(snapshot.bids.map((b) => b.bidder));
    expect(bidders).toEqual(new Set([3, 4, 5].map((i) => mnemonicToAccount(MNEMONIC, { addressIndex: i }).address)));
  });

  let lastId = '';

  it('reads new bids back through the stream and the snapshot', async () => {
    const snapshot = await get<ViewportSnapshot>(`/bids?${query(LONDON)}`);
    const stream = await openStream(`/stream?after=${snapshot.position.block}:${snapshot.position.logIndex}`);
    const minBid = BigInt((await get<{ rules: { minBidPerSquareWei: string } }>('/auction')).rules.minBidPerSquareWei);

    // Account 6 takes the east square of shape 3 (a partial takeover), with 1 minBid of excess.
    const east = SEED[2][3];
    await bid(6, [east], 3n * minBid);
    // Account 5 bids again on the rest of shape 3 (own squares, no raise, no ETH).
    await bid(5, SEED[2].slice(0, 3), 0n);

    const [takeover, rebid] = await stream.json<ShapeBidMessage>(2, 10_000);
    const account5 = getAddress(mnemonicToAccount(MNEMONIC, { addressIndex: 5 }).address);
    expect(takeover).toMatchObject({ type: 'shapeBid', shapeId: '4', squareIds: [east], amounts: [(2n * minBid).toString()] });
    expect(takeover.taken).toEqual([{ shapeId: '3', bidder: account5, squareIds: [east] }]);
    expect(rebid).toMatchObject({ shapeId: '5', paid: '0', taken: [{ shapeId: '3', bidder: account5, squareIds: SEED[2].slice(0, 3) }] });
    lastId = `${rebid.position.block}:${rebid.position.logIndex}`;
    await stream.close();

    const after = await get<ViewportSnapshot>(`/bids?${query(LONDON)}`);
    expect(after.bids.find((b) => b.squareId === east)).toMatchObject({ shapeId: '4', amount: (2n * minBid).toString() });

    // The bidder view of account 6: the shape, and the excess as the refund (from the contract).
    const account6 = mnemonicToAccount(MNEMONIC, { addressIndex: 6 }).address;
    const view = await get<BidderView>(`/bidder/${account6}`);
    expect(view.shapes.map((s) => [s.shapeId, s.liveSquareIds])).toEqual([['4', [east]]]);
    expect(view.refund).toBe(minBid.toString());
  });

  it('sends the missed changes to a client that reconnects with its last position', async () => {
    const minBid = BigInt((await get<{ rules: { minBidPerSquareWei: string } }>('/auction')).rules.minBidPerSquareWei);
    const receipt = await bid(7, rect(14000, 18000, 2, 3), 6n * minBid);

    const stream = await openStream('/stream?after=0:-1', { 'Last-Event-ID': lastId });
    const [missed] = await stream.json<ShapeBidMessage>(1, 10_000);
    expect(missed).toMatchObject({ shapeId: '6', position: { block: Number(receipt.blockNumber) } });
    lastId = `${missed.position.block}:${missed.position.logIndex}`;
    await stream.close();
  });

  it('undoes the blocks that a reorg drops', async () => {
    const minBid = BigInt((await get<{ rules: { minBidPerSquareWei: string } }>('/auction')).rules.minBidPerSquareWei);
    const stream = await openStream(`/stream?after=${lastId}`);
    const snapshotId = await client.request({ method: 'evm_snapshot' as never } as never);
    await bid(7, rect(13000, 18000, 1, 2), 2n * minBid);
    const [dropped] = await stream.json<ShapeBidMessage>(1, 10_000);
    expect(dropped.shapeId).toBe('7');

    // Drop the bid block and mine two other blocks.
    await client.request({ method: 'evm_revert' as never, params: [snapshotId] } as never);
    await client.request({ method: 'anvil_mine' as never, params: ['0x2'] } as never);

    const reorg = (await stream.json<StreamMessage>(1, 10_000))[0];
    expect(reorg).toEqual({ type: 'reorg', position: { block: Number(lastId.split(':')[0]), logIndex: 0 } });
    await stream.close();
    const area = await get<ViewportSnapshot>('/bids?south=13000&north=13000&west=18000&east=18001');
    expect(area.bids).toEqual([]);
  });

  it('has the on-chain state after a restart with an empty store', async () => {
    const before = await get<ViewportSnapshot>('/bids?south=0&north=17999&west=0&east=35999');
    await server?.close();
    server = await start();
    const after = await get<ViewportSnapshot>('/bids?south=0&north=17999&west=0&east=35999');
    const sorted = (s: ViewportSnapshot) => [...s.bids].sort((a, b) => a.squareId - b.squareId);
    expect(sorted(after)).toEqual(sorted(before));

    // Each square and each shape, compared with the contract views.
    const auction = { address: deployment.contracts.GaiaAuction, abi: gaiaAuctionAbi } as const;
    const store = (server as RunningServer).store;
    for (const b of after.bids) {
      const lat = Math.floor(b.squareId / 65536);
      const lng = b.squareId % 65536;
      const [bidder, amount] = await client.readContract({ ...auction, functionName: 'highestBids', args: [lat, lng] });
      expect([getAddress(bidder), amount.toString()]).toEqual([getAddress(b.bidder), b.amount]);
      expect((await client.readContract({ ...auction, functionName: 'squareShapeId', args: [lat, lng] })).toString()).toBe(b.shapeId);
    }
    const ids = [1n, 2n, 3n, 4n, 5n, 6n, 7n];
    const shapes = await store.shapes(ids);
    expect(shapes.map((s) => s.shapeId)).toEqual(ids.slice(0, 6));
    for (const shape of shapes) {
      const live = await client.readContract({ ...auction, functionName: 'shapeLiveSquares', args: [shape.shapeId] });
      expect([shape.shapeId, BigInt(shape.liveSquares)]).toEqual([shape.shapeId, live]);
      const bidder = await client.readContract({ ...auction, functionName: 'shapeBidder', args: [shape.shapeId] });
      expect(getAddress(bidder)).toBe(getAddress(shape.bidder as Address));
    }
    // The dropped shape 7 is not on the chain either.
    expect(await client.readContract({ ...auction, functionName: 'shapeBidder', args: [7n] })).toBe(zeroAddress);
  });
});
