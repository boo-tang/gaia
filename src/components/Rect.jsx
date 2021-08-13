import React, { useRef, useState } from 'react'
import { Rectangle } from 'react-leaflet'

const pathOptions = isSelected => ({
  color: 'black',
  opacity: 0.25,
  weight: 2,
  fill: true,
  fillColor: isSelected ? 'red' : null,
  fillOpacity: isSelected ? 0.5 : 0,
})

export const Rect = ({ loc, toggleLocation }) => {
  const [isSelected, updateIsSelected] = useState(false)
  // get bounds from loc
  const { lat, lng } = loc
  const bounds = [
    [lat - 0.005, lng - 0.005],
    [lat + 0.005, lng + 0.005],
  ]
  const rectRef = useRef()
  const eventHandlers = {
    mouseover: () => {
      // console.log(rectRef)
      console.log(isSelected)
      rectRef.current.setStyle({
        ...pathOptions(isSelected),
        opacity: 1,
        fillOpacity: isSelected ? 0.75 : 0.5,
        fillColor: isSelected ? 'red' : 'white',
      })
    },
    mouseout: () => {
      rectRef.current.setStyle(pathOptions(isSelected))
    },
    click: () => {
      console.log(loc)
      toggleLocation(loc)
      updateIsSelected(!isSelected)
    },
  }
  return (
    <Rectangle
      pathOptions={pathOptions(isSelected)}
      bounds={bounds}
      eventHandlers={eventHandlers}
      ref={rectRef}
    />
  )
}
