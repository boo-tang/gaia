import { ConnectKitButton } from 'connectkit';

import './App.css';
import { useAuctionConfig } from './chain/useGaiaAuction';
import { AuctionView } from './features/auction/AuctionView';
import { PostAuctionView } from './features/postAuction/PostAuctionView';

function App() {
  const { config } = useAuctionConfig();
  const hasEnded = !!config && Math.floor(Date.now() / 1000) > Number(config.endTime);

  return (
    <div className="App">
      <header className="app-header">
        <h1>Gaia</h1>
        <ConnectKitButton />
      </header>
      {hasEnded ? <PostAuctionView /> : <AuctionView />}
    </div>
  );
}

export default App;
