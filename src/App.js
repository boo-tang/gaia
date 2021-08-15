import React from 'react'
import { Box, Flex, Heading, Spacer, useDisclosure } from '@chakra-ui/react'
import '@fontsource/inter'

import ConnectButton from './components/ConnectButton'
import { GaiaMap } from './components/GaiaMap'
import AccountModal from './components/AccountModal'

import './App.css'

function App() {
  const { isOpen, onOpen, onClose } = useDisclosure()
  return (
    <div className="App">
      <Flex className="Header">
        <Box p="3">
          <Heading size="md">GAIA</Heading>
        </Box>
        <Spacer />
        <Box>
          <ConnectButton handleOpenModal={onOpen} />
        </Box>
      </Flex>
      <GaiaMap />
      <AccountModal isOpen={isOpen} onClose={onClose} />
    </div>
  )
}

export default App
