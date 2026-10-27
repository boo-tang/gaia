import { describe, expect, it } from 'vitest';

import { boundsToViewport, cameraForBounds, padBounds, viewportToBounds } from '../src/map/viewport';

describe('boundsToViewport', () => {
  it('converts an area to rows and columns', () => {
    expect(boundsToViewport({ south: 51.5, north: 51.6, west: -0.1, east: 0.05 })).toEqual({
      south: 14150,
      north: 14160,
      west: 17990,
      east: 18005,
    });
  });

  it('gives west > east across the antimeridian, also on a world copy', () => {
    const expected = { south: 9000, north: 9010, west: 35990, east: 10 };
    expect(boundsToViewport({ south: 0, north: 0.1, west: 179.9, east: 180.1 })).toEqual(expected);
    expect(boundsToViewport({ south: 0, north: 0.1, west: -180.1, east: -179.9 })).toEqual(expected);
    expect(boundsToViewport({ south: 0, north: 0.1, west: 539.9, east: 540.1 })).toEqual(expected);
  });

  it('takes all columns for a wide area, near a pole, or with a pole in view', () => {
    const all = { west: 0, east: 35999 };
    expect(boundsToViewport({ south: -60, north: 60, west: -200, east: 200 })).toMatchObject(all);
    expect(boundsToViewport({ south: 84, north: 86, west: 10, east: 20 })).toMatchObject(all);
    expect(boundsToViewport({ south: -90, north: -84, west: 10, east: 20 })).toMatchObject({ south: 0, ...all });
    expect(boundsToViewport({ south: 70, north: 80, west: 10, east: 20 }, true)).toMatchObject(all);
  });

  it('stops the rows at the poles', () => {
    expect(boundsToViewport({ south: -90, north: 90, west: 0, east: 10 })).toMatchObject({ south: 0, north: 17999 });
  });
});

describe('padBounds', () => {
  it('adds half the size on each side and stops at the poles', () => {
    expect(padBounds({ south: 10, north: 20, west: 30, east: 50 })).toEqual({
      south: 5,
      north: 25,
      west: 20,
      east: 60,
    });
    expect(padBounds({ south: 80, north: 89, west: 170, east: 190 })).toMatchObject({ north: 90, east: 200 });
  });
});

describe('viewportToBounds', () => {
  it('gives the outer edges of the squares in degrees', () => {
    const bounds = viewportToBounds({ south: 14150, north: 14159, west: 17990, east: 18009 });
    expect(bounds.south).toBeCloseTo(51.5);
    expect(bounds.north).toBeCloseTo(51.6);
    expect(bounds.west).toBeCloseTo(-0.1);
    expect(bounds.east).toBeCloseTo(0.1);
  });

  it('puts the east edge above 180° across the antimeridian', () => {
    const bounds = viewportToBounds({ south: 9000, north: 9009, west: 35990, east: 9 });
    expect(bounds.west).toBeCloseTo(179.9);
    expect(bounds.east).toBeCloseTo(180.1);
  });
});

describe('cameraForBounds', () => {
  const size = { width: 664, height: 600 };

  it('centres the area and zooms until its wider side fits', () => {
    // 0.2° wide at zoom z: 0.2 / 360 * 512 * 2^z pixels, here 568.
    const camera = cameraForBounds({ south: 51.9, north: 52, west: -0.2, east: 0 }, size, 48, 12);
    expect(camera.center[0]).toBeCloseTo(-0.1);
    expect(camera.center[1]).toBeCloseTo(51.95);
    expect(camera.zoom).toBeCloseTo(Math.log2((568 * 360) / (512 * 0.2)));
  });

  it('keeps a centre near a pole and the east edge above 180°', () => {
    const camera = cameraForBounds({ south: 86, north: 86.1, west: 179.9, east: 180.1 }, size, 48, 12);
    expect(camera.center[0]).toBeCloseTo(180);
    expect(camera.center[1]).toBeCloseTo(86.05);
    // Near the pole a row is high on the map: the rows set the zoom.
    expect(camera.zoom).toBeLessThan(Math.log2((568 * 360) / (512 * 0.2)));
  });

  it('stops at the zoom limit for a small area', () => {
    expect(cameraForBounds({ south: 0, north: 0.01, west: 0, east: 0.01 }, size, 48, 12).zoom).toBe(12);
  });
});
