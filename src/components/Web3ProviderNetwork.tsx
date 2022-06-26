import { NetworkContextName } from '../constants'
import { createWeb3ReactRoot } from '@web3-react/core'
import { ReactNode } from 'react'
import { Web3Provider } from '@ethersproject/providers'

const Web3ReactRoot = createWeb3ReactRoot(NetworkContextName)

function Web3ProviderNetwork({
  children,
  getLibrary,
}: {
  children: ReactNode
  getLibrary: (provider: any) => Web3Provider
}) {
  return <Web3ReactRoot getLibrary={getLibrary}>{children}</Web3ReactRoot>
}

export default Web3ProviderNetwork
