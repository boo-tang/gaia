import React, { useState } from 'react'
import { Box, Button, Flex, Heading, Spacer } from '@chakra-ui/react'
import { UnsupportedChainIdError, useWeb3React } from '@web3-react/core'

import '@fontsource/inter'

import ConnectButton from './components/ConnectButton'
import { GaiaMap } from './components/GaiaMap'
import AccountModal from './components/AccountModal'
import { injected as connector } from './utils/connectors'

import './App.css'

function App() {
  const { active, account, /* connector ,*/ activate, error, deactivate } =
    useWeb3React()
  const [pendingWallet, setPendingWallet] = useState()
  const [pendingError, setPendingError] = useState()
  const tryActivation = async () => {
    let conn = typeof connector === 'function' ? await connector() : connector
    setPendingWallet(conn) // set wallet for pending view
    conn &&
      activate(conn, undefined, true).catch(error => {
        if (error instanceof UnsupportedChainIdError) {
          activate(conn) // a little janky...can't use setError because the connector isn't set
        } else {
          setPendingError(true)
        }
      })
  }

  return (
    <div className="App">
      <Flex className="Header">
        <Box p="3">
          <Heading size="md">GAIA</Heading>
        </Box>
        <Spacer />
        <Box>
          {/* <ConnectButton handleOpenModal={onOpen} /> */}
          <Button onClick={tryActivation} disabled={!!account}>
            {account ? 'Connected' : 'Connect'}
          </Button>
        </Box>
      </Flex>
      <GaiaMap />
      {/* <AccountModal isOpen={isOpen} onClose={onClose} /> */}
    </div>
  )
}

export default App
