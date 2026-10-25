// @vitest-environment jsdom
import { type AuctionResponse, type Square, type ViewportSnapshot, rectangleSquares } from '@gaia/core';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import type { MapViewProps } from '../src/map/MapView';
import { selectionStore } from '../src/selection/useSelection';
import { WalletProvider } from '../src/wallet/WalletProvider';

// jsdom has no WebGL. The map is checked in a browser (see the README). The fake map keeps its
// last props, so a test can end a drag.
const map = vi.hoisted(() => ({ props: undefined as MapViewProps | undefined }));
vi.mock('../src/map/MapView', () => ({
  default: (props: MapViewProps) => {
    map.props = props;
    return <div>Map view</div>;
  },
}));

// The bids store opens a live stream after the first snapshot. jsdom has no EventSource.
class FakeEventSource {
  readyState = 0;
  onopen = null;
  onerror = null;
  addEventListener() {}
  close() {}
}

const BOB = '0x00000000000000000000000000000000000000b2';
const OXFORD = { south: 14170, north: 14179, west: 17800, east: 17819 };

// The answer of GET /bids: one bid of Bob (0.004 ETH) in the south-west corner of the request.
const snapshotFor = (url: string): ViewportSnapshot => {
  const query = new URL(url, 'http://localhost').searchParams;
  const viewport = {
    south: Number(query.get('south')),
    north: Number(query.get('north')),
    west: Number(query.get('west')),
    east: Number(query.get('east')),
  };
  return {
    lastEventId: { block: 5, logIndex: 0 },
    viewport,
    status: { endTime: 5000, paused: true, cancelled: false },
    bids: [
      {
        squareId: viewport.south * 65536 + viewport.west,
        shapeId: 3,
        bidder: BOB,
        amount: '4000000000000000',
      },
    ],
  };
};

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
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(
        new Response(JSON.stringify(url.includes('/bids') ? snapshotFor(url) : auction), { status: 200 }),
      ),
    ),
  );
});

afterEach(() => {
  selectionStore.clear();
  selectionStore.setTool('pan');
  selectionStore.setPriceMode('minimum');
  selectionStore.setPricePerSquare(undefined);
  map.props = undefined;
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
    expect(screen.getByText(/^Select squares on the map: click a square/)).toBeTruthy();
    expect(screen.getByText(/A shape has 1 to 1,000 squares/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bid' }).getAttribute('disabled')).not.toBeNull();
    expect(screen.getByText(/Bidding is not ready yet/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Connect Wallet' })).toBeTruthy();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith('/api/auction', expect.anything());
  });

  it('selects a 10 x 20 rectangle with one drag and shows its price', async () => {
    stubScreen(false);
    renderApp();
    await screen.findByText('Map view');
    await screen.findByText(/A shape has/);
    expect(map.props?.tool.id).toBe('pan');
    fireEvent.click(screen.getByRole('radio', { name: 'Rectangle (R)' }));
    expect(map.props?.tool.id).toBe('rectangle');
    expect(map.props?.selectionEnabled).toBe(true);

    act(() => {
      map.props?.onSelect(rectangleSquares(OXFORD));
    });
    expect(screen.getByText('200 squares (10 rows, 20 columns)')).toBeTruthy();
    // 199 new squares at 0.001 ETH and Bob's square at 0.004 + 0.001 ETH.
    expect(await screen.findByText('Total: 0.204 ETH')).toBeTruthy();
    expect(screen.getByText('199 new squares, 1 outbid square')).toBeTruthy();
    expect(screen.getByText('0.001 to 0.005 ETH per square')).toBeTruthy();
    expect(screen.getByText(/Shape 3 \(0x0000…00b2\): 1 square/)).toBeTruthy();
    expect(map.props?.selection?.sorted).toHaveLength(200);
    expect(map.props?.selection?.packed[0]).toBe(14170 * 65536 + 17800);

    // A second drag adds squares.
    act(() => {
      map.props?.onSelect([{ lat: 14180, lng: 17800 }] as Square[]);
    });
    expect(screen.getByText('201 squares (11 rows, 20 columns)')).toBeTruthy();

    // A click on a selected square removes it; a click on another square adds it.
    act(() => {
      map.props?.onToggle({ lat: 14180, lng: 17800 });
    });
    expect(screen.getByText('200 squares (10 rows, 20 columns)')).toBeTruthy();
    act(() => {
      map.props?.onToggle({ lat: 14180, lng: 17800 });
    });
    expect(screen.getByText('201 squares (11 rows, 20 columns)')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText(/^Select squares on the map: click a square/)).toBeTruthy();
  });

  it('bids one price per square, not below the highest minimum bid', async () => {
    stubScreen(false);
    renderApp();
    await screen.findByText('Map view');
    await screen.findByText(/A shape has/);
    act(() => {
      map.props?.onSelect(rectangleSquares(OXFORD));
    });
    await screen.findByText('Total: 0.204 ETH');

    fireEvent.click(screen.getByRole('radio', { name: 'My price per square' }));
    expect(screen.getByText(/At least 0.005 ETH per square/)).toBeTruthy();
    const input = screen.getByRole('textbox', { name: 'Price per square in ETH' });
    fireEvent.change(input, { target: { value: '0.002' } });
    expect(screen.getByText('The price must be at least 0.005 ETH.')).toBeTruthy();
    expect(screen.queryByText(/^Total:/)).toBeNull();

    fireEvent.change(input, { target: { value: 'abc' } });
    expect(screen.getByText('Enter a price in ETH.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Use minimum' }));
    expect(screen.getByText('Total: 1 ETH')).toBeTruthy();
    fireEvent.change(input, { target: { value: '0.01' } });
    expect(screen.getByText('Total: 2 ETH')).toBeTruthy();
  });

  it('switches the tool with the keys H and R', async () => {
    stubScreen(false);
    renderApp();
    await screen.findByText('Map view');
    fireEvent.keyDown(window, { key: 'r' });
    expect(screen.getByRole('radio', { name: 'Rectangle (R)' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(window, { key: 'H' });
    expect(screen.getByRole('radio', { name: 'Pan (H)' }).getAttribute('aria-checked')).toBe('true');
  });

  it('has no bid panel on a phone', async () => {
    stubScreen(true);
    renderApp();
    expect(await screen.findByText('Map view')).toBeTruthy();
    expect(map.props?.selectionEnabled).toBe(false);
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
