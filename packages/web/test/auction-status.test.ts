import type { AuctionResponse } from '@gaia/core';

import { describe, expect, it } from 'vitest';

import { describeAuction, formatDuration } from '../src/components/auction-status';

const response = (status: Partial<AuctionResponse['status']> = {}): AuctionResponse => ({
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
  status: { endTime: 5000, paused: false, cancelled: false, ...status },
});

describe('formatDuration', () => {
  it('shows the two largest units', () => {
    expect(formatDuration(42)).toBe('42 s');
    expect(formatDuration(5 * 60 + 3)).toBe('5 min 3 s');
    expect(formatDuration(2 * 3600 + 10 * 60 + 59)).toBe('2 h 10 min');
    expect(formatDuration(2 * 86_400 + 4 * 3600)).toBe('2 d 4 h');
    expect(formatDuration(-5)).toBe('0 s');
  });
});

describe('describeAuction', () => {
  it('follows the times', () => {
    expect(describeAuction(response(), 500)).toMatchObject({
      phase: 'notStarted',
      text: expect.stringContaining('in 8 min 20 s'),
    });
    expect(describeAuction(response(), 4000)).toMatchObject({
      phase: 'open',
      text: expect.stringContaining('in 16 min 40 s'),
    });
    expect(describeAuction(response(), 5000).phase).toBe('ended');
  });

  it('shows paused and cancelled first', () => {
    expect(describeAuction(response({ paused: true }), 4000).phase).toBe('paused');
    expect(describeAuction(response({ paused: true, cancelled: true }), 4000)).toEqual({
      phase: 'cancelled',
      text: 'Auction cancelled. All bids are refunds.',
    });
  });
});
