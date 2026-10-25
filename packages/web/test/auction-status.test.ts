import type { AuctionResponse } from '@gaia/core';

import { describe, expect, it } from 'vitest';

import { describeAuction } from '../src/components/auction-status';

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

describe('describeAuction', () => {
  it('follows the times', () => {
    expect(describeAuction(response(), 999).phase).toBe('notStarted');
    expect(describeAuction(response(), 1000).phase).toBe('open');
    expect(describeAuction(response(), 4999).phase).toBe('open');
    expect(describeAuction(response(), 5000).phase).toBe('ended');
  });

  it('shows paused and cancelled first', () => {
    expect(describeAuction(response({ paused: true }), 4000).phase).toBe('paused');
    expect(describeAuction(response({ paused: true, cancelled: true }), 4000).phase).toBe('cancelled');
  });
});
