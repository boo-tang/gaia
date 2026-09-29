import { localhost, mainnet, sepolia } from 'wagmi/chains';

// TODO: replace with the real deployed address once GaiaAuction is deployed to each network.
const addresses = {
  GaiaAuction: {
    [localhost.id]: '0xUnknown',
    [31337]: '0xUnknown',
    [sepolia.id]: '0xUnknown',
    [mainnet.id]: '0xUnknown',
  } as { [chainId: number]: `0x${string}` },
};

export default addresses;
