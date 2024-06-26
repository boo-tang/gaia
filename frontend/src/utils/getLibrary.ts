import { ExternalProvider, Web3Provider } from "@ethersproject/providers";

import ChainId from "../constants/chains";

const NETWORK_POLLING_INTERVALS = {
  [ChainId.ARBITRUM]: 1_000,
  [ChainId.ARBITRUM_TESTNET]: 1_000,
  [ChainId.HARMONY]: 15_000,
};

export default function getLibrary(provider: ExternalProvider) {
  const library = new Web3Provider(provider, "any");
  library.pollingInterval = 15_000;
  library.detectNetwork().then((network) => {
    const networkPollingInterval = NETWORK_POLLING_INTERVALS[network.chainId];
    if (networkPollingInterval) {
      console.debug("Setting polling interval", networkPollingInterval);
      library.pollingInterval = networkPollingInterval;
    }
  });
  return library;
}
