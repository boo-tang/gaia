// The app: the layout with its parts. The bidder view replaces its placeholder.
import type { Square } from '@gaia/core';

import { useCallback } from 'react';

import { AuctionStatusBar } from './components/AuctionStatusBar';
import { NetworkGuard } from './components/NetworkGuard';
import { Placeholder } from './components/Placeholder';
import { useIsPhone } from './hooks/useIsPhone';
import { AppLayout } from './layout/AppLayout';
import { LazyMap } from './map/LazyMap';
import { SelectionPanel } from './selection/SelectionPanel';
import { toolById } from './selection/tools';
import { selectionStore, useSelection, useSelectionBid } from './selection/useSelection';
import { WalletButton } from './wallet/WalletButton';

export const App = () => {
  const isPhone = useIsPhone();
  const tool = toolById(useSelection(state => state.tool));
  const { priced } = useSelectionBid();
  const onDragEnd = useCallback((squares: Square[]) => selectionStore.addSquares(squares), []);

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
      map={<LazyMap selection={priced} tool={tool} selectionEnabled={!isPhone} onDragEnd={onDragEnd} />}
      bidPanel={<SelectionPanel />}
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
