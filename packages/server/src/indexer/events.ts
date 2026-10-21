// The auction events that the indexer applies, decoded. The names and arguments are the same as
// in GaiaAuction.sol. `Withdrawn` and `ProceedsWithdrawn` are not indexed: the bidder view reads
// the refund from the contract on request.

import type { Address } from '@gaia/core';

interface Base {
  logIndex: number;
}

export type AuctionEvent = Base &
  (
    | {
        eventName: 'ShapeBid';
        args: {
          shapeId: bigint;
          bidder: Address;
          squares: readonly number[];
          amounts: readonly bigint[];
          paid: bigint;
        };
      }
    | { eventName: 'AuctionExtended'; args: { endTime: bigint } }
    | { eventName: 'AuctionPaused'; args: Record<string, never> }
    | { eventName: 'AuctionUnpaused'; args: Record<string, never> }
    | { eventName: 'AuctionCancelled'; args: { by: Address } }
    | {
        eventName: 'ShapeSquaresSettled';
        args: { shapeId: bigint; countryId: bigint; count: bigint };
      }
    | {
        eventName: 'ShapeSettled';
        args: { shapeId: bigint; countryId: bigint; winner: Address; totalSquares: bigint };
      }
  );

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
