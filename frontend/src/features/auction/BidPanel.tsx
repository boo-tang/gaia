import { useState } from 'react';
import { useAccount } from 'wagmi';
import { formatEther, parseEther } from 'viem';

import { useAppDispatch, useAppSelector } from '../../hooks/reduxHooks';
import { getSelectedLocations, resetLocations } from '../../state/locations';
import { AuctionConfig, useBidOnShape, useFetchHighestBids } from '../../chain/useGaiaAuction';
import { fromCoorToUint } from '../../utils/location';
import { computeBidTotal, CurrentBid, sortLocs, validateShape } from '../../utils/shape';

// Selection + bid submission UI for the auction phase. Shows a live validity check against the
// same shape rules the contract enforces, and re-reads exact current bids from the chain right
// before submitting so payment isn't computed off the (possibly stale) server bid cache.
export const BidPanel = ({
  config,
  cachedBids,
}: {
  config: AuctionConfig;
  cachedBids: Map<string, CurrentBid>;
}) => {
  const account = useAccount();
  const dispatch = useAppDispatch();
  const { selectedLocations } = useAppSelector(getSelectedLocations);
  const { bidOnShape, isPending } = useBidOnShape();
  const fetchHighestBids = useFetchHighestBids();
  const [error, setError] = useState<string | undefined>();
  const [floorInput, setFloorInput] = useState('');
  // Own squares (this account is the highest bidder) keep their amount unless this is set.
  const [raiseOwnSquares, setRaiseOwnSquares] = useState(false);

  if (selectedLocations.length === 0) return null;

  // Optional jump bid: a minimum amount per square, in ETH. Empty means the minimum next bid.
  let floorPerSquare: bigint | undefined = 0n;
  if (floorInput.trim() !== '') {
    try {
      floorPerSquare = parseEther(floorInput.trim());
    } catch {
      floorPerSquare = undefined;
    }
  }

  const chainLocs = sortLocs(selectedLocations.map(fromCoorToUint));
  const validation = validateShape(chainLocs, config);

  const cachedCurrent = chainLocs.map(
    (loc) => cachedBids.get(`${loc.lat}.${loc.lng}`) ?? { amount: 0n, own: false },
  );
  const estimatedTotal = computeBidTotal(cachedCurrent, config, floorPerSquare ?? 0n, raiseOwnSquares);

  const onSubmit = async () => {
    if (floorPerSquare === undefined) return;
    setError(undefined);
    try {
      const me = account.address?.toLowerCase();
      const current = (await fetchHighestBids(chainLocs)).map(({ bidder, amount }) => ({
        amount,
        own: me !== undefined && bidder.toLowerCase() === me,
      }));
      const total = computeBidTotal(current, config, floorPerSquare, raiseOwnSquares);
      await bidOnShape(chainLocs, total, floorPerSquare, raiseOwnSquares);
      dispatch(resetLocations());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bid failed');
    }
  };

  return (
    <div
      className="bid-panel"
      style={{
        position: 'fixed',
        top: '6vh',
        left: '50%',
        transform: 'translate(-50%, 0)',
        zIndex: 10000,
      }}
    >
      <div>
        {chainLocs.length} square{chainLocs.length === 1 ? '' : 's'} selected
      </div>
      {validation.valid ? (
        <div>Estimated total: {formatEther(estimatedTotal)} ETH</div>
      ) : (
        <div className="bid-panel-error">{validation.reason}</div>
      )}
      <label>
        Bid per square (ETH, optional):{' '}
        <input
          value={floorInput}
          onChange={(e) => setFloorInput(e.target.value)}
          placeholder="minimum"
          inputMode="decimal"
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={raiseOwnSquares}
          onChange={(e) => setRaiseOwnSquares(e.target.checked)}
        />{' '}
        Also raise my own squares
      </label>
      {floorPerSquare === undefined && <div className="bid-panel-error">Bid per square is not a valid amount</div>}
      {error && <div className="bid-panel-error">{error}</div>}
      <button onClick={onSubmit} disabled={!validation.valid || isPending || floorPerSquare === undefined}>
        {isPending ? 'Bidding…' : 'Bid on shape'}
      </button>
      <button onClick={() => dispatch(resetLocations())} disabled={isPending}>
        Clear selection
      </button>
    </div>
  );
};
