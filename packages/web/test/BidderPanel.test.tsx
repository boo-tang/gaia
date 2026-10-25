// @vitest-environment jsdom
import { type AuctionResponse, type BidderView, type StreamMessage, gaiaAuctionAbi } from '@gaia/core';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { type Address, type Hash, type Log, encodeAbiParameters, encodeEventTopics } from 'viem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { changesRefundOf } from '../src/api/queries';
import { BidderPanel } from '../src/bidder/BidderPanel';
import { NOTHING_SENT, withdrawFlow } from '../src/bidder/withdraw-flow';
import { bidsStore } from '../src/bids/useBids';

const ALICE: Address = '0x00000000000000000000000000000000000000a1';
const BOB: Address = '0x00000000000000000000000000000000000000b2';
const HASH: Hash = `0x${'ef'.repeat(32)}`;

const withdrawnLog = (bidder: Address, amount: bigint): Log =>
  ({
    address: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    topics: encodeEventTopics({ abi: gaiaAuctionAbi, eventName: 'Withdrawn', args: { bidder } }),
    data: encodeAbiParameters([{ type: 'uint256' }], [amount]),
  }) as unknown as Log;

const wallet = vi.hoisted(() => ({
  account: { address: undefined as string | undefined, chainId: undefined as number | undefined },
  writeContractAsync: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
}));

vi.mock('wagmi', () => ({
  useAccount: () => wallet.account,
  usePublicClient: () => ({ waitForTransactionReceipt: wallet.waitForTransactionReceipt }),
  useWriteContract: () => ({ writeContractAsync: wallet.writeContractAsync }),
}));

const auction = (cancelled = false): AuctionResponse => ({
  rules: {
    chainId: 31337,
    auction: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    startTime: 1000,
    maxEndTime: 9000,
    extensionWindow: 900,
    minBidPerSquareWei: '1000',
    minBidIncrementBps: 500,
    minShapeSquares: 1,
    maxShapeSquares: 1000,
    maxShapeAspectRatio: 10,
  },
  status: { endTime: 5000, paused: cancelled, cancelled },
});

let refunds: string[];
let cancelled: boolean;
const bidderCalls = () =>
  vi.mocked(fetch).mock.calls.filter(([url]) => typeof url === 'string' && url.includes('/bidder/')).length;

const renderPanel = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BidderPanel />
    </QueryClientProvider>,
  );

let streamListener: ((message: StreamMessage) => void) | undefined;

beforeEach(() => {
  wallet.account = { address: ALICE, chainId: 31337 };
  refunds = ['500000000000000000'];
  cancelled = false;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      if (url.includes('/bidder/')) {
        const view: BidderView = { bidder: ALICE, shapes: [], refund: refunds.shift() ?? '0', history: [] };
        return Promise.resolve(new Response(JSON.stringify(view)));
      }
      return Promise.resolve(new Response(JSON.stringify(auction(cancelled))));
    }),
  );
  vi.spyOn(bidsStore, 'onMessage').mockImplementation(listener => {
    streamListener = listener;
    return () => {
      streamListener = undefined;
    };
  });
});

afterEach(() => {
  cleanup();
  withdrawFlow.set({ status: 'idle' });
  wallet.writeContractAsync.mockReset();
  wallet.waitForTransactionReceipt.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('BidderPanel', () => {
  it('asks for a wallet', () => {
    wallet.account = { address: undefined, chainId: undefined };
    renderPanel();
    expect(screen.getByText('Connect a wallet to see your refund.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Withdraw' }).getAttribute('disabled')).not.toBeNull();
  });

  it('withdraws the refund and loads the refund again after the receipt', async () => {
    refunds = ['500000000000000000', '0'];
    wallet.writeContractAsync.mockResolvedValue(HASH);
    wallet.waitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      logs: [withdrawnLog(ALICE, 500_000_000_000_000_000n)],
    });
    renderPanel();
    expect(await screen.findByText('Refund: 0.5 ETH')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    expect(await screen.findByText(/^Withdrawn: 0.5 ETH/)).toBeTruthy();
    expect(wallet.writeContractAsync).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'withdraw', chainId: 31337 }),
    );
    expect(wallet.waitForTransactionReceipt).toHaveBeenCalledWith({ hash: HASH });
    expect(await screen.findByText('Refund: 0 ETH')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Withdraw' }).getAttribute('disabled')).not.toBeNull();
  });

  it('says when no ETH was sent', async () => {
    wallet.writeContractAsync.mockResolvedValue(HASH);
    wallet.waitForTransactionReceipt.mockResolvedValue({ status: 'success', logs: [] });
    renderPanel();
    await screen.findByText('Refund: 0.5 ETH');
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    expect((await screen.findByRole('alert')).textContent).toBe(NOTHING_SENT);
  });

  it('goes back to Withdraw when the user rejects the transaction', async () => {
    wallet.writeContractAsync.mockRejectedValue(Object.assign(new Error('User rejected'), { code: 4001 }));
    renderPanel();
    await screen.findByText('Refund: 0.5 ETH');
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    await vi.waitFor(() => expect(withdrawFlow.getState().status).toBe('idle'));
    expect(wallet.writeContractAsync).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('loads the refund again after a stream message about the bidder', async () => {
    refunds = ['0', '700000000000000000'];
    renderPanel();
    await screen.findByText('Refund: 0 ETH');
    expect(bidderCalls()).toBe(1);
    act(() => {
      streamListener?.({
        type: 'shapeBid',
        id: { block: 9, logIndex: 0 },
        timestamp: 1,
        shapeId: 5,
        bidder: BOB,
        squareIds: [1],
        amounts: ['2'],
        paid: '2',
        taken: [{ shapeId: 4, bidder: ALICE, squareIds: [1] }],
      });
    });
    expect(await screen.findByText('Refund: 0.7 ETH')).toBeTruthy();
    expect(bidderCalls()).toBe(2);
  });

  it('says to withdraw after a cancel', async () => {
    cancelled = true;
    renderPanel();
    expect(await screen.findByText('The auction is cancelled. Withdraw your bids.')).toBeTruthy();
  });
});

describe('changesRefundOf', () => {
  const bid = (bidder: Address, taken: Address[] = []): StreamMessage => ({
    type: 'shapeBid',
    id: { block: 1, logIndex: 0 },
    timestamp: 1,
    shapeId: 1,
    bidder,
    squareIds: [],
    amounts: [],
    paid: '0',
    taken: taken.map(owner => ({ shapeId: 2, bidder: owner, squareIds: [] })),
  });
  const status = (isCancelled: boolean): StreamMessage => ({
    type: 'auctionStatus',
    id: { block: 1, logIndex: 0 },
    timestamp: 1,
    status: { endTime: 1, paused: false, cancelled: isCancelled },
  });

  it('is true for own bids, outbids and a cancel', () => {
    expect(changesRefundOf(bid(ALICE), ALICE)).toBe(true);
    expect(changesRefundOf(bid(BOB, [ALICE]), ALICE)).toBe(true);
    expect(changesRefundOf(bid(BOB, [BOB]), ALICE)).toBe(false);
    expect(changesRefundOf(status(true), ALICE)).toBe(true);
    expect(changesRefundOf(status(false), ALICE)).toBe(false);
    expect(changesRefundOf({ type: 'reorg' }, ALICE)).toBe(false);
  });
});
