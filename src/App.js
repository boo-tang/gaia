import React, { useState } from 'react'
import {
  Box,
  Button,
  ChakraProvider,
  Flex,
  Heading,
  Spacer,
} from '@chakra-ui/react'
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
  return (
    <ChakraProvider>
      <div className="App">
        <Flex className="Header">
          <Box p="3">
            <Heading size="md">GAIA</Heading>
          </Box>
          <Spacer />
          <Box>
            <Button colorScheme="teal" m="1">
              Connect
            </Button>
          </Box>
        </Flex>
        <MapContainer
          center={[38, 23.74]}
          zoom={13}
          scrollWheelZoom={true}
          className="MapContainer"
        >
          <TileLayer
            attribution='&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            // url="http://{s}.tiles.wmflabs.org/osm-no-labels/{z}/{x}/{y}.png"
          />
          <RectGrid toggleLocation={toggleLocation} />
        </MapContainer>
      </div>
    </ChakraProvider>
  )
}

export default App
