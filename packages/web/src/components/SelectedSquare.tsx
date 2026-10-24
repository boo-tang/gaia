// The selected square and its current bid, from the map data.
import { type Square, describeSquare, packSquare } from '@gaia/core';

import { formatEther } from 'viem';

import { useBidsSelector } from '../bids/useBids';

export const SelectedSquare = ({ square }: { square?: Square }) => {
  const bid = useBidsSelector(view => (square === undefined ? undefined : view.data.bids.get(packSquare(square))));
  if (square === undefined) {
    return <p className="selected-square">Click a square on the map.</p>;
  }
  return (
    <p className="selected-square">
      {describeSquare(square)}
      <br />
      {bid === undefined ? 'No bid yet.' : `Highest bid: ${formatEther(bid.amount)} ETH by ${bid.bidder}`}
    </p>
  );
};
