import React from 'react'
import { MapContainer, TileLayer } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

import './App.css'
import MyGridRectangle, { TILE_WIDTH } from './components/MyGridRectangle'

const TILES = 16
const TILES_2 = TILES / 2

function MyGridLayer() {
  const rects = []

  for (let y = -TILES_2; y < TILES_2; y++) {
    for (let x = -TILES_2; x < TILES_2; x++) {
      const offsetPoint = new L.Point(x * TILE_WIDTH, y * TILE_WIDTH)

      rects.push(<MyGridRectangle offsetPoint={offsetPoint} />)
    }
  }

  return <>{rects}</>
}

function App() {
  return (
    <div className="App">
      <MapContainer
        center={[51.505, -0.09]}
        zoom={13}
        scrollWheelZoom={true}
        className="MapContainer"
      >
        <TileLayer
          attribution='&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MyGridLayer />
      </MapContainer>
    </div>
  )
}

export default App
