import { useCallback, useMemo, useState } from 'react';
import { useAccount } from 'wagmi';
import { formatEther } from 'viem';

import { MapView } from '../map/MapView';
import GridLayer from '../map/GridLayer';
import { CellViewModel } from '../map/types';
import { useAppDispatch, useAppSelector } from '../../hooks/reduxHooks';
import { getSelectedLocations, toggleLocation } from '../../state/locations';
import { useAuctionConfig } from '../../chain/useGaiaAuction';
import { fromCoorToUint } from '../../utils/location';
import { Loc } from '../../types';
import { AuctionStatus } from './AuctionStatus';
import { BidPanel } from './BidPanel';
import { useViewportBids } from './useViewportBids';

const locKey = (loc: Loc) => `${loc.lat}.${loc.lng}`;

// Wires the phase-agnostic map layer to auction data: bids color the grid, selection drives the
// bid panel. The post-auction view (features/postAuction) will wire the same MapView/GridLayer
// to country ownership + flat-fee availability instead.
export const AuctionView = () => {
  const account = useAccount();
  const dispatch = useAppDispatch();
  const { selectedLocations } = useAppSelector(getSelectedLocations);
  const { config } = useAuctionConfig();
  const [visibleLocs, setVisibleLocs] = useState<Loc[]>([]);

  const chainBounds = useMemo(() => {
    if (visibleLocs.length === 0) return undefined;
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;
    for (const loc of visibleLocs) {
      if (loc.lat < minLat) minLat = loc.lat;
      if (loc.lat > maxLat) maxLat = loc.lat;
      if (loc.lng < minLng) minLng = loc.lng;
      if (loc.lng > maxLng) maxLng = loc.lng;
    }
    const min = fromCoorToUint({ lat: minLat, lng: minLng });
    const max = fromCoorToUint({ lat: maxLat, lng: maxLng });
    return { minLat: min.lat, maxLat: max.lat, minLng: min.lng, maxLng: max.lng };
  }, [visibleLocs]);

  const { data: bids } = useViewportBids(chainBounds);

  const bidsByKey = useMemo(() => {
    const map = new Map<string, { bidder: string; amountWei: string }>();
    (bids ?? []).forEach((bid) => map.set(`${bid.lat}.${bid.lng}`, bid));
    return map;
  }, [bids]);

  const cachedBidAmounts = useMemo(() => {
    const map = new Map<string, bigint>();
    bidsByKey.forEach((bid, key) => map.set(key, BigInt(bid.amountWei)));
    return map;
  }, [bidsByKey]);

  const selectedKeys = useMemo(
    () => new Set(selectedLocations.map((loc) => locKey(fromCoorToUint(loc)))),
    [selectedLocations],
  );

  const getCellViewModel = useCallback(
    (loc: Loc): CellViewModel => {
      const bid = bidsByKey.get(locKey(fromCoorToUint(loc)));
      if (!bid) return {};
      const isMine = !!account.address && bid.bidder.toLowerCase() === account.address.toLowerCase();
      return {
        fillColor: isMine ? 'green' : 'blue',
        fillOpacity: 0.5,
        tooltip: `Highest bid: ${formatEther(BigInt(bid.amountWei))} ETH`,
      };
    },
    [bidsByKey, account.address],
  );

  const isSelected = useCallback(
    (loc: Loc) => selectedKeys.has(locKey(fromCoorToUint(loc))),
    [selectedKeys],
  );

  const onCellClick = useCallback((loc: Loc) => dispatch(toggleLocation(loc)), [dispatch]);

  return (
    <>
      <AuctionStatus />
      {config && <BidPanel config={config} cachedBidAmounts={cachedBidAmounts} />}
      <MapView>
        <GridLayer
          getCellViewModel={getCellViewModel}
          isSelected={isSelected}
          onCellClick={onCellClick}
          onVisibleLocsChange={setVisibleLocs}
        />
      </MapView>
    </>
  );
};
