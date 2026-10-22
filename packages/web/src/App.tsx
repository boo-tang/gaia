// The app: the layout with its parts. The map (map area), the bid panel and the bidder view
// replace the placeholders.
import { AuctionStatusBar } from './components/AuctionStatusBar';
import { NetworkGuard } from './components/NetworkGuard';
import { Placeholder } from './components/Placeholder';
import { AppLayout } from './layout/AppLayout';
import { WalletButton } from './wallet/WalletButton';

export const App = () => (
  <AppLayout
    header={
      <>
        <h1 className="app-title">Gaia</h1>
        <AuctionStatusBar />
        <div className="app-wallet">
          <WalletButton />
        </div>
      </>
    }
    notices={<NetworkGuard />}
    map={<Placeholder title="Map" />}
    bidPanel={<Placeholder title="Bid" />}
    bidderView={
      <Placeholder title="Your bids">
        <button type="button" disabled>
          Withdraw
        </button>
      </Placeholder>
    }
  />
);
