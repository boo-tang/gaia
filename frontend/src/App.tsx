import { ConnectKitButton } from 'connectkit';

import './App.css';
import { GaiaMap } from './components/GaiaMap';

function App() {
  return (
    <div className="App">
      <header className="app-header">
        <h1>Gaia</h1>
        <ConnectKitButton />
      </header>
      <GaiaMap />
    </div>
  );
}

export default App;
