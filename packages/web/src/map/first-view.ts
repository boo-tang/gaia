// The first camera of the map, as Google Maps does it without a permission prompt: the last view
// of this browser, else the region of the browser time zone, else the whole globe. The precise
// location comes only from the "My location" button (MapLibre GeolocateControl).
import { TIME_ZONES } from './time-zones';

export interface CameraView {
  longitude: number;
  latitude: number;
  zoom: number;
}

export const VIEW_STORAGE_KEY = 'gaia.map.view';
export const WORLD_VIEW: CameraView = { longitude: 0, latitude: 20, zoom: 1.5 };
const TIME_ZONE_ZOOM = 5;

const isCameraView = (value: unknown): value is CameraView => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { longitude, latitude, zoom } = value as Record<string, unknown>;
  return (
    typeof longitude === 'number' &&
    typeof latitude === 'number' &&
    typeof zoom === 'number' &&
    Math.abs(longitude) <= 540 &&
    Math.abs(latitude) <= 90 &&
    zoom >= 0 &&
    zoom <= 24
  );
};

/** The saved view, or undefined when there is none or it is not valid. */
export const readSavedView = (storage: Pick<Storage, 'getItem'> | undefined): CameraView | undefined => {
  try {
    const text = storage?.getItem(VIEW_STORAGE_KEY);
    if (text === null || text === undefined) {
      return undefined;
    }
    const value: unknown = JSON.parse(text);
    return isCameraView(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

/** Saves the view. A browser can block the storage: then the next visit uses the time zone. */
export const saveView = (storage: Pick<Storage, 'setItem'> | undefined, view: CameraView) => {
  try {
    storage?.setItem(VIEW_STORAGE_KEY, JSON.stringify(view));
  } catch {
    // No storage: nothing to do.
  }
};

/** The region of a time zone, or undefined for an unknown zone (also `UTC`). */
export const viewForTimeZone = (timeZone: string | undefined): CameraView | undefined => {
  const point = timeZone === undefined ? undefined : TIME_ZONES[timeZone];
  if (point === undefined) {
    return undefined;
  }
  return { latitude: point[0], longitude: point[1], zoom: TIME_ZONE_ZOOM };
};

export const browserTimeZone = (): string | undefined => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
};

export const firstView = (saved: CameraView | undefined, timeZone: string | undefined): CameraView =>
  saved ?? viewForTimeZone(timeZone) ?? WORLD_VIEW;
