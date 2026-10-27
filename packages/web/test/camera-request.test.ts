import { describe, expect, it, vi } from 'vitest';

import { createCameraRequests } from '../src/map/camera-request';

const AREA = { south: 1, north: 2, west: 3, east: 4 };

describe('createCameraRequests', () => {
  it('keeps the newest request until the map does it', () => {
    const requests = createCameraRequests();
    const listener = vi.fn();
    requests.subscribe(listener);
    expect(requests.getState()).toBeUndefined();
    requests.request(AREA);
    const first = requests.getState();
    expect(first?.area).toEqual(AREA);
    requests.done(first?.id ?? 0);
    expect(requests.getState()).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('gives the same area a new ID, and keeps a newer request after an old done', () => {
    const requests = createCameraRequests();
    requests.request(AREA);
    const first = requests.getState();
    requests.request(AREA);
    const second = requests.getState();
    expect(second?.id).not.toBe(first?.id);
    requests.done(first?.id ?? 0);
    expect(requests.getState()).toBe(second);
  });

  it('stops calling a listener after unsubscribe', () => {
    const requests = createCameraRequests();
    const listener = vi.fn();
    requests.subscribe(listener)();
    requests.request(AREA);
    expect(listener).not.toHaveBeenCalled();
  });
});
