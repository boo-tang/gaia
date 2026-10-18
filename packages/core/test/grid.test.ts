import { describe, expect, it } from 'vitest';
import {
  LAT_ROWS,
  LNG_COLUMNS,
  gridLines,
  packSquare,
  squareAt,
  squareBounds,
  unpackSquare,
} from '../src/grid';

describe('squareAt and squareBounds', () => {
  it('puts the south-west corner of each column into that column', () => {
    for (let lng = 0; lng < LNG_COLUMNS; lng++) {
      const { south, west } = squareBounds({ lat: 9000, lng });
      expect(squareAt(south, west).lng).toBe(lng);
      expect(squareAt(0, lng / 100 - 180).lng).toBe(lng);
    }
  });

  it('puts the south-west corner of each row into that row', () => {
    for (let lat = 0; lat < LAT_ROWS; lat++) {
      const { south, west } = squareBounds({ lat, lng: 0 });
      expect(squareAt(south, west).lat).toBe(lat);
      expect(squareAt(lat / 100 - 90, 0).lat).toBe(lat);
    }
  });

  it('puts a point just inside the north-east corner into the same square', () => {
    const square = { lat: 12345, lng: 23456 };
    const { north, east } = squareBounds(square);
    expect(squareAt(north - 1e-7, east - 1e-7)).toEqual(square);
    expect(squareAt(north, east)).toEqual({ lat: 12346, lng: 23457 });
  });

  it('uses the south-west corner: lat 0, lng 0 is 90°S, 180°W', () => {
    expect(squareBounds({ lat: 0, lng: 0 })).toEqual({
      south: -90,
      west: -180,
      north: -89.99,
      east: -179.99,
    });
    expect(squareAt(0, 0)).toEqual({ lat: 9000, lng: 18000 });
    expect(squareAt(-0.001, -0.001)).toEqual({ lat: 8999, lng: 17999 });
  });

  it('wraps the longitude at ±180°', () => {
    expect(squareAt(0, -180).lng).toBe(0);
    expect(squareAt(0, 180).lng).toBe(0);
    expect(squareAt(0, 179.995).lng).toBe(35999);
    expect(squareAt(0, -180.005).lng).toBe(35999);
    // World copies of the map.
    expect(squareAt(0, 180.005).lng).toBe(0);
    expect(squareAt(0, 540.005).lng).toBe(0);
    expect(squareAt(0, -540.005).lng).toBe(35999);
    expect(squareBounds({ lat: 0, lng: 35999 }).east).toBe(180);
  });

  it('starts row 0 at 90°S and ends row 17999 at 90°N', () => {
    expect(squareAt(-90, 0).lat).toBe(0);
    expect(squareAt(90, 0).lat).toBe(LAT_ROWS - 1);
    expect(squareAt(89.995, 0).lat).toBe(17999);
    expect(squareBounds({ lat: 0, lng: 0 }).south).toBe(-90);
    expect(squareBounds({ lat: 17999, lng: 0 }).north).toBe(90);
    // Points outside the map go to the nearest row.
    expect(squareAt(-91, 0).lat).toBe(0);
    expect(squareAt(91, 0).lat).toBe(17999);
  });
});

describe('packSquare and unpackSquare', () => {
  it('packs (lat << 16) | lng', () => {
    expect(packSquare({ lat: 1, lng: 2 })).toBe(65538);
    expect(packSquare({ lat: 0, lng: 0 })).toBe(0);
    expect(packSquare({ lat: 17999, lng: 35999 })).toBe((17999 << 16) | 35999);
  });

  it('unpacks the packed value', () => {
    for (const square of [
      { lat: 0, lng: 0 },
      { lat: 1, lng: 2 },
      { lat: 9000, lng: 18000 },
      { lat: 17999, lng: 35999 },
    ]) {
      expect(unpackSquare(packSquare(square))).toEqual(square);
    }
  });
});

describe('gridLines', () => {
  it('gives each line in the bounds, with no drift', () => {
    const { lats, lngs } = gridLines({ south: 0, west: 0, north: 0.05, east: 0.05 });
    expect(lats).toEqual([0, 0.01, 0.02, 0.03, 0.04, 0.05].map((d) => (d * 100 + 9000) / 100 - 90));
    expect(lngs).toHaveLength(6);
    expect(lngs[0]).toBe(0);
    expect(lngs[5]).toBe(18005 / 100 - 180);
  });

  it('includes the lines on the edges of the bounds', () => {
    const { lats, lngs } = gridLines({ south: -89.99, west: -179.99, north: -89.97, east: -179.97 });
    expect(lats).toHaveLength(3);
    expect(lngs).toHaveLength(3);
  });

  it('gives no latitude lines outside the poles', () => {
    const { lats } = gridLines({ south: -91, west: 0, north: -89.98, east: 0.01 });
    expect(lats[0]).toBe(-90);
    expect(lats).toHaveLength(3);
  });

  it('gives no lines in a direction with more than maxLines', () => {
    const { lats, lngs } = gridLines({ south: 0, west: 0, north: 10, east: 1 }, 400);
    expect(lats).toEqual([]);
    expect(lngs).toHaveLength(101);
  });
});
