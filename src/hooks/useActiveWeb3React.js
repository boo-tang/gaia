import { useWeb3React as useWeb3ReactCore } from '@web3-react/core'

import { NetworkContextName } from '../constants'

export function useActiveWeb3React() {
  const context = useWeb3ReactCore()
  const contextNetwork = useWeb3ReactCore(NetworkContextName)
  return context.active
    ? { ...context, account: context.account }
    : { ...contextNetwork, account: contextNetwork.account }
  // return { ...context, account: context.account }
}

export default useActiveWeb3React
