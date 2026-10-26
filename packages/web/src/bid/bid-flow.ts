// The bid on the selection: the error texts, when the bid is disabled, and the steps of the
// transaction (`runTx`). The wagmi calls come from useBid.ts.
import { gaiaAuctionAbi } from '@gaia/core';

import { type Address, type Hash, formatEther, isAddressEqual, parseEventLogs } from 'viem';

import type { ReceiptBid } from '../bids/bids-reducer';
import type { AuctionPhase } from '../components/auction-status';
import { selectionStore } from '../selection/useSelection';
import type { ErrorTexts } from '../tx/tx-errors';
import { type TxReceipt, type TxSteps, createTxFlow } from '../tx/tx-flow';

/** The result of a bid: from the `ShapeBid` event of its receipt. */
export interface BidResult {
  /** `paid` of the event: the ETH that the bid spent, without the excess. */
  paid: bigint;
  /** The event for the map. Not there when the receipt has no `ShapeBid` of the bidder. */
  bid?: ReceiptBid;
}

/** The flow of the bid. */
export const bidFlow = createTxFlow<BidResult>();

/** Plain texts for the errors that bidders hit most. Other errors show their name. */
export const BID_ERROR_TEXTS: ErrorTexts = {
  InsufficientValue: ([, required]) =>
    `The prices changed. The bid now costs ${formatEther(required as bigint)} ETH. Check the new total and bid again.`,
  OverlapWouldInvalidateShape: ([shapeId]) =>
    `The rest of shape ${String(shapeId)} would break the shape rules. Change the selection where it meets shape ${String(shapeId)}, or take all of its squares.`,
  ShapeTooSmall: ([, minimum]) => `Too few squares: a shape has at least ${String(minimum)} squares.`,
  AuctionIsPaused: () => 'The auction is paused. You cannot bid now.',
  AuctionAlreadyEnded: () => 'The auction has ended.',
};

/** What the Bid button knows about the auction: its phase, or the state of `GET /auction`. */
export type BidAuctionState = AuctionPhase | 'loading' | 'unavailable';

/**
 * Why the bid is disabled, apart from the selection (the bid panel shows the selection problems).
 * Undefined when nothing outside the selection stops the bid.
 */
export const bidDisabledReason = ({
  auction,
  connected,
  rightChain,
  chainName,
}: {
  auction: BidAuctionState;
  connected: boolean;
  rightChain: boolean;
  chainName: string;
}): string | undefined => {
  if (auction === 'loading') {
    return 'Loading the auction…';
  }
  if (auction === 'unavailable') {
    return 'The server is not available.';
  }
  if (auction === 'notStarted') {
    return 'The auction has not started.';
  }
  if (auction === 'paused') {
    return 'The auction is paused.';
  }
  if (auction === 'cancelled') {
    return 'The auction is cancelled.';
  }
  if (auction === 'ended') {
    return 'The auction has ended.';
  }
  if (!connected) {
    return 'Connect a wallet to bid.';
  }
  if (!rightChain) {
    return `Switch your wallet to ${chainName}.`;
  }
  return undefined;
};

/** The result of the `ShapeBid` event of `bidder` in the receipt. `paid` falls back to `value`. */
export const bidResultFromReceipt = (receipt: TxReceipt, bidder: Address, value: bigint): BidResult => {
  const event = parseEventLogs({ abi: gaiaAuctionAbi, eventName: 'ShapeBid', logs: receipt.logs }).find(e =>
    isAddressEqual(e.args.bidder, bidder),
  );
  if (event === undefined) {
    return { paid: value };
  }
  const { blockNumber, logIndex } = event;
  const bid: ReceiptBid | undefined =
    blockNumber === null || logIndex === null
      ? undefined
      : {
          id: { block: Number(blockNumber), logIndex },
          shapeId: Number(event.args.shapeId),
          bidder: event.args.bidder,
          squareIds: [...event.args.squares],
          amounts: event.args.amounts.map(amount => amount.toString()),
        };
  return { paid: event.args.paid, bid };
};

/** The selection of the bid in progress. After the receipt, only this selection is cleared. */
let bidSquareIds: ReadonlySet<number> | undefined;

/** True when the selection did not change since the bid started. */
export const isBidSelection = (squareIds: ReadonlySet<number>) => squareIds === bidSquareIds;

export interface BidCall {
  bidder: Address;
  packed: readonly number[];
  floorPerSquare: bigint;
  /** `msg.value`: the total of the selection. */
  value: bigint;
}

/** The chain and wallet calls of one bid (wagmi in the app, fakes in the tests). */
export interface BidCalls {
  simulate: (call: BidCall) => Promise<unknown>;
  write: (call: BidCall) => Promise<Hash>;
  waitForReceipt: TxSteps<BidResult>['waitForReceipt'];
}

/**
 * The steps of one bid on the current selection. After the receipt it clears the selection when
 * the selection did not change during the bid.
 */
export const bidSteps = (call: BidCall, calls: BidCalls, onDone?: (result: BidResult) => void): TxSteps<BidResult> => {
  bidSquareIds = selectionStore.getState().squareIds;
  return {
    simulate: () => calls.simulate(call),
    write: () => calls.write(call),
    waitForReceipt: calls.waitForReceipt,
    read: receipt => ({ result: bidResultFromReceipt(receipt, call.bidder, call.value) }),
    value: call.value,
    failed: 'The bid failed',
    texts: BID_ERROR_TEXTS,
    onDone: result => {
      if (isBidSelection(selectionStore.getState().squareIds)) {
        selectionStore.clear();
      }
      bidSquareIds = undefined;
      onDone?.(result);
    },
  };
};

// A failed bid goes back to `idle` when the selection changes. "Bid placed" stays until the user
// selects squares again: the receipt clears the selection, and that must not hide it.
let lastSquareIds = selectionStore.getState().squareIds;
selectionStore.subscribe(() => {
  const { squareIds } = selectionStore.getState();
  if (squareIds === lastSquareIds) {
    return;
  }
  lastSquareIds = squareIds;
  const { status } = bidFlow.getState();
  if (status === 'failed' || (status === 'done' && squareIds.size > 0)) {
    bidFlow.reset();
  }
});
