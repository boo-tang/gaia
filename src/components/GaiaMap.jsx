import React, { useCallback, useEffect, useState } from 'react'
import { MapContainer, TileLayer } from 'react-leaflet'
import { sortBy } from 'lodash'
import { Button, ButtonGroup, Input } from '@chakra-ui/react'
import { BigNumber } from '@ethersproject/bignumber'

import useActiveWeb3React from '../hooks/useActiveWeb3React'
import useGaiaLocation from '../hooks/useGaiaLocation'
import RectGrid, { TEMP_LAT_START, TEMP_LNG_START } from './RectGrid'

export const GaiaMap = () => {
  const { account } = useActiveWeb3React()
  const [pendingTx, setPendingTx] = useState(false)

  ////////////////////////////////////////////////////////////
  ////////////// Selected Locations tracking /////////////////
  ////////////////////////////////////////////////////////////
  const [selectedLocations, updateSelectedLocations] = useState([])
  const [ownedLocations, updateOwnedLocations] = useState([])
  const toggleLocation = useCallback(
    loc => {
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
    },
    [updateSelectedLocations, selectedLocations],
  )

  ////////////////////////////////////////////////////////////
  ////////////////// Web3 Contract Code //////////////////////
  ////////////////////////////////////////////////////////////
  const { mintLocations, getUserLocations } = useGaiaLocation(account)

  const onClick = async () => {
    setPendingTx(true)
    const tx = await mintLocations(selectedLocations)
    console.log('tx', tx, 'typeof wait', typeof tx.wait)
    if (tx.wait) {
      tx.wait()
        .catch(err => {
          console.error('err on tx.wait', err)
        })
        .finally(() => setPendingTx(false))
    } else {
      setPendingTx(false)
    }
  }

  // read contract
  useEffect(() => {
    const fn = async () => {
      if (account && !pendingTx) {
        const locations = await getUserLocations()
        updateOwnedLocations(locations)
        console.log('USER LOCATIONS', locations)
      }
    }
    fn()
  }, [account, pendingTx, getUserLocations])

  if (typeof account === 'undefined') {
    return (
      <div className="MapContainer">
        Loading Web3, accounts, and contract... Reload page
      </div>
    )
  }

  console.log(selectedLocations)

  return (
    <>
      {!!selectedLocations?.length && (
        <Button
          style={{
            position: 'fixed',
            top: '6vh',
            left: '50%',
            transform: 'translate(-50%, 0)',
            zIndex: '10000',
          }}
          isLoading={pendingTx}
          onClick={onClick}
        >
          Click to Purchase
        </Button>
      )}
      <MapContainer
        center={[TEMP_LAT_START + 0.01, TEMP_LNG_START + 0.014]}
        zoom={13}
        scrollWheelZoom={true}
        className="MapContainer"
      >
        <TileLayer
          attribution='&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          // url="http://{s}.tiles.wmflabs.org/osm-no-labels/{z}/{x}/{y}.png"
        />
        {!pendingTx && (
          <RectGrid
            toggleLocation={toggleLocation}
            ownedLocations={ownedLocations}
          />
        )}
      </MapContainer>
    </>
  )
}
