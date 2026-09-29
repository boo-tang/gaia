import { BidRow, BoundsQuery } from './types';

// Proxied to the auction server by Vite in dev (see vite.config.ts); same-origin in prod.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';

export const getBids = async (bounds: BoundsQuery): Promise<BidRow[]> => {
  const params = new URLSearchParams({
    minLat: String(bounds.minLat),
    maxLat: String(bounds.maxLat),
    minLng: String(bounds.minLng),
    maxLng: String(bounds.maxLng),
  });
  const res = await fetch(`${API_BASE_URL}/bids?${params}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch bids: ${res.status}`);
  }
  return res.json();
};
