import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider as ReduxProvider } from 'react-redux';

import App from './App';
import { store } from './store';
import { Web3Provider } from './components/Web3Provider';

const root = ReactDOM.createRoot(document.getElementById('root')!);

root.render(
  <React.StrictMode>
    <Web3Provider>
      <ReduxProvider store={store}>
        <App />
      </ReduxProvider>
    </Web3Provider>
  </React.StrictMode>,
);
