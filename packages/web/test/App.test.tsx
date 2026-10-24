// @vitest-environment jsdom
import type { AuctionResponse } from '@gaia/core';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import { WalletProvider } from '../src/wallet/WalletProvider';

// jsdom has no WebGL. The map is checked in a browser (see the README).
vi.mock('../src/map/MapView', () => ({ default: () => <div>Map view</div> }));

const auction: AuctionResponse = {
  rules: {
    chainId: 31337,
    auction: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    startTime: 1000,
    maxEndTime: 9000,
    extensionWindow: 900,
    minBidPerSquareWei: '1',
    minBidIncrementBps: 500,
    minShapeSquares: 1,
    maxShapeSquares: 1000,
    maxShapeAspectRatio: 10,
  },
  status: { endTime: 5000, paused: true, cancelled: false },
};

/** jsdom has no matchMedia. The stub matches the phone query when `phone` is true. */
const stubScreen = (phone: boolean) =>
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: phone && query.includes('max-width'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: undefined,
    })),
  );

const renderApp = () =>
  render(
    <WalletProvider>
      <App />
    </WalletProvider>,
  );

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(auction), { status: 200 }))),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('App', () => {
  it('renders the desktop layout with the auction status from the server', async () => {
    stubScreen(false);
    renderApp();
    expect(await screen.findByText(/Auction paused/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Gaia' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Map' })).toBeTruthy();
    expect(await screen.findByText('Map view')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Bid' })).toBeTruthy();
    expect(screen.getByText('Click a square on the map.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect Wallet' })).toBeTruthy();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/auction', expect.anything());
  });

  it('has no bid panel on a phone', () => {
    stubScreen(true);
    renderApp();
    expect(screen.queryByRole('heading', { name: 'Bid' })).toBeNull();
    expect(screen.getByText(/Bid on a desktop/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Your bids' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeTruthy();
  });

  it('says when the server is not available', async () => {
    stubScreen(false);
    // A 4xx answer gets no retry, so the message shows at once.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('Not Found', { status: 404 }))),
    );
    renderApp();
    expect(await screen.findByText('The server is not available.')).toBeTruthy();
  });
});
