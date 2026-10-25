import type { AuctionResponse, ViewportSnapshot } from '@gaia/core';

import { describe, expect, it, vi } from 'vitest';

import { ApiError, createApiClient } from '../src/api/api-client';
import { retryServerErrors } from '../src/api/queries';

const auction: AuctionResponse = {
  lastEventId: { block: 12, logIndex: 3 },
  rules: {
    chainId: 31337,
    auction: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    startTime: 1792246554,
    maxEndTime: 1792336554,
    extensionWindow: 900,
    minBidPerSquareWei: '1000000000000000',
    minBidIncrementBps: 500,
    minShapeSquares: 1,
    maxShapeSquares: 1000,
    maxShapeAspectRatio: 10,
  },
  status: { endTime: 1792250154, paused: false, cancelled: false },
};

const fetchAnswer = (status: number, body: string) =>
  vi.fn<typeof fetch>(() => Promise.resolve(new Response(body, { status })));

describe('createApiClient', () => {
  it('gets the auction', async () => {
    const fetchFn = fetchAnswer(200, JSON.stringify(auction));
    await expect(createApiClient('/api', fetchFn).getAuction()).resolves.toEqual(auction);
    expect(fetchFn).toHaveBeenCalledWith('/api/auction', { headers: { accept: 'application/json' } });
  });

  it('gets the view of a bidder', async () => {
    const bidder = '0x00000000000000000000000000000000000000a1';
    const view = { bidder, shapes: [], refund: '5', history: [] };
    const fetchFn = fetchAnswer(200, JSON.stringify(view));
    await expect(createApiClient('/api', fetchFn).getBidder(bidder)).resolves.toEqual(view);
    expect(fetchFn.mock.calls[0][0]).toBe(`/api/bidder/${bidder}`);
  });

  it('removes the last / of the base URL', async () => {
    const fetchFn = fetchAnswer(200, JSON.stringify(auction));
    await createApiClient('https://api.example.com//', fetchFn).getAuction();
    expect(fetchFn.mock.calls[0][0]).toBe('https://api.example.com/auction');
  });

  it('gives an ApiError with the JSON body for an error status', async () => {
    const body = { error: 'Invalid input', problems: ['south: too small'] };
    const error = await createApiClient('/api', fetchAnswer(400, JSON.stringify(body)))
      .getAuction()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ path: '/auction', status: 400, body });
    expect((error as ApiError).message).toBe('GET /auction failed with HTTP 400: Invalid input');
  });

  it('keeps a body that is not JSON as text', async () => {
    const error = await createApiClient('/api', fetchAnswer(502, 'Bad Gateway'))
      .getAuction()
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ status: 502, body: 'Bad Gateway', message: 'GET /auction failed with HTTP 502' });
  });

  it('gets the bids of a viewport', async () => {
    const snapshot: ViewportSnapshot = {
      lastEventId: { block: 12, logIndex: 3 },
      viewport: { south: 14150, north: 14160, west: 35990, east: 9 },
      status: auction.status,
      bids: [{ squareId: 927_334_400, shapeId: 1, bidder: auction.rules.auction, amount: '1000000000000000' }],
    };
    const fetchFn = fetchAnswer(200, JSON.stringify(snapshot));
    await expect(createApiClient('/api', fetchFn).getBids(snapshot.viewport)).resolves.toEqual(snapshot);
    expect(fetchFn.mock.calls[0][0]).toBe('/api/bids?south=14150&north=14160&west=35990&east=9');
  });

  it('gives an ApiError with status 400 when the viewport has too many bids', async () => {
    const body = { error: 'The viewport has more than 50000 bids. Zoom in.' };
    const error = await createApiClient('/api', fetchAnswer(400, JSON.stringify(body)))
      .getBids({ south: 0, north: 17999, west: 0, east: 35999 })
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ status: 400, body });
  });

  it('makes the stream URL', () => {
    const client = createApiClient('/api/');
    expect(client.streamUrl()).toBe('/api/stream');
    expect(client.streamUrl({ block: 12, logIndex: 3 })).toBe('/api/stream?after=12:3');
  });

  it('rejects with the fetch error when the server is not reachable', async () => {
    const fetchFn = vi.fn<typeof fetch>(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(createApiClient('/api', fetchFn).getAuction()).rejects.toThrow('Failed to fetch');
  });
});

describe('retryServerErrors', () => {
  it('tries again after a network or server error, not after a 4xx answer', () => {
    expect(retryServerErrors(0, new TypeError('Failed to fetch'))).toBe(true);
    expect(retryServerErrors(2, new ApiError('/auction', 503, ''))).toBe(true);
    expect(retryServerErrors(3, new ApiError('/auction', 503, ''))).toBe(false);
    expect(retryServerErrors(0, new ApiError('/auction', 404, ''))).toBe(false);
  });
});
