// The auction status from the server: end time, paused, cancelled.
import { useAuction } from '../api/queries';
import { describeAuction } from './auction-status';
import { useNowSeconds } from './useNowSeconds';

export const AuctionStatusBar = () => {
  const auction = useAuction();
  const now = useNowSeconds();

  if (auction.isPending) {
    return <p className="auction-status">Loading the auction…</p>;
  }
  if (auction.isError) {
    return (
      <p className="auction-status auction-status-error" role="status" title={auction.error.message}>
        The server is not available.
      </p>
    );
  }
  const { phase, text } = describeAuction(auction.data, now);
  return (
    <p className={`auction-status auction-status-${phase}`} role="status">
      {text}
    </p>
  );
};
