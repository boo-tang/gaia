import type { DeploymentParameters } from '@nomicfoundation/ignition-core';
import { network } from 'hardhat';
import fs from 'node:fs';
import path from 'node:path';
import { getAddress } from 'viem';

import GaiaSystemModule from '../ignition/modules/GaiaSystem';
import {
  auctionTimes,
  bigintReplacer,
  readParameters,
  withAuctionTimes,
  writeParameters,
} from './lib/local-parameters';
import { CANONICAL_REGISTRY, ensureRegistry } from './lib/registry';
import { grantSaleIssuer } from './lib/sale-issuer';

/*
 * Deploys all Gaia contracts to a local Anvil node (`yarn chain:local`):
 *
 *   yarn deploy:local
 *
 * 1. Checks that the node answers and has chain ID 31337.
 * 2. Puts the ERC-6551 registry at its canonical address, if that address has no code.
 * 3. Deploys GaiaSystemModule (all contracts) with Ignition, with
 *    ignition/parameters/local.json and auction times from the chain clock (AUCTION_MINUTES,
 *    AUCTION_START_TIME, AUCTION_END_TIME, AUCTION_MAX_END_TIME).
 * 4. Grants ISSUER_ROLE to the land sale, from the admin account.
 * 5. Writes deployments/local.json with all addresses.
 *
 * LOCAL_DEPLOYMENT_ID (default "local") changes the names of the deployment files, for example
 * for a test node next to the normal one: deployments/<id>.json, deployments/<id>.parameters.json
 * and ignition/deployments/<id>.
 *
 * A second run on the same node resumes the Ignition deployment with the same parameters and
 * changes nothing. A run on a new node (a new genesis block) removes the old local deployment
 * files and deploys again.
 */

const CHAIN_ID = 31337;
const DEPLOYMENT_ID = process.env.LOCAL_DEPLOYMENT_ID || 'local';
const IGNITION_DIR = path.join('ignition', 'deployments', DEPLOYMENT_ID);
const OUT_FILE = path.join('deployments', `${DEPLOYMENT_ID}.json`);
// The parameters of the last deployment, with the genesis block hash of its node.
const STATE_FILE = path.join('deployments', `${DEPLOYMENT_ID}.parameters.json`);

type State = { genesisHash: string; deployBlock: string; parameters: DeploymentParameters };

const connection = await network.getOrCreate();
const { viem } = connection;

// Ask the node directly: hardhat-viem also reads the chain ID, and fails with a long error.
let chainId: number;
try {
  chainId = Number(await connection.provider.request({ method: 'eth_chainId' }));
} catch {
  const config = connection.networkConfig;
  const url = config.type === 'http' ? await config.url.get() : connection.networkName;
  throw new Error(`No node answers at ${url}. Start Anvil with \`yarn chain:local\`, or set LOCAL_RPC_URL.`);
}
if (chainId !== CHAIN_ID) {
  throw new Error(`The node has chain ID ${chainId}, not ${CHAIN_ID}. Use a local Anvil node.`);
}
const publicClient = await viem.getPublicClient();

// Anvil makes a new genesis block at each start. A different hash means a new chain, so the old
// Ignition journal does not apply.
const genesisHash = (await publicClient.getBlock({ blockNumber: 0n })).hash;
let state = readState();
if (state !== undefined && state.genesisHash === genesisHash && fs.existsSync(IGNITION_DIR)) {
  console.log(`Resuming the deployment on this node (${STATE_FILE}).`);
} else {
  if (fs.existsSync(IGNITION_DIR) || state !== undefined) {
    console.log('The local deployment files are from another node. Removing them.');
  }
  fs.rmSync(IGNITION_DIR, { recursive: true, force: true });
  fs.rmSync(OUT_FILE, { force: true });
  const latest = await publicClient.getBlock();
  const parameters = withAuctionTimes(readParameters(), auctionTimes(latest.timestamp));
  state = { genesisHash, deployBlock: (latest.number + 1n).toString(), parameters };
  writeParameters(STATE_FILE, state as unknown as DeploymentParameters);
}
const { parameters } = state;
const gaia = parameters.GaiaModule;

if (await ensureRegistry(connection)) {
  console.log(`Put the ERC-6551 registry at ${CANONICAL_REGISTRY}.`);
}

const { accountImplementation, countries, squares, auction, sale, market } = await connection.ignition.deploy(
  GaiaSystemModule,
  { parameters, deploymentId: DEPLOYMENT_ID },
);

// The land sale gets ISSUER_ROLE at once. This is different from Base: there, the admin multisig
// grants it only after the auction ends (operating rule). Locally an early grant is safe, because
// the sale stays closed until auction.endTime(), and the sale then works without one more step.
// The deployer has no admin role after GaiaModule, so the grant comes from the admin account.
const admin = getAddress(gaia.admin as string);
await grantSaleIssuer(connection, countries.address, sale.address, admin);

const out = {
  chainId,
  deployBlock: Number(state.deployBlock),
  contracts: {
    GaiaCountries: countries.address,
    GaiaSquares: squares.address,
    GaiaCountryAccount: accountImplementation.address,
    GaiaAuction: auction.address,
    GaiaLandSale: sale.address,
    GaiaCountryMarket: market.address,
    ERC6551Registry: CANONICAL_REGISTRY,
  },
  admin,
  treasury: getAddress(gaia.treasury as string),
  auction: {
    startTime: Number(gaia.startTime),
    endTime: Number(gaia.endTime),
    maxEndTime: Number(gaia.maxEndTime),
  },
};
fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, `${JSON.stringify(out, bigintReplacer, 2)}\n`);

const iso = (s: number) => new Date(s * 1000).toISOString();
console.log(`
Gaia is deployed on chain ${chainId} (from block ${out.deployBlock}).
${Object.entries(out.contracts)
  .map(([name, address]) => `  ${name.padEnd(20)} ${address}`)
  .join('\n')}
  admin                ${out.admin}
  treasury             ${out.treasury}
  auction start        ${iso(out.auction.startTime)}
  auction end          ${iso(out.auction.endTime)} (max ${iso(out.auction.maxEndTime)})
Addresses: ${OUT_FILE}`);

function readState(): State | undefined {
  if (!fs.existsSync(STATE_FILE)) return undefined;
  return readParameters(STATE_FILE) as unknown as State;
}
