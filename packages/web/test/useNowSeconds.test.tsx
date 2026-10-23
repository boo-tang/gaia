// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useNowSeconds } from '../src/hooks/useNowSeconds';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-23T12:00:00Z'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useNowSeconds', () => {
  it('gives the current time and moves each second', () => {
    const { result } = renderHook(() => useNowSeconds());
    const start = Date.parse('2026-10-23T12:00:00Z') / 1000;
    expect(result.current).toBe(start);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current).toBe(start + 3);
  });

  it('uses one timer for all components and stops it after the last one', () => {
    const setInterval = vi.spyOn(window, 'setInterval');
    const clearInterval = vi.spyOn(window, 'clearInterval');
    const first = renderHook(() => useNowSeconds());
    const second = renderHook(() => useNowSeconds());
    expect(setInterval).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(first.result.current).toBe(second.result.current);

    first.unmount();
    expect(clearInterval).not.toHaveBeenCalled();
    second.unmount();
    expect(clearInterval).toHaveBeenCalledTimes(1);
  });

  it('starts with the current time after a pause with no components', () => {
    renderHook(() => useNowSeconds()).unmount();
    vi.setSystemTime(new Date('2026-10-23T13:00:00Z'));
    const { result } = renderHook(() => useNowSeconds());
    expect(result.current).toBe(Date.parse('2026-10-23T13:00:00Z') / 1000);
  });
});
