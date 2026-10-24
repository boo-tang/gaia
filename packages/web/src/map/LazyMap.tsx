// The map in its own chunk: MapLibre GL and deck.gl load after the page shows. Do not import
// MapView.tsx (or the map libraries) in other places, or they go into the main chunk.
import { Component, type ReactNode, Suspense, lazy } from 'react';

import type { MapViewProps } from './MapView';

const MapView = lazy(() => import('./MapView'));

// A map error (no WebGL, or the chunk does not load) shows a message, not an empty page.
class MapErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error(error);
  }

  render() {
    if (this.state.failed) {
      return <p className="map-status">The map cannot load. It needs a browser with WebGL.</p>;
    }
    return this.props.children;
  }
}

export const LazyMap = (props: MapViewProps) => (
  <MapErrorBoundary>
    <Suspense fallback={<p className="map-status">Loading the map…</p>}>
      <MapView {...props} />
    </Suspense>
  </MapErrorBoundary>
);
