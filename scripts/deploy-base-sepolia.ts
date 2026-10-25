import type { DeploymentParameters } from '@nomicfoundation/ignition-core';
import { network } from 'hardhat';
import fs from 'node:fs';
import path from 'node:path';
import { getAddress, isAddress } from 'viem';

import GaiaSystemModule from '../ignition/modules/GaiaSystem';
import { writeDeploymentFile } from './lib/deployment-file';
import { readParameters, withAuctionTimes, writeParameters } from './lib/local-parameters';
import { CANONICAL_REGISTRY } from './lib/registry';

/*
 * Deploys all Gaia contracts to Base Sepolia:
 *
 *   GAIA_ADMIN=0x… GAIA_TREASURY=0x… \
 *   AUCTION_START_TIME=… AUCTION_END_TIME=… AUCTION_MAX_END_TIME=… \
 *   yarn deploy:base-sepolia
 *
 * The RPC URL and the deployer key are BASE_SEPOLIA_RPC_URL and BASE_SEPOLIA_DEPLOYER_KEY in the
 * Hardhat keystore (see hardhat.config.ts). The auction times are Unix seconds.
 *
 * 1. Checks the chain ID (84532) and that the canonical ERC-6551 registry has code.
 * 2. Deploys GaiaSystemModule with Ignition, with ignition/parameters/base-sepolia.json, the admin,
 *    the treasury and the auction times. GaiaModule moves the admin role to GAIA_ADMIN and the
 *    deployer keeps no role, so GAIA_ADMIN must be another account.
 * 3. Writes deployments/base-sepolia.json with all addresses.
 *
 * The land sale does not get ISSUER_ROLE: the admin grants it after the auction ends.
 *
 * The first run saves its parameters in deployments/base-sepolia.parameters.json. A later run
 * (for example after a failed transaction) resumes the Ignition deployment with these parameters
 * and ignores the environment values. For a new deployment, remove that file and
 * ignition/deployments/base-sepolia.
 */

const CHAIN_ID = 84532;
const DEPLOYMENT_ID = 'base-sepolia';
const PARAMETERS_FILE = path.join('ignition', 'parameters', 'base-sepolia.json');
const OUT_FILE = path.join('deployments', `${DEPLOYMENT_ID}.json`);
// The parameters of the first run, with its deploy block.
const STATE_FILE = path.join('deployments', `${DEPLOYMENT_ID}.parameters.json`);

type State = { deployBlock: string; parameters: DeploymentParameters };

const connection = await network.getOrCreate();
const { viem } = connection;
const publicClient = await viem.getPublicClient();

const chainId = await publicClient.getChainId();
if (chainId !== CHAIN_ID) {
  throw new Error(`The RPC has chain ID ${chainId}, not ${CHAIN_ID}. Use \`--network baseSepolia\`.`);
}
const registryCode = await publicClient.getCode({ address: CANONICAL_REGISTRY });
if (registryCode === undefined || registryCode === '0x') {
  throw new Error(`No ERC-6551 registry at ${CANONICAL_REGISTRY}.`);
}
const [deployer] = await viem.getWalletClients();

let state: State;
if (fs.existsSync(STATE_FILE)) {
  console.log(`Resuming the deployment with the parameters of ${STATE_FILE}.`);
  state = readParameters(STATE_FILE) as unknown as State;
} else {
  const admin = requiredAddress('GAIA_ADMIN');
  const treasury = requiredAddress('GAIA_TREASURY');
  if (admin === getAddress(deployer.account.address)) {
    throw new Error('GAIA_ADMIN is the deployer. The deployer gives up the admin role, so use another account.');
  }
  const times = {
    startTime: requiredTime('AUCTION_START_TIME'),
    endTime: requiredTime('AUCTION_END_TIME'),
    maxEndTime: requiredTime('AUCTION_MAX_END_TIME'),
  };
  const latest = await publicClient.getBlock();
  if (!(times.startTime < times.endTime && times.endTime <= times.maxEndTime && times.endTime > latest.timestamp)) {
    throw new Error('The auction times must have start < end <= max end, and the end must be in the future.');
  }
  const base = readParameters(PARAMETERS_FILE);
  const parameters = withAuctionTimes(
    {
      ...base,
      GaiaModule: { ...base.GaiaModule, admin, treasury },
      GaiaLandSaleModule: { ...base.GaiaLandSaleModule, treasury },
    },
    times,
  );
  // Events start after the latest block, so the indexer can start at the next one.
  state = { deployBlock: (latest.number + 1n).toString(), parameters };
  writeParameters(STATE_FILE, state as unknown as DeploymentParameters);
}
const gaia = state.parameters.GaiaModule;

console.log(`Deploying from ${deployer.account.address}.`);
const contracts = await connection.ignition.deploy(GaiaSystemModule, {
  parameters: state.parameters,
  deploymentId: DEPLOYMENT_ID,
});

writeDeploymentFile(OUT_FILE, {
  chainId,
  deployBlock: Number(state.deployBlock),
  contracts,
  admin: gaia.admin as string,
  treasury: gaia.treasury as string,
  auction: {
    startTime: gaia.startTime as bigint,
    endTime: gaia.endTime as bigint,
    maxEndTime: gaia.maxEndTime as bigint,
  },
});

function requiredAddress(name: string) {
  const value = process.env[name];
  if (value === undefined || !isAddress(value, { strict: false })) {
    throw new Error(`${name} must be an address.`);
  }
  return getAddress(value);
}

function requiredTime(name: string) {
  const value = process.env[name];
  if (value === undefined || !/^\d+$/.test(value)) {
    throw new Error(`${name} must be a Unix time in seconds.`);
  }
  return BigInt(value);
}
