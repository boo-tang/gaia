import { InjectedConnector } from '@web3-react/injected-connector'

export const injected = new InjectedConnector({
  supportedChainIds: [
    1, // mainnet
    1337, // localhost
  ],
})
