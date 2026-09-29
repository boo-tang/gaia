import { ReactNode } from 'react';
import { MapContainer, TileLayer } from 'react-leaflet';

// Shared map shell for both the auction and post-auction phases. `preferCanvas` renders all
// grid squares onto a single canvas instead of one SVG element each, so the grid stays fast
// without needing a square-count cutoff.
export const MapView = ({ children }: { children?: ReactNode }) => (
  <MapContainer
    center={[40.76203, -73.96277]}
    zoom={12}
    scrollWheelZoom
    preferCanvas
    className="MapContainer"
  >
    <TileLayer
      attribution='&copy; <a href="http://osm.org/copyright">OpenStreetMap</a> contributors'
      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
    />
    {children}
  </MapContainer>
);
