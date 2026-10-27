import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { SavedCarsProvider, useSavedCars } from '@/lib/saved-cars-context';

const SAVED_KEY = 'luxxy.saved-cars.v1';

function setup() {
  return renderHook(() => useSavedCars(), { wrapper: SavedCarsProvider });
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('saved cars', () => {
  it('saves and removes cars, keeping the newest first', () => {
    const { result } = setup();

    act(() => {
      result.current.toggleSaved('bmw-1-series');
    });
    act(() => {
      result.current.toggleSaved('audi-a3');
    });

    expect(result.current.savedIds).toEqual(['audi-a3', 'bmw-1-series']);
    expect(result.current.isSaved('bmw-1-series')).toBe(true);
    expect(result.current.savedCount).toBe(2);

    act(() => {
      result.current.toggleSaved('bmw-1-series');
    });

    expect(result.current.savedIds).toEqual(['audi-a3']);
    expect(result.current.isSaved('bmw-1-series')).toBe(false);
  });

  it('restores the shortlist from a previous visit and ignores unreadable stores', () => {
    window.localStorage.setItem(SAVED_KEY, JSON.stringify(['ford-fiesta', 'vw-golf']));
    expect(setup().result.current.savedIds).toEqual(['ford-fiesta', 'vw-golf']);

    window.localStorage.setItem(SAVED_KEY, 'not json at all');
    expect(setup().result.current.savedIds).toEqual([]);

    window.localStorage.setItem(SAVED_KEY, JSON.stringify({ nope: true }));
    expect(setup().result.current.savedIds).toEqual([]);
  });

  it('removes only the cars it is asked to clear', () => {
    window.localStorage.setItem(SAVED_KEY, JSON.stringify(['a', 'b', 'c']));
    const { result } = setup();

    act(() => {
      result.current.clearSaved(['a', 'c']);
    });
    expect(result.current.savedIds).toEqual(['b']);

    act(() => {
      result.current.clearSaved();
    });
    expect(result.current.savedIds).toEqual([]);
  });
});
