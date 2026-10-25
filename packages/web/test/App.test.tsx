// @vitest-environment jsdom
import type { AuctionResponse, ViewportSnapshot } from '@gaia/core';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import { WalletProvider } from '../src/wallet/WalletProvider';

// A smoke test only: the UI changes a lot, so the tests do not check texts or layout.
// jsdom has no WebGL. The map is checked in a browser (see the README).
vi.mock('../src/map/MapView', () => ({
  default: () => <div>Map view</div>,
}));

// The bids store opens a live stream after the first snapshot. jsdom has no EventSource.
class FakeEventSource {
  readyState = 0;
  onopen = null;
  onerror = null;
  addEventListener() {}
  close() {}
}

const auction: AuctionResponse = {
  rules: {
    chainId: 31337,
    auction: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    startTime: 1000,
    maxEndTime: 9000,
    extensionWindow: 900,
    minBidPerSquareWei: '1000000000000000',
    minBidIncrementBps: 500,
    minShapeSquares: 1,
    maxShapeSquares: 1000,
    maxShapeAspectRatio: 10,
  },
  status: { endTime: 5000, paused: false, cancelled: false },
};

const snapshot: ViewportSnapshot = {
  lastEventId: { block: 5, logIndex: 0 },
  viewport: { south: 0, north: 0, west: 0, east: 0 },
  status: auction.status,
  bids: [],
};

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('EventSource', FakeEventSource);
  // jsdom has no matchMedia: a desktop screen.
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: undefined,
    })),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(new Response(JSON.stringify(url.includes('/bids') ? snapshot : auction), { status: 200 })),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('App', () => {
  it('loads with the map and the wallet button', async () => {
    render(
      <WalletProvider>
        <App />
      </WalletProvider>,
    );
    expect(await screen.findByText('Map view')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Map' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect Wallet' })).toBeTruthy();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/auction', expect.anything());
  });
});
