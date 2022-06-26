import React, { useState } from 'react'
import { Box, Button, Flex, Heading, Spacer } from '@chakra-ui/react'
import { UnsupportedChainIdError, useWeb3React } from '@web3-react/core'

import '@fontsource/inter'

import { GaiaMap } from './components/GaiaMap'
import { injected as connector } from './utils/connectors'
// import { injected } from './utils/connectors'

import './App.css'
import { InjectedConnector } from '@web3-react/injected-connector'

function App() {
  const { active, account, /* connector ,*/ activate, error, deactivate } =
    useWeb3React()
  const [pendingWallet, setPendingWallet] = useState<InjectedConnector>()
  const [pendingError, setPendingError] = useState<boolean>()
  const tryActivation = async () => {
    let conn = connector
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
          <Button onClick={tryActivation} disabled={!!account}>
            {account ? 'Connected' : 'Connect'}
          </Button>
        </Box>
      </Flex>
      <GaiaMap />
    </div>
  )
}

export default App
