import React, { useCallback, useEffect, useState } from 'react'
import { MapContainer, TileLayer } from 'react-leaflet'
import { Button } from '@chakra-ui/react'
import { useSelector, useDispatch } from 'react-redux'

import RectGrid from './RectGrid'
import useActiveWeb3React from '../hooks/useActiveWeb3React'
import useGaiaLocation from '../hooks/useGaiaLocation'
import {
  toggleLocation as toggleLocationAction,
  resetLocations as resetLocationsAction,
} from '../state/locations'

export const GaiaMap = () => {
  const { account } = useActiveWeb3React()
  const dispatch = useDispatch()

  // loading state for running eth transaction
  const [pendingTx, setPendingTx] = useState(false)

  // ready state for map to display grid
  const [mapReady, setMapReady] = useState(false)

  ////////////////////////////////////////////////////////////
  ////////////// Selected Locations tracking /////////////////
  ////////////////////////////////////////////////////////////
  // selected locations come from app Redux store
  const { selectedLocations } = useSelector(state => state.locations)

  const toggleLocation = useCallback(
    loc => dispatch(toggleLocationAction(loc)),
    [dispatch],
  )
  const resetLocations = useCallback(
    loc => dispatch(resetLocationsAction()),
    [dispatch],
  )

  ////////////////////////////////////////////////////////////
  ////////////////// Web3 Contract Code //////////////////////
  ////////////////////////////////////////////////////////////
  // owned locations are loaded from blockchain to component state
  const [ownedLocations, updateOwnedLocations] = useState([])

  const { mintLocations, getUserLocations } = useGaiaLocation(account)

  const onPurchase = async () => {
    setPendingTx(true)
    const tx = await mintLocations(selectedLocations)
    if (tx.wait) {
      tx.wait()
        .catch(err => {
          console.error('err on tx.wait', err)
        })
        .finally(() => {
          resetLocations()
          setPendingTx(false)
        })
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
          onClick={onPurchase}
        >
          Click to Purchase
        </Button>
      )}
      <MapContainer
        // start rendering the map from Manhattan
        center={[40.76203, -73.96277]}
        zoom={12}
        scrollWheelZoom={true}
        className="MapContainer"
        whenReady={() => setMapReady(true)}
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
            mapReady={mapReady}
          />
        )}
      </MapContainer>
    </>
  )
}
