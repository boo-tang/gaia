// The app: the layout with its parts. The bid panel and the bidder view replace the placeholders.
import type { Square } from '@gaia/core';

import { useCallback, useMemo, useState } from 'react';

import { AuctionStatusBar } from './components/AuctionStatusBar';
import { NetworkGuard } from './components/NetworkGuard';
import { Placeholder } from './components/Placeholder';
import { SelectedSquare } from './components/SelectedSquare';
import { AppLayout } from './layout/AppLayout';
import { LazyMap } from './map/LazyMap';
import { WalletButton } from './wallet/WalletButton';

export const App = () => {
  // One selected square. A click on it again removes the selection.
  const [selected, setSelected] = useState<Square>();
  const selectedSquares = useMemo(() => (selected === undefined ? [] : [selected]), [selected]);
  const onSquareClick = useCallback(
    (square: Square) =>
      setSelected(old => (old !== undefined && old.lat === square.lat && old.lng === square.lng ? undefined : square)),
    [],
  );

  return (
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
      map={<LazyMap selected={selectedSquares} onSquareClick={onSquareClick} />}
      bidPanel={
        <Placeholder title="Bid">
          <SelectedSquare square={selected} />
        </Placeholder>
      }
      bidderView={
        <Placeholder title="Your bids">
          <button type="button" disabled>
            Withdraw
          </button>
        </Placeholder>
      }
    />
  );
};
