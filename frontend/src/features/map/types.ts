// Purely visual description of a grid square. Phase-specific features (auction, post-auction)
// compute this from their own data (bids, ownership, availability) so GridLayer stays generic.
export interface CellViewModel {
  fillColor?: string;
  fillOpacity?: number;
  tooltip?: string;
}
