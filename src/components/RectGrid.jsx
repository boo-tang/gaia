import React from 'react'

import { Rect } from './Rect'

export const TILE_WIDTH = 0.01

export const TEMP_GRID_HEIGHT = 32
const TEMP_LAT_START = 37.9
const TEMP_LNG_START = 23.6

const roundLoc = num => Math.round((num + Number.EPSILON) * 100) / 100

const RectGrid = ({ toggleLocation }) => {
  const locs = []
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
  return (
    <>
      {locs.map(loc => (
        <Rect
          loc={loc}
          key={`${loc.lat}-${loc.lng}`}
          toggleLocation={toggleLocation}
        />
      ))}
    </>
  )
}

export default RectGrid
