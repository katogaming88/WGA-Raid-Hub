import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useTouchScreen } from './device';

describe('useTouchScreen', () => {
  afterEach(() => vi.restoreAllMocks());

  const matching = (coarse: boolean) =>
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: coarse && query === '(pointer: coarse)',
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {}
        }) as unknown as MediaQueryList
    );

  it('is true when the main pointer is a touch screen', () => {
    matching(true);
    expect(renderHook(() => useTouchScreen()).result.current).toBe(true);
  });

  it('is false for a mouse or trackpad, whatever the window width', () => {
    matching(false);
    expect(renderHook(() => useTouchScreen()).result.current).toBe(false);
  });
});
