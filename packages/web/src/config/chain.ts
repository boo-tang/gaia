// The chains that the app supports. The deployment file selects one of them.
import { type Chain, anvil, baseSepolia } from 'viem/chains';

export interface Faucet {
  name: string;
  url: string;
  /** A short condition of the faucet, for example that it needs a sign-in. */
  note?: string;
}

export interface GaiaChain {
  chain: Chain;
  /** The RPC URL when `VITE_RPC_URL` is not set. Not there: the variable is required. */
  defaultRpcUrl?: string;
  /** Faucets of test ETH. Only on a public testnet. */
  faucets?: readonly Faucet[];
}

const SUPPORTED_CHAINS: GaiaChain[] = [
  { chain: anvil, defaultRpcUrl: 'http://127.0.0.1:8545' },
  {
    chain: baseSepolia,
    faucets: [
      {
        name: 'Coinbase Developer Platform faucet',
        url: 'https://portal.cdp.coinbase.com/products/faucet',
        note: 'needs a free Coinbase sign-in',
      },
      {
        name: 'QuickNode faucet',
        url: 'https://faucet.quicknode.com/base/sepolia',
        note: 'needs a little mainnet ETH in the wallet',
      },
    ],
  },
];

const TESTNET_CHAIN_IDS: readonly number[] = [anvil.id, baseSepolia.id];

/** True when the chain is a testnet: the app shows the testnet badge and the faucets. */
export const isTestnet = (chainId: number) => TESTNET_CHAIN_IDS.includes(chainId);

/** The chain of a deployment file. Throws an error when the app does not support the chain. */
export const chainForDeployment = (chainId: number): GaiaChain => {
  const found = SUPPORTED_CHAINS.find(entry => entry.chain.id === chainId);
  if (found === undefined) {
    const supported = SUPPORTED_CHAINS.map(entry => `${entry.chain.id} (${entry.chain.name})`).join(', ');
    throw new Error(`The deployment file has chain ID ${chainId}. The app supports: ${supported}.`);
  }
  return found;
};
