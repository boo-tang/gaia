import { packSquare, rectangleSquares } from '@gaia/core';

import { describe, expect, it, vi } from 'vitest';

import { rectangleSession } from '../src/selection/drag';
import { MAX_SELECTION_SQUARES, createSelectionStore } from '../src/selection/selection-store';
import { TOOLS, toolById } from '../src/selection/tools';

describe('createSelectionStore', () => {
  it('starts empty with the pan tool and the minimum bid', () => {
    const state = createSelectionStore().getState();
    expect(state.squareIds.size).toBe(0);
    expect(state.tool).toBe('pan');
    expect(state.priceMode).toBe('minimum');
    expect(state.pricePerSquare).toBeUndefined();
  });

  it('adds the squares of each drag, with no duplicates', () => {
    const store = createSelectionStore();
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.addSquares(rectangleSquares({ south: 0, north: 1, west: 0, east: 1 }))).toBe(true);
    expect(store.addSquares(rectangleSquares({ south: 1, north: 2, west: 1, east: 2 }))).toBe(true);
    expect(store.getState().squareIds.size).toBe(7);
    expect(listener).toHaveBeenCalledTimes(2);
    // The same squares again: no change.
    const before = store.getState();
    expect(store.addSquares([{ lat: 0, lng: 0 }])).toBe(true);
    expect(store.getState()).toBe(before);
  });

  it('does not change the selection when it would be too large', () => {
    const store = createSelectionStore();
    store.addSquares([{ lat: 5000, lng: 5000 }]);
    const tooMany = rectangleSquares({ south: 0, north: 99, west: 0, east: MAX_SELECTION_SQUARES / 100 - 1 });
    expect(tooMany).toHaveLength(MAX_SELECTION_SQUARES);
    expect(store.addSquares(tooMany)).toBe(false);
    expect(store.getState().squareIds.size).toBe(1);
  });

  it('toggles one square, within the cap', () => {
    const store = createSelectionStore();
    store.toggle({ lat: 1, lng: 1 });
    expect(store.getState().squareIds.has(packSquare({ lat: 1, lng: 1 }))).toBe(true);
    store.toggle({ lat: 1, lng: 1 });
    expect(store.getState().squareIds.size).toBe(0);
    store.addSquares(rectangleSquares({ south: 0, north: 99, west: 0, east: MAX_SELECTION_SQUARES / 100 - 1 }));
    store.toggle({ lat: 5000, lng: 5000 });
    expect(store.getState().squareIds.size).toBe(MAX_SELECTION_SQUARES);
    store.toggle({ lat: 0, lng: 0 });
    expect(store.getState().squareIds.size).toBe(MAX_SELECTION_SQUARES - 1);
  });

  it('clears and replaces the selection', () => {
    const store = createSelectionStore();
    store.addSquares([{ lat: 1, lng: 1 }]);
    store.clear();
    expect(store.getState().squareIds.size).toBe(0);
    store.replace([packSquare({ lat: 2, lng: 2 }), packSquare({ lat: 2, lng: 3 })]);
    expect([...store.getState().squareIds]).toEqual([packSquare({ lat: 2, lng: 2 }), packSquare({ lat: 2, lng: 3 })]);
  });

  it('keeps the tool and the price', () => {
    const store = createSelectionStore();
    store.setTool('rectangle');
    store.setPriceMode('perSquare');
    store.setPricePerSquare(5n);
    expect(store.getState()).toMatchObject({ tool: 'rectangle', priceMode: 'perSquare', pricePerSquare: 5n });
  });
});

describe('rectangleSession', () => {
  it('selects all squares from the start square to the pointer square', () => {
    const session = rectangleSession({ lat: 14170, lng: 17800 });
    expect(session.count()).toBe(1);
    session.update({ lat: 14179, lng: 17819 });
    expect(session.count()).toBe(200);
    expect(session.squares()).toHaveLength(200);
    expect(session.describe()).toBe('10 rows × 20 columns = 200 squares');
    expect(session.outline()).toHaveLength(1);
  });

  it('goes across the antimeridian', () => {
    const session = rectangleSession({ lat: 7220, lng: 1 });
    session.update({ lat: 7220, lng: 35998 });
    expect(session.squares().map(s => s.lng)).toEqual([35998, 35999, 0, 1]);
    expect(session.describe()).toBe('1 row × 4 columns = 4 squares');
  });
});

describe('TOOLS', () => {
  it('has a pan tool that pans and a rectangle tool that selects', () => {
    expect(TOOLS.map(tool => [tool.id, tool.key, tool.panOnDrag])).toEqual([
      ['pan', 'h', true],
      ['rectangle', 'r', false],
    ]);
    expect(toolById('rectangle').begin).toBe(rectangleSession);
    expect(toolById('pan').begin).toBeUndefined();
  });
});
