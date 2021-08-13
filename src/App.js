import React, { useState } from 'react'
import { MapContainer, TileLayer } from 'react-leaflet'
import { sortBy } from 'lodash'

import './App.css'
import RectGrid from './components/RectGrid'

function App() {
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
  console.log('selectedLocations', selectedLocations)
  return (
    <div className="App">
      {/* <div className="Header">

      </div> */}
      <MapContainer
        center={[38, 23.74]}
        zoom={13}
        scrollWheelZoom={true}
        className="MapContainer"
      >
        <TileLayer
          attribution='&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <RectGrid toggleLocation={toggleLocation} />
      </MapContainer>
    </div>
  )
}

export default App
