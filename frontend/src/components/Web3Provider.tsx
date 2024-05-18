import { ReactNode } from 'react';
import { WagmiProvider, createConfig, http } from 'wagmi';
import { mainnet, localhost, sepolia } from 'wagmi/chains';
import { ConnectKitProvider /*getDefaultConfig*/ } from 'connectkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export const config = createConfig({
  chains: [localhost, mainnet, sepolia],
  transports: {
    [localhost.id]: http(),
    [mainnet.id]: http(),
    [sepolia.id]: http(),
  },
});

// const config = createConfig(
//   getDefaultConfig({
//     // Your dApps chains
//     chains: [mainnet, localhost],
//     transports: {
//       // RPC URL for each chain
//       [mainnet.id]: http(
//         `https://eth-mainnet.g.alchemy.com/v2/${process.env.NEXT_PUBLIC_ALCHEMY_ID}`,
//       ),
//       [localhost.id]: http('http://localhost:8545'),
//     },

//     walletConnectProjectId:
//       process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '',

//     appName: 'Gaia',

//     appDescription: 'Gaia land NFTs',
//     appUrl: 'https://gaialand.xyz',
//     appIcon: 'https://gaialand.xyz/logo.png',
//   }),
// );

const queryClient = new QueryClient();

export const Web3Provider = ({ children }: { children: ReactNode }) => {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ConnectKitProvider>{children}</ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
};
