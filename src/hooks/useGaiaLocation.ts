import { useCallback } from 'react'

import useActiveWeb3React from './useActiveWeb3React'
import GaiaLocationABI from '../contracts/Gaia_Location.json'
import useContract from './useContract'
import addresses from '../constants/addresses'
import { fromCoorToUint } from '../utils/location'
import { Loc } from '../types'

const useGaiaLocation = (account: string) => {
  const { chainId } = useActiveWeb3React()
  const storageContractAddr = addresses.GaiaLocation[chainId || 1]
  const contract = useContract(
    storageContractAddr,
    GaiaLocationABI.abi,
    !!account,
  )

  const mintLocations = useCallback(
    async (selectedLocations: Loc[]) => {
      try {
        const locations = selectedLocations.map(_loc => {
          const loc = fromCoorToUint(_loc)
          return [loc.lat, loc.lng]
        })
        console.log('minting selected locs', locations)
        const tx = await contract?.mintMultipleLocations(locations)
        return tx
      } catch (err: any) {
        let { data: { message = '' } = {} } = err || {}
        console.error('error minting locations', message)

        return err
      }
    },
    [contract],
  )

  const getUserBalance = useCallback(async () => {
    const balance = await contract?.balanceOf(account)
    return balance
  }, [contract, account])

  const getUserLocations = useCallback(async () => {
    const locations = await contract?.getUserLocations(account)
    return locations
  }, [contract, account])

  const getOwnedLocationsInBounds = useCallback(
    async (minLoc, maxLoc) => {
      const locations = await contract?.getOwnedLocationsInBounds(
        minLoc.lat,
        minLoc.lng,
        maxLoc.latlng,
        maxLoc.long,
      )
      return locations
    },
    [contract],
  )

  return {
    contract,
    mintLocations,
    getUserBalance,
    getUserLocations,
    getOwnedLocationsInBounds,
  }
}

export default useGaiaLocation
