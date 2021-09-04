import React, { useRef, useState } from 'react'
import { Rectangle } from 'react-leaflet'

const pathOptions = (isSelected, isOwned) => ({
  color: 'black',
  opacity: 0.25,
  weight: 2,
  fill: true,
  fillColor: isOwned ? 'green' : isSelected ? 'red' : null,
  fillOpacity: isSelected || isOwned ? 0.5 : 0,
})

export const Rect = ({ loc, toggleLocation }) => {
  const [isSelected, updateIsSelected] = useState(false)
  // get bounds from loc
  const { lat, lng, isOwned } = loc
  if (lat == 38.02 && lng == 23.78) {
    console.log(loc)
  }
  const bounds = [
    [lat - 0.005, lng - 0.005],
    [lat + 0.005, lng + 0.005],
  ]
  const rectRef = useRef()
  const standardStyle = pathOptions(isSelected, isOwned)
  const eventHandlers = {
    mouseover: () => {
      rectRef.current.setStyle({
        ...standardStyle,
        opacity: 1,
        fillOpacity: isSelected ? 0.75 : 0.5,
        fillColor: isOwned ? 'green' : isSelected ? 'red' : 'white',
      })
    },
    mouseout: () => {
      rectRef.current.setStyle(standardStyle)
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
    />
  )
}
