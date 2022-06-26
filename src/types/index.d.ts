export * from './Location'

declare global {
  interface Window {
    ethereum: any
    web3: any
  }
}
