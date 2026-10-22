// The auction events that the indexer applies, decoded. The names and arguments are the same as
// in GaiaAuction.sol; uint256 values are bigint, as viem decodes them. `Withdrawn` and
// `ProceedsWithdrawn` are not indexed: the bidder view reads the refund from the contract on
// request. `logIndex` is the position of the log in its block.

import type { Address } from '@gaia/core';

export interface ShapeBidEvent {
  eventName: 'ShapeBid';
  logIndex: number;
  args: {
    shapeId: bigint;
    bidder: Address;
    squares: readonly number[];
    amounts: readonly bigint[];
    paid: bigint;
  };
}

export interface AuctionExtendedEvent {
  eventName: 'AuctionExtended';
  logIndex: number;
  args: { endTime: bigint };
}

export interface AuctionPausedEvent {
  eventName: 'AuctionPaused';
  logIndex: number;
  args: Record<string, never>;
}

export interface AuctionUnpausedEvent {
  eventName: 'AuctionUnpaused';
  logIndex: number;
  args: Record<string, never>;
}

export interface AuctionCancelledEvent {
  eventName: 'AuctionCancelled';
  logIndex: number;
  args: { by: Address };
}

export interface ShapeSquaresSettledEvent {
  eventName: 'ShapeSquaresSettled';
  logIndex: number;
  args: { shapeId: bigint; countryId: bigint; count: bigint };
}

export interface ShapeSettledEvent {
  eventName: 'ShapeSettled';
  logIndex: number;
  args: { shapeId: bigint; countryId: bigint; winner: Address; totalSquares: bigint };
}

export type AuctionEvent =
  | ShapeBidEvent
  | AuctionExtendedEvent
  | AuctionPausedEvent
  | AuctionUnpausedEvent
  | AuctionCancelledEvent
  | ShapeSquaresSettledEvent
  | ShapeSettledEvent;

export type AuctionEventName = AuctionEvent['eventName'];

export const AUCTION_EVENT_NAMES: readonly AuctionEventName[] = [
  'ShapeBid',
  'AuctionExtended',
  'AuctionPaused',
  'AuctionUnpaused',
  'AuctionCancelled',
  'ShapeSquaresSettled',
  'ShapeSettled',
];
