import { localhost, mainnet } from 'wagmi/chains';

const addresses = {
  GaiaLocation: {
    [localhost.id]: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    [31337]: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    [mainnet.id]: '0xUnknown',
  } as { [key: number]: `0x${string}` },
};

export default addresses;
