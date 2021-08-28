import React, { useCallback, useEffect, useState } from 'react'
import { MapContainer, TileLayer } from 'react-leaflet'
import { sortBy } from 'lodash'
import { Button, Input } from '@chakra-ui/react'
import { Contract } from '@ethersproject/contracts'
import { BigNumber } from '@ethersproject/bignumber'

import RectGrid from './RectGrid'
import useActiveWeb3React from '../hooks/useActiveWeb3React'

export const GaiaMap = () => {
  const { account } = useActiveWeb3React()
  ////////////////////////////////////////////////////////////
  ////////////// Selected Locations tracking /////////////////
  ////////////////////////////////////////////////////////////
  const [selectedLocations, updateSelectedLocations] = useState([])
  const toggleLocation = loc => {
    const filteredLocs = selectedLocations.filter(
      selectedLoc =>
        !(selectedLoc.lat === loc.lat && selectedLoc.lng === loc.lng),
    )
    if (filteredLocs.length !== selectedLocations.length) {
      // if length changed, then we removed existing item, update locs
      updateSelectedLocations(filteredLocs)
    } else {
      // if length is same, location is new so add and update
      const updatedLocs = selectedLocations.concat(loc)
      updateSelectedLocations(sortBy(updatedLocs, ['lat', 'lng']))
    }
  }

  if (typeof web3 === 'undefined') {
    return (
      <div className="App">
        Loading Web3, accounts, and contract... Reload page
      </div>
    )
  }

  ////////////////////////////////////////////////////////////
  ////////////////// Web3 Contract Code //////////////////////
  ////////////////////////////////////////////////////////////
  // let storageValue
  // let StorageContract
  // if (web3.account) {
  //   console.log('web3', web3)
  //   const storageContractAddr = SimpleStorage[web3.chainId]
  //   console.log(storageContractAddr)

  //   StorageContract = new Contract(storageContractAddr, SimpleStorageABI.abi)
  //   console.log(StorageContract)
  //   storageValue = await StorageContract.get()
  // }

  return (
    <>
      <MapContainer
        center={[38, 23.74]}
        zoom={13}
        scrollWheelZoom={true}
        className="MapContainer"
      >
        <TileLayer
          attribution='&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          // url="http://{s}.tiles.wmflabs.org/osm-no-labels/{z}/{x}/{y}.png"
        />
        <RectGrid toggleLocation={toggleLocation} />
      </MapContainer>
    </>
  )
}
