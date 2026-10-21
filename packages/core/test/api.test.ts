import { describe, expect, it } from 'vitest';

import { formatPosition, isBefore, parsePosition } from '../src/api';

describe('positions', () => {
  it('orders positions by block, then by log index', () => {
    expect(isBefore({ block: 1, logIndex: 5 }, { block: 2, logIndex: 0 })).toBe(true);
    expect(isBefore({ block: 2, logIndex: -1 }, { block: 2, logIndex: 0 })).toBe(true);
    expect(isBefore({ block: 2, logIndex: 0 }, { block: 2, logIndex: 0 })).toBe(false);
    expect(isBefore({ block: 3, logIndex: 0 }, { block: 2, logIndex: 9 })).toBe(false);
  });

  it('writes and reads the SSE id of a position', () => {
    expect(formatPosition({ block: 120, logIndex: 4 })).toBe('120:4');
    expect(parsePosition('120:4')).toEqual({ block: 120, logIndex: 4 });
    expect(parsePosition('120:-1')).toEqual({ block: 120, logIndex: -1 });
  });

  it('rejects text that is not a position', () => {
    for (const text of ['', '120', '120:', ':4', '-1:4', '1.5:2', '120:-2', '12:4:1', 'a:b', '1e3:1']) {
      expect(parsePosition(text)).toBeUndefined();
    }
  });
});
