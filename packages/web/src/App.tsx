// The app: the layout with its parts.
import type { Square } from '@gaia/core';

import { useCallback, useState } from 'react';

import { BidderPanel } from './bidder/BidderPanel';
import { AuctionStatusBar } from './components/AuctionStatusBar';
import { NetworkGuard } from './components/NetworkGuard';
import { TestnetBadge } from './components/TestnetBadge';
import { AUCTION_RULES_ID } from './help/AuctionRules';
import { HowItWorks } from './help/HowItWorks';
import { InfoDialog } from './help/InfoDialog';
import { useIsPhone } from './hooks/useIsPhone';
import { AppLayout } from './layout/AppLayout';
import { LazyMap } from './map/LazyMap';
import { SelectionPanel } from './selection/SelectionPanel';
import { toolById } from './selection/tools';
import { selectionStore, useSelection, useSelectionCells } from './selection/useSelection';
import { WalletButton } from './wallet/WalletButton';

export const App = () => {
  const isPhone = useIsPhone();
  const tool = toolById(useSelection(state => state.tool));
  const selection = useSelectionCells();
  const onSelect = useCallback((squares: Square[]) => selectionStore.addSquares(squares), []);
  const onToggle = useCallback((square: Square) => selectionStore.toggle(square), []);
  // Where "How it works" opens: at the top, or at the auction rules (from a shape error of a bid).
  const [help, setHelp] = useState<'top' | 'rules' | undefined>(undefined);
  const closeHelp = useCallback(() => setHelp(undefined), []);
  const showRules = useCallback(() => setHelp('rules'), []);

  return (
    <AppLayout
      header={
        <>
          <h1 className="app-title">Gaia</h1>
          <TestnetBadge />
          <AuctionStatusBar />
          <div className="app-actions">
            <button type="button" className="help-button" aria-label="How it works" onClick={() => setHelp('top')}>
              {isPhone ? '?' : 'How it works'}
            </button>
            <WalletButton />
          </div>
          <InfoDialog
            open={help !== undefined}
            onClose={closeHelp}
            title="How it works"
            scrollTo={help === 'rules' ? AUCTION_RULES_ID : undefined}
          >
            <HowItWorks />
          </InfoDialog>
        </>
      }
      notices={<NetworkGuard />}
      map={
        <LazyMap
          selection={selection}
          tool={tool}
          selectionEnabled={!isPhone}
          onSelect={onSelect}
          onToggle={onToggle}
        />
      }
      bidPanel={<SelectionPanel onShowRules={showRules} />}
      bidderView={<BidderPanel />}
    />
  );
};
