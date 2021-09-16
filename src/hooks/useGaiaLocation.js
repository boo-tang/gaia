import { useCallback } from 'react'

import useActiveWeb3React from './useActiveWeb3React'
import GaiaLocationABI from '../contracts/Gaia_Location.json'
import useContract from './useContract'
import addresses from '../constants/addresses'
import { fromCoorToUint } from '../utils/location'

const useGaiaLocation = account => {
  const { chainId } = useActiveWeb3React()
  const storageContractAddr = addresses.GaiaLocation[chainId]
  const contract = useContract(
    storageContractAddr,
    GaiaLocationABI.abi,
    account,
  )

  const mintLocations = useCallback(
    async selectedLocations => {
      try {
        const locations = selectedLocations.map(_loc => {
          const loc = fromCoorToUint(_loc)
          return [loc.lat, loc.lng]
        })
        console.log('minting selected locs', locations)
        const tx = await contract.mintMultipleLocations(locations)
        return tx
      } catch (err) {
        let { data: { message } = {} } = err
        console.error('error minting locations', message)

        return err
      }
    },
    [contract],
  )

  const getUserBalance = useCallback(async () => {
    const balance = await contract.balanceOf(account)
    return balance
  }, [contract, account])

  const getUserLocations = useCallback(async () => {
    const locations = await contract.getOwnedLocations(account)
    return locations
  }, [contract, account])

  return { contract, mintLocations, getUserBalance, getUserLocations }
}

export default useGaiaLocation
