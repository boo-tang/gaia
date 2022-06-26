import { Rectangle as RectangleType, PathOptions } from 'leaflet'
import React, { useRef, useState } from 'react'
import { Rectangle } from 'react-leaflet'

import { Loc, LocTuple } from '../types'
import { fromCoorToUint, getLocationBounds } from '../utils/location'

const pathOptions = (isSelected: boolean, isOwned: boolean) => {
  return {
    color: 'black',
    opacity: 0.25,
    weight: 2,
    fill: true,
    fillColor: isOwned ? 'green' : isSelected ? 'red' : null,
    fillOpacity: isSelected || isOwned ? 0.5 : 0,
  } as PathOptions
}

const isLocOwned = (_loc: Loc, userLocations: LocTuple[]) => {
  const loc = fromCoorToUint(_loc)
  return userLocations.some(([lat, lng]) => {
    return lat === loc.lat && lng === loc.lng
  })
}

const Rect = ({
  loc,
  toggleLocation,
  userLocations,
}: {
  loc: Loc
  toggleLocation: (loc: Loc) => void
  userLocations: LocTuple[]
}) => {
  const [isSelected, updateIsSelected] = useState(false)
  // get bounds from loc
  const bounds = getLocationBounds(loc)
  let isOwned = false

  if (isLocOwned(loc, userLocations)) {
    isOwned = true
  }

  const rectRef = useRef() as React.MutableRefObject<RectangleType>
  const standardStyle = pathOptions(isSelected, isOwned)
  const eventHandlers = {
    mouseover: () => {
      rectRef.current?.setStyle({
        ...standardStyle,
        opacity: 1,
        fillOpacity: isSelected ? 0.75 : 0.5,
        fillColor: isOwned ? 'green' : isSelected ? 'red' : 'white',
      })
    },
    mouseout: () => {
      rectRef.current?.setStyle(standardStyle)
    },
    click: () => {
      toggleLocation(loc)
      updateIsSelected(!isSelected)
    },
  }

  return (
    <Rectangle
      pathOptions={standardStyle}
      bounds={bounds}
      eventHandlers={eventHandlers}
      ref={rectRef}
    >
      {/* <Popup>
        <UnorderedList>
          <ListItem>
            <b>Owner: </b> boo-tang.eth
          </ListItem>
          <ListItem>
            <b>Name: </b> Boo Tang Clan
          </ListItem>
          <ListItem>
            <b>Flag: </b> <img src={flag} alt="Flag" />
          </ListItem>
        </UnorderedList>
      </Popup> */}
    </Rectangle>
  )
}

export default React.memo(Rect)
