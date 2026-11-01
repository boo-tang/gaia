import { LNG_COLUMNS, packSquare } from '@gaia/core';

import { describe, expect, it } from 'vitest';

import { outlineEdges } from '../src/map/outlines';

const id = (lat: number, lng: number) => packSquare({ lat, lng });

describe('outlineEdges', () => {
  it('gives 4 edges for one square', () => {
    expect(outlineEdges(new Map([[id(100, 100), 0]]))).toHaveLength(4);
  });

  it('gives no edge between two squares of one group', () => {
    const groups = new Map([
      [id(100, 100), 0],
      [id(100, 101), 0],
    ]);
    expect(outlineEdges(groups)).toHaveLength(6);
  });

  it('gives each of two touching groups its edge', () => {
    const groups = new Map([
      [id(100, 100), 1],
      [id(100, 101), 2],
    ]);
    const edges = outlineEdges(groups);
    expect(edges).toHaveLength(8);
    expect(edges.filter(edge => edge.group === 1)).toHaveLength(4);
  });

  it('joins the squares on the two sides of the antimeridian', () => {
    const groups = new Map([
      [id(100, LNG_COLUMNS - 1), 0],
      [id(100, 0), 0],
    ]);
    expect(outlineEdges(groups)).toHaveLength(6);
  });
});
