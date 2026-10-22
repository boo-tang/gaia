// The chains that the app supports. The deployment file selects one of them.
import { type Chain, anvil, baseSepolia } from 'viem/chains';

export interface GaiaChain {
  chain: Chain;
  /** The RPC URL when `VITE_RPC_URL` is not set. Not there: the variable is required. */
  defaultRpcUrl?: string;
}

const SUPPORTED_CHAINS: GaiaChain[] = [
  { chain: anvil, defaultRpcUrl: 'http://127.0.0.1:8545' },
  { chain: baseSepolia },
];

/** The chain of a deployment file. Throws an error when the app does not support the chain. */
export const chainForDeployment = (chainId: number): GaiaChain => {
  const found = SUPPORTED_CHAINS.find(entry => entry.chain.id === chainId);
  if (found === undefined) {
    const supported = SUPPORTED_CHAINS.map(entry => `${entry.chain.id} (${entry.chain.name})`).join(', ');
    throw new Error(`The deployment file has chain ID ${chainId}. The app supports: ${supported}.`);
  }
  return found;
};
