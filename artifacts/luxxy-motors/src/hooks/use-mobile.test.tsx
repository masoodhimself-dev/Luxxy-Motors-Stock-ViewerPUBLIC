import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useIsMobile } from './use-mobile';

afterEach(() => vi.unstubAllGlobals());

it('retains the phone default and supports the vehicle layout’s wider tablet breakpoint', () => {
  const matchMedia = vi.fn((query: string) => ({
    matches: query === '(max-width: 1099px)', media: query,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  }));
  vi.stubGlobal('matchMedia', matchMedia);
  const phone = renderHook(() => useIsMobile());
  expect(phone.result.current).toBe(false);
  const vehicle = renderHook(() => useIsMobile(1100));
  expect(vehicle.result.current).toBe(true);
  expect(matchMedia).toHaveBeenCalledWith('(max-width: 767px)');
  expect(matchMedia).toHaveBeenCalledWith('(max-width: 1099px)');
});

it('updates when a tablet rotates across the layout breakpoint and removes its listener', () => {
  let matches = true;
  let onChange = () => {};
  const removeEventListener = vi.fn();
  vi.stubGlobal('matchMedia', vi.fn(query => ({
    get matches() { return matches; }, media: query,
    addEventListener: (_: string, listener: () => void) => { onChange = listener; },
    removeEventListener,
  })));
  const { result, unmount } = renderHook(() => useIsMobile(1100));
  expect(result.current).toBe(true);
  act(() => { matches = false; onChange(); });
  expect(result.current).toBe(false);
  unmount();
  expect(removeEventListener).toHaveBeenCalledWith('change', onChange);
});
