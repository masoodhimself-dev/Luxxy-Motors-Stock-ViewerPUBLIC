import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { canRefreshNow, useRefreshActive } from './refresh-policy';

beforeEach(() => {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});
afterEach(() => vi.restoreAllMocks());

it('pauses refreshes for hidden or offline pages and resumes on returning online', () => {
  const { result } = renderHook(useRefreshActive);
  expect(result.current).toBe(true);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(result.current).toBe(false);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(result.current).toBe(false);
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  act(() => window.dispatchEvent(new Event('online')));
  expect(result.current).toBe(true);
});

it('honours offline events immediately and does not resume a hidden page on reconnect', () => {
  const { result } = renderHook(useRefreshActive);
  act(() => window.dispatchEvent(new Event('offline')));
  expect(result.current).toBe(false);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  act(() => window.dispatchEvent(new Event('online')));
  expect(result.current).toBe(false);
  expect(canRefreshNow()).toBe(false);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  act(() => window.dispatchEvent(new Event('focus')));
  expect(result.current).toBe(true);
});

it('removes every event subscription when unmounted', () => {
  const documentRemove = vi.spyOn(document, 'removeEventListener');
  const windowRemove = vi.spyOn(window, 'removeEventListener');
  const { unmount } = renderHook(useRefreshActive);
  unmount();
  expect(documentRemove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  for (const name of ['focus', 'online', 'offline']) expect(windowRemove).toHaveBeenCalledWith(name, expect.any(Function));
});
