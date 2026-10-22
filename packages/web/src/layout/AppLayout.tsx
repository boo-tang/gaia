// The page frame: header, map area and side panel. On a phone the side panel goes below the map
// and has no bid panel.
import type { ReactNode } from 'react';

import { useIsPhone } from './useIsPhone';

interface AppLayoutProps {
  header: ReactNode;
  /** Messages below the header, for example the wrong-network message. */
  notices?: ReactNode;
  map: ReactNode;
  /** Desktop only. */
  bidPanel: ReactNode;
  bidderView: ReactNode;
}

export const AppLayout = ({ header, notices, map, bidPanel, bidderView }: AppLayoutProps) => {
  const isPhone = useIsPhone();
  return (
    <div className="app">
      <header className="app-header">{header}</header>
      {notices}
      <main className="app-main">
        <section className="map-area" aria-label="Map">
          {map}
        </section>
        <aside className="side-panel" aria-label="Side panel">
          {isPhone ? <p className="phone-note">Bid on a desktop. On a phone you can view the auction.</p> : bidPanel}
          {bidderView}
        </aside>
      </main>
    </div>
  );
};
