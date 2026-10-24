// On the globe, the map surface can show through the 3D columns: the map's depth and deck.gl's
// depth do not match exactly. Our base map is flat (no 3D buildings, no terrain), so the map
// never needs to hide a column. This custom layer clears the depth buffer just before the deck.gl
// layers: the columns then hide only each other. Place names after the deck.gl layers do not use
// the depth test, so they still show. If the style gets 3D buildings or terrain, remove this.
import type { CustomLayerInterface, Map as MapLibreMap } from 'maplibre-gl';

const CLEAR_DEPTH_ID = 'gaia-clear-depth';

const clearDepthLayer: CustomLayerInterface = {
  id: CLEAR_DEPTH_ID,
  type: 'custom',
  renderingMode: '3d',
  render(gl) {
    // MapLibre can have turned depth writes off, and a clear uses the depth mask. MapLibre sets
    // its GL state again after each custom layer.
    gl.depthMask(true);
    gl.clear(gl.DEPTH_BUFFER_BIT);
  },
};

/**
 * Puts the depth clear directly before the deck.gl layer group that is drawn before `beforeId`.
 * Call it after each update of the overlay's layers: deck.gl adds or moves its group then.
 */
export const placeDepthClear = (map: MapLibreMap, beforeId: string | undefined) => {
  const group = beforeId ? `deck-maplibre-layer-group-before:${beforeId}` : 'deck-maplibre-layer-group-last';
  if (!map.getLayer(group)) {
    return; // deck.gl has not added its layers yet
  }
  if (!map.getLayer(CLEAR_DEPTH_ID)) {
    map.addLayer(clearDepthLayer, group);
  } else {
    map.moveLayer(CLEAR_DEPTH_ID, group);
  }
};
