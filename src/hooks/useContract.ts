import { useMemo } from 'react'
import { Contract, ContractInterface } from '@ethersproject/contracts'
import { AddressZero } from '@ethersproject/constants'

import { useActiveWeb3React } from './useActiveWeb3React'
import { isAddress } from '../utils/validate'
import { Web3Provider } from '@ethersproject/providers'

// account is not optional
export function getSigner(library: Web3Provider, account: string) {
  return library.getSigner(account).connectUnchecked()
}

// account is optional
export function getProviderOrSigner(
  library: Web3Provider,
  account: string | undefined,
) {
  return account ? getSigner(library, account) : library
}

function getContract(
  address: string,
  ABI: ContractInterface,
  library: Web3Provider,
  account: string | undefined,
) {
  if (!isAddress(address) || address === AddressZero) {
    throw Error(`Invalid 'address' parameter '${address}'.`)
  }

  return new Contract(address, ABI, getProviderOrSigner(library, account))
}

// returns null on errors
function useContract(
  address: string,
  ABI: ContractInterface,
  withSignerIfPossible: boolean,
) {
  const web3 = useActiveWeb3React()
  const { library, account } = web3

  return useMemo(() => {
    if (!address || !ABI || !library) return null
    try {
      return getContract(
        address,
        ABI,
        library,
        withSignerIfPossible && account ? account : undefined,
      )
    } catch (error) {
      console.error('Failed to get contract', error)
      return null
    }
  }, [address, ABI, library, withSignerIfPossible, account])
}

export default useContract
