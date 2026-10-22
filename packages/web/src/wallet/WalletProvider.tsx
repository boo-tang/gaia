// All wallet setup: the wagmi config, the connectors, the query client and RainbowKit. The rest of
// the app uses only wagmi hooks. A change of the wallet kit changes only the files in this folder.
import { RainbowKitProvider, connectorsForWallets } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import {
  base,
  injectedWallet,
  metaMaskWallet,
  rainbowWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { http } from 'viem';
import { WagmiProvider, createConfig } from 'wagmi';

import { gaiaChain, webConfig } from '../config/app-config';

const APP_NAME = 'Gaia';

// `base` is the Base Account (Coinbase Smart Wallet). It does not work on Anvil: there, use an
// injected wallet with an Anvil key. The other wallets need a WalletConnect project ID.
const projectId = webConfig.walletConnectProjectId;
if (projectId === undefined) {
  console.warn('VITE_WALLETCONNECT_PROJECT_ID is not set: the wallet list has no WalletConnect wallets.');
}
const wallets =
  projectId === undefined
    ? [injectedWallet, base]
    : [injectedWallet, base, metaMaskWallet, rainbowWallet, walletConnectWallet];

const connectors = connectorsForWallets([{ groupName: 'Wallets', wallets }], {
  appName: APP_NAME,
  projectId: projectId ?? '',
});

/** One chain: the chain of the deployment file. */
export const wagmiConfig = createConfig({
  chains: [gaiaChain.chain],
  connectors,
  transports: { [gaiaChain.chain.id]: http(webConfig.rpcUrl) },
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}

export const WalletProvider = ({ children }: { children: ReactNode }) => {
  // One query cache for each provider, so each test starts with an empty cache.
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider appInfo={{ appName: APP_NAME }} modalSize="compact">
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
};
