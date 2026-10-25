import { describe, expect, it } from 'vitest';

import { boundsToViewport, padBounds } from '../src/map/viewport';

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
