import React, { useState } from 'react'
import { useMapEvents } from 'react-leaflet'

import { COOR_PRECISION } from '../constants'
import Rect from './Rect'

export const TILE_WIDTH = 1 / COOR_PRECISION

export const TEMP_GRID_HEIGHT = 64
// export const TEMP_LAT_START = 37.9
// export const TEMP_LNG_START = 23.6
export const TEMP_LAT_START = 40.768699
export const TEMP_LNG_START = -73.9897407

const locs = []

const roundLoc = num =>
  Math.round((num + Number.EPSILON) * COOR_PRECISION) / COOR_PRECISION

let lng = TEMP_LNG_START
for (let i = 0; i < TEMP_GRID_HEIGHT; i++) {
  let lat = TEMP_LAT_START
  for (let j = 0; j < TEMP_GRID_HEIGHT; j++) {
    const loc = {
      lat: roundLoc(lat),
      lng: roundLoc(lng),
    }

    locs.push(loc)
    lat += TILE_WIDTH
  }
  lng += TILE_WIDTH
}

const RectGrid = ({ ownedLocations = [], toggleLocation, ...props }) => {
  const [showGrid, changeShowGrid] = useState(true)
  const map = useMapEvents({
    zoomend: () => {
      if (map.getZoom() < 11) {
        changeShowGrid(false)
      } else if (!showGrid) {
        changeShowGrid(true)
      }
    },
  })

  if (!showGrid) {
    return false
  }

  return (
    <>
      {locs.map(loc => (
        <Rect
          // loc={loc}
          lat={loc.lat}
          lng={loc.lng}
          key={`${loc.lat}-${loc.lng}`}
          toggleLocation={toggleLocation}
          // ownedLocations={ownedLocations}
        />
      ))}
    </>
  )
}

export default RectGrid
