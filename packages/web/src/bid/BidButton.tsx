// The Bid button of the bid panel and the line below it: why the bid is disabled, the state of
// the transaction, the receipt or the error.
import { formatEther } from 'viem';

import { TxLink } from '../tx/TxLink';
import type { Bid } from './useBid';

const eth = (wei: bigint) => `${formatEther(wei)} ETH`;

const BUTTON_TEXT: Record<string, string> = {
  simulating: 'Checking the bid…',
  signing: 'Confirm in your wallet…',
  confirming: 'Waiting for the transaction…',
};

/** The line below the button. */
const BidLine = ({ bid }: { bid: Bid }) => {
  const { state, input, reason } = bid;
  if (state.status === 'signing' || state.status === 'confirming') {
    // The live data can change the total while the wallet is open.
    const changed = input.total !== undefined && input.total !== state.value;
    return (
      <>
        {changed && input.total !== undefined && (
          <p className="bid-error">
            The total is now {eth(input.total)}. The wallet asks for {eth(state.value)}, so the bid can fail.
          </p>
        )}
        {state.status === 'confirming' && (
          <p className="bid-hint">
            <TxLink hash={state.hash} />
          </p>
        )}
      </>
    );
  }
  if (state.status === 'done') {
    return (
      <p className="bid-done" role="status">
        Bid placed: {eth(state.result.paid)} <TxLink hash={state.hash} />
      </p>
    );
  }
  if (state.status === 'failed') {
    return (
      <p className="bid-error" role="alert" title={state.detail}>
        {state.text}
      </p>
    );
  }
  if (reason !== undefined && state.status === 'idle') {
    return <p className="bid-hint">{reason}</p>;
  }
  return undefined;
};

export const BidButton = ({ bid }: { bid: Bid }) => (
  <button type="button" className="bid-button" disabled={!bid.canBid} onClick={bid.start}>
    {BUTTON_TEXT[bid.state.status] ?? 'Bid'}
  </button>
);

export const BidStatus = ({ bid }: { bid: Bid }) => (
  <div className="bid-status" aria-live="polite">
    <BidLine bid={bid} />
  </div>
);
