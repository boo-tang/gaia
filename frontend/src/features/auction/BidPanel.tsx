import { useState } from 'react';
import { formatEther, parseEther } from 'viem';

import { useAppDispatch, useAppSelector } from '../../hooks/reduxHooks';
import { getSelectedLocations, resetLocations } from '../../state/locations';
import { AuctionConfig, useBidOnShape, useFetchHighestBids } from '../../chain/useGaiaAuction';
import { fromCoorToUint } from '../../utils/location';
import { computeBidTotal, sortLocs, validateShape } from '../../utils/shape';

// Selection + bid submission UI for the auction phase. Shows a live validity check against the
// same shape rules the contract enforces, and re-reads exact current bids from the chain right
// before submitting so payment isn't computed off the (possibly stale) server bid cache.
export const BidPanel = ({
  config,
  cachedBidAmounts,
}: {
  config: AuctionConfig;
  cachedBidAmounts: Map<string, bigint>;
}) => {
  const dispatch = useAppDispatch();
  const { selectedLocations } = useAppSelector(getSelectedLocations);
  const { bidOnShape, isPending } = useBidOnShape();
  const fetchHighestBids = useFetchHighestBids();
  const [error, setError] = useState<string | undefined>();
  const [floorInput, setFloorInput] = useState('');

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

  const cachedAmounts = chainLocs.map(
    (loc) => cachedBidAmounts.get(`${loc.lat}.${loc.lng}`) ?? 0n,
  );
  const estimatedTotal = computeBidTotal(cachedAmounts, config, floorPerSquare ?? 0n);

  const onSubmit = async () => {
    if (floorPerSquare === undefined) return;
    setError(undefined);
    try {
      const currentAmounts = await fetchHighestBids(chainLocs);
      const total = computeBidTotal(currentAmounts, config, floorPerSquare);
      await bidOnShape(chainLocs, total, floorPerSquare);
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
