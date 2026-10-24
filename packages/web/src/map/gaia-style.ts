// Our own map style, made in code from a vector style of the OpenMapTiles schema (default:
// OpenFreeMap "Positron", OpenStreetMap data). The style keeps the sources of the base style and
// uses our colours. It uses only OpenMapTiles layer names, so any OpenMapTiles source works.
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';

interface Palette {
  background: string;
  water: string;
  green: string;
  building: string;
  road: string;
  roadCasing: string;
  boundary: string;
  label: string;
  labelHalo: string;
}

export const PAPER: Palette = {
  background: '#f4efe6',
  water: '#b9d0d9',
  green: '#e2e7d3',
  building: '#ebe3d4',
  road: '#fffdf8',
  roadCasing: '#e0d5c1',
  boundary: '#b5a58c',
  label: '#5b4b3a',
  labelHalo: '#f4efe6',
};

const restyle = (layer: LayerSpecification, p: Palette): LayerSpecification | undefined => {
  const id = layer.id;
  if (layer.type === 'background') {
    return { ...layer, paint: { 'background-color': p.background } };
  }
  if (layer.type === 'fill') {
    if (id === 'water') {
      return { ...layer, paint: { 'fill-color': p.water } };
    }
    if (id === 'building') {
      return { ...layer, paint: { 'fill-color': p.building } };
    }
    if (id === 'park' || id.startsWith('landcover') || id.startsWith('landuse')) {
      return { ...layer, paint: { ...layer.paint, 'fill-color': p.green } };
    }
    return layer;
  }
  if (layer.type === 'line') {
    if (id.startsWith('boundary')) {
      return { ...layer, paint: { ...layer.paint, 'line-color': p.boundary } };
    }
    if (id === 'waterway') {
      return { ...layer, paint: { ...layer.paint, 'line-color': p.water } };
    }
    if (id.includes('casing')) {
      return { ...layer, paint: { ...layer.paint, 'line-color': p.roadCasing } };
    }
    return { ...layer, paint: { ...layer.paint, 'line-color': p.road } };
  }
  if (layer.type === 'symbol') {
    // Keep only place and water names: no road names, shields or airports on a land map.
    if (!id.startsWith('label_') && !id.startsWith('water_name')) {
      return undefined;
    }
    return { ...layer, paint: { ...layer.paint, 'text-color': p.label, 'text-halo-color': p.labelHalo } };
  }
  return layer;
};

export interface GaiaStyle {
  style: StyleSpecification;
  /** The first symbol layer: our layers go under it, so place names stay on top. */
  beforeId?: string;
}

/** Loads the base style at `styleUrl` and gives it our colours. */
export const loadGaiaStyle = async (styleUrl: string, palette: Palette = PAPER): Promise<GaiaStyle> => {
  const response = await fetch(styleUrl);
  if (!response.ok) {
    throw new Error(`Cannot load the map style ${styleUrl}: HTTP ${response.status}`);
  }
  const base = (await response.json()) as StyleSpecification;
  const layers = base.layers.map(layer => restyle(layer, palette)).filter(layer => layer !== undefined);
  return { style: { ...base, layers }, beforeId: layers.find(layer => layer.type === 'symbol')?.id };
};
