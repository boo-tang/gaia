import { http, createConfig } from 'wagmi';
import { mainnet, sepolia, localhost } from 'wagmi/chains';

export const config = createConfig({
  chains: [mainnet, sepolia],
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
    [localhost.id]: http(),
  },
});
