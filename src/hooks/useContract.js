import { useMemo } from 'react'
import { Contract } from '@ethersproject/contracts'
import { AddressZero } from '@ethersproject/constants'

import { useActiveWeb3React } from './useActiveWeb3React'
import { isAddress } from '../utils/validate'

// account is not optional
export function getSigner(library, account) {
  return library.getSigner(account).connectUnchecked()
}

// account is optional
export function getProviderOrSigner(library, account) {
  return account ? getSigner(library, account) : library
}

function getContract(address, ABI, library, account) {
  if (!isAddress(address) || address === AddressZero) {
    throw Error(`Invalid 'address' parameter '${address}'.`)
  }

  return new Contract(address, ABI, getProviderOrSigner(library, account))
}

// returns null on errors
function useContract(address, ABI, withSignerIfPossible) {
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
