import { MapView } from '../map/MapView';
import GridLayer from '../map/GridLayer';

// Placeholder for the post-auction phase: finalized countries and flat-fee-purchasable squares.
// Reuses the same phase-agnostic MapView/GridLayer as the auction view; wiring in settled
// country data and flat-fee purchases is tracked separately (see BOO-6, BOO-5, BOO-7).
export const PostAuctionView = () => (
  <>
    <div className="auction-status">
      <span>Auction ended</span>
    </div>
    <MapView>
      <GridLayer getCellViewModel={() => ({})} />
    </MapView>
  </>
);
