import React from 'react'
import ReactDOM from 'react-dom'
import reportWebVitals from './reportWebVitals'
import { ChakraProvider } from '@chakra-ui/react'
import { Web3ReactProvider } from '@web3-react/core'
import { store } from './store'
import { Provider as ReduxProvider } from 'react-redux'

import './index.css'
import App from './App'
import getLibrary from './utils/getLibrary'
import Web3ProviderNetwork from './components/Web3ProviderNetwork'

ReactDOM.render(
  <React.StrictMode>
    <Web3ReactProvider getLibrary={getLibrary}>
      <Web3ProviderNetwork getLibrary={getLibrary}>
        <ChakraProvider>
          <ReduxProvider store={store}>
            <App />
          </ReduxProvider>
        </ChakraProvider>
      </Web3ProviderNetwork>
    </Web3ReactProvider>
  </React.StrictMode>,
  document.getElementById('root'),
)

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals()
