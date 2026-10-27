// A request to move the map to an area, from outside the map (for example a click on a shape in
// "Your bids"). No map library here, so other folders can import this file. MapView does the
// newest request once, when the map is loaded, and then calls `done`.
import type { Viewport } from '@gaia/core';

export interface CameraRequest {
  /** A new ID for each request, so the same area again moves the map again. */
  id: number;
  /** Grid rectangle (rows and columns). `west > east` means that it crosses the antimeridian. */
  area: Viewport;
}

export interface CameraRequests {
  /** The request that the map did not do yet. */
  getState: () => CameraRequest | undefined;
  subscribe: (listener: () => void) => () => void;
  request: (area: Viewport) => void;
  /** The map did request `id`. A newer request stays. */
  done: (id: number) => void;
}

export const createCameraRequests = (): CameraRequests => {
  let state: CameraRequest | undefined;
  let nextId = 1;
  const listeners = new Set<() => void>();
  const set = (next: CameraRequest | undefined) => {
    state = next;
    listeners.forEach(listener => listener());
  };
  return {
    getState: () => state,
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    request: area => set({ id: nextId++, area }),
    done: id => {
      if (state?.id === id) {
        set(undefined);
      }
    },
  };
};

/** The camera requests of the app. */
export const cameraRequests = createCameraRequests();
