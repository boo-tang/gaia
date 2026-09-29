// Chain-coordinate (uint16) grid cell bid, as returned by the server's bid cache.
export interface BidRow {
  id: number;
  lat: number;
  lng: number;
  bidder: string;
  amountWei: string;
  updatedAt: number;
}

export interface BoundsQuery {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}
