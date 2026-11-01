// The readout at the bottom left of the map: the square under the pointer (on a phone: the tapped
// square), its bid, the shape of that bid and the selection. When the squares are too small to see
// (`squareDetail` false), it shows only the shape and the selection.
import { type Square, describeSquare } from '@gaia/core';

import { type Address, formatEther, isAddressEqual } from 'viem';

import type { HeldBid } from '../bids/bids-reducer';
import type { SelectionCell } from '../selection/selection-cells';

/** What the map holds of one shape: the squares with a bid that the map loaded. */
export interface ShapeTotal {
  count: number;
  /** Wei. */
  amount: bigint;
}

/** The totals of each shape in `bids`. Make it again only when the bids change. */
export const shapeTotals = (bids: ReadonlyMap<number, HeldBid>) => {
  const totals = new Map<number, ShapeTotal>();
  for (const { shapeId, amount } of bids.values()) {
    const total = totals.get(shapeId);
    if (total === undefined) {
      totals.set(shapeId, { count: 1, amount });
    } else {
      total.count += 1;
      total.amount += amount;
    }
  }
  return totals;
};

/** The readout line of a selected square. */
const cellText = ({ own, cost }: SelectionCell) => {
  if (own) {
    return 'Your square: 0 ETH';
  }
  if (cost === undefined) {
    return 'Selected';
  }
  return `You bid ${formatEther(cost)} ETH on this square`;
};

const squaresText = (count: number) => (count === 1 ? '1 square' : `${count.toLocaleString('en-US')} squares`);

const selectionText = (selection: readonly SelectionCell[]) => {
  let total = 0n;
  for (const { cost, own } of selection) {
    if (cost === undefined && !own) {
      return `Your selection: ${squaresText(selection.length)}`;
    }
    total += cost ?? 0n;
  }
  return `Your selection: ${squaresText(selection.length)}, ${formatEther(total)} ETH`;
};

// The whole address when the map is wide enough (styles.css), else the short form.
const Bidder = ({ bidder, own }: { bidder: Address; own: Address | undefined }) => (
  <>
    <span className="address-full">{bidder}</span>
    <span className="address-short">
      {bidder.slice(0, 6)}…{bidder.slice(-4)}
    </span>
    {own !== undefined && isAddressEqual(bidder, own) && ' (you)'}
  </>
);

interface MapReadoutProps {
  square: Square;
  bid?: HeldBid;
  shape?: ShapeTotal;
  /** The selected cell of `square`. */
  cell?: SelectionCell;
  selection: readonly SelectionCell[];
  ownAddress?: Address;
  /** False when the squares are too small to see. */
  squareDetail: boolean;
}

export const MapReadout = ({ square, bid, shape, cell, selection, ownAddress, squareDetail }: MapReadoutProps) => {
  const shapeLine =
    bid !== undefined && shape !== undefined
      ? `Shape ${bid.shapeId}: ${squaresText(shape.count)}, ${formatEther(shape.amount)} ETH`
      : undefined;

  if (!squareDetail) {
    if (bid === undefined && cell === undefined) {
      return null;
    }
    return (
      <p className="map-readout">
        {bid !== undefined && (
          <>
            {shapeLine}
            <br />
            <Bidder bidder={bid.bidder} own={ownAddress} />
          </>
        )}
        {bid !== undefined && cell !== undefined && <br />}
        {cell !== undefined && selectionText(selection)}
      </p>
    );
  }

  return (
    <p className="map-readout">
      {describeSquare(square)}
      <br />
      {bid === undefined ? (
        'No bid'
      ) : (
        <>
          {formatEther(bid.amount)} ETH · <Bidder bidder={bid.bidder} own={ownAddress} />
          <br />
          {shapeLine}
        </>
      )}
      {cell !== undefined && (
        <>
          <br />
          {cellText(cell)}
        </>
      )}
    </p>
  );
};
