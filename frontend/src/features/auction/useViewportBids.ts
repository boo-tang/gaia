import { useQuery } from '@tanstack/react-query';

import { getBids } from '../../api/client';
import { BoundsQuery } from '../../api/types';

// Polls the server's bid cache for the current viewport (chain/uint16 coordinates). This is a
// display-only cache — bids can go stale between polls, so bid submission re-reads exact
// amounts from the contract before computing the required payment (see chain/useGaiaAuction).
export const useViewportBids = (bounds: BoundsQuery | undefined) =>
  useQuery({
    queryKey: ['bids', bounds],
    queryFn: () => getBids(bounds!),
    enabled: !!bounds,
    refetchInterval: 5_000,
  });
