import { type Address, packSquare } from '@gaia/core';

import { describe, expect, it } from 'vitest';

import type { HeldBid } from '../src/bids/bids-reducer';
import { OWN_COLOR, bidderColor } from '../src/map/bidder-colors';
import {
  VIEW_STORAGE_KEY,
  WORLD_VIEW,
  firstView,
  readSavedView,
  saveView,
  viewForTimeZone,
} from '../src/map/first-view';
import { bidRows, buildLayers, gridAlpha, gridPaths } from '../src/map/layers';
import { boundsToViewport, padBounds } from '../src/map/viewport';

const ALICE: Address = '0x00000000000000000000000000000000000000a1';
const bid = (bidder: Address = ALICE): HeldBid => ({
  shapeId: 1,
  bidder,
  amount: 10n ** 16n,
  asOf: { block: 1, logIndex: 0 },
});

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

describe('layers', () => {
  const polar = packSquare({ lat: 17600, lng: 100 }); // 86°N
  const london = packSquare({ lat: 14150, lng: 17990 });
  const bids = new Map([
    [polar, bid()],
    [london, bid()],
  ]);

  it('skips squares beyond ±85.0511° on a flat map only', () => {
    expect(bidRows(bids, true).map(([id]) => id)).toEqual([polar, london]);
    expect(bidRows(bids, false).map(([id]) => id)).toEqual([london]);
  });

  it('makes grid lines in the area, clamped on a flat map', () => {
    const view = { south: 85, north: 85.05, west: 0, east: 0.02 };
    expect(gridPaths(view, true)).toHaveLength(6 + 3);
    expect(gridPaths({ ...view, south: 85.06, north: 85.1 }, false)).toEqual([]);
    expect(gridPaths(undefined, true)).toEqual([]);
  });

  it('fades the grid in from zoom 9 to zoom 14', () => {
    expect(gridAlpha(8)).toBe(0);
    expect(gridAlpha(9)).toBe(0);
    expect(gridAlpha(11.5)).toBe(45);
    expect(gridAlpha(14)).toBe(89);
    expect(gridAlpha(18)).toBe(89);
  });

  it('builds flat layers under the place names', () => {
    const layers = buildLayers({
      rows: bidRows(bids, true),
      bidsVersion: 1,
      grid: [],
      zoom: 12,
      selected: [],
      beforeId: 'label_city',
      globe: true,
    });
    expect(layers.map(layer => layer.id)).toEqual(['bids', 'grid', 'selection', 'hover']);
    for (const layer of layers) {
      expect(layer.props).toMatchObject({
        beforeId: 'label_city',
        parameters: { depthCompare: 'always', depthWriteEnabled: false },
      });
    }
    expect(layers[0].props).toMatchObject({ extruded: false, pickable: false });
  });

  it('turns the bids into columns with a height scale', () => {
    const [bidsLayer] = buildLayers({
      rows: [],
      bidsVersion: 1,
      grid: [],
      zoom: 12,
      selected: [],
      globe: true,
      metersPerEth: 1000,
    });
    expect(bidsLayer.props).toMatchObject({ extruded: true, pickable: true, parameters: {} });
  });
});

describe('bidderColor', () => {
  it('gives each address one colour, and the own wallet its own colour', () => {
    const bob = '0x00000000000000000000000000000000000000B2';
    expect(bidderColor(bob, undefined)).toEqual(bidderColor(bob.toLowerCase(), ALICE));
    expect(bidderColor(bob, bob.toLowerCase())).toEqual(OWN_COLOR);
    for (let i = 0; i < 50; i++) {
      expect(bidderColor(`0x${i.toString(16).padStart(40, '0')}`, undefined)).not.toEqual(OWN_COLOR);
    }
  });
});

describe('first view', () => {
  const storage = (text: string | null) => ({ getItem: (key: string) => (key === VIEW_STORAGE_KEY ? text : null) });

  it('uses the saved view first', () => {
    const saved = { longitude: 10, latitude: 20, zoom: 8 };
    expect(firstView(readSavedView(storage(JSON.stringify(saved))), 'Europe/London')).toEqual(saved);
  });

  it('uses the region of the time zone, also an old ICU name', () => {
    expect(firstView(undefined, 'Europe/London')).toEqual({ latitude: 51.51, longitude: -0.13, zoom: 5 });
    expect(viewForTimeZone('Asia/Calcutta')).toEqual(viewForTimeZone('Asia/Kolkata'));
  });

  it('shows the globe for an unknown zone and UTC', () => {
    expect(firstView(undefined, 'UTC')).toEqual(WORLD_VIEW);
    expect(firstView(undefined, 'Mars/Olympus')).toEqual(WORLD_VIEW);
    expect(firstView(undefined, undefined)).toEqual(WORLD_VIEW);
  });

  it('ignores a broken or blocked saved view', () => {
    expect(readSavedView(storage('{nope'))).toBeUndefined();
    expect(readSavedView(storage(JSON.stringify({ longitude: 'x', latitude: 0, zoom: 1 })))).toBeUndefined();
    expect(readSavedView(storage(JSON.stringify({ longitude: 0, latitude: 95, zoom: 1 })))).toBeUndefined();
    expect(readSavedView(storage(null))).toBeUndefined();
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
    };
    expect(readSavedView(blocked)).toBeUndefined();
    expect(() =>
      saveView(
        {
          setItem: () => {
            throw new Error('QuotaExceededError');
          },
        },
        WORLD_VIEW,
      ),
    ).not.toThrow();
  });
});
