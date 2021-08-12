import { useRef } from 'react'
import { Rectangle, useMap } from 'react-leaflet'

export const TILE_WIDTH = 8
export const TILE_WIDTH_2 = TILE_WIDTH / 2

function MyGridRectangle(props) {
  const map = useMap()
  const rectRef = useRef()

  const pathOptions = {
    color: 'black',
    opacity: 0.25,
    weight: 2,
    fill: true,
    fillOpacity: 0,
  }

  const eventHandlers = {
    mouseover: () => {
      console.log(rectRef)
      rectRef.current.setStyle({
        ...pathOptions,
        opacity: 1,
        fillOpacity: 0.5,
        fillColor: 'white',
      })
    },
    mouseout: () => {
      rectRef.current.setStyle(pathOptions)
    },
  }

  const origin = map.project(map.getCenter())

  const corner1 = origin
    .subtract([TILE_WIDTH_2, TILE_WIDTH_2])
    .add(props.offsetPoint)
  const corner2 = origin
    .add([TILE_WIDTH_2, TILE_WIDTH_2])
    .add(props.offsetPoint)

  const originLatLong = map.unproject(corner1)
  const cornerLatLong = map.unproject(corner2)

  return (
    <Rectangle
      ref={rectRef}
      bounds={[originLatLong, cornerLatLong]}
      pathOptions={pathOptions}
      eventHandlers={eventHandlers}
    />
  )
}

export default MyGridRectangle
