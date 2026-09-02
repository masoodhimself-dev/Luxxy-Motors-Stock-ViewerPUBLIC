import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_COMPARE, SavedCarsProvider, useSavedCars } from '@/lib/saved-cars-context';

const SAVED_KEY = 'luxxy.saved-cars.v1';
const COMPARE_KEY = 'luxxy.compare-cars.v1';

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

describe('comparing cars', () => {
  it('holds two cars and refuses a third', () => {
    const { result } = setup();
    const outcomes: string[] = [];

    act(() => {
      outcomes.push(result.current.toggleCompare('bmw-1-series'));
    });
    act(() => {
      outcomes.push(result.current.toggleCompare('audi-a3'));
    });
    act(() => {
      outcomes.push(result.current.toggleCompare('ford-fiesta'));
    });

    expect(outcomes).toEqual(['added', 'added', 'full']);
    expect(result.current.compareIds).toEqual(['bmw-1-series', 'audi-a3']);
    expect(result.current.compareIds).toHaveLength(MAX_COMPARE);
    expect(result.current.isComparing('ford-fiesta')).toBe(false);
  });

  it('frees a slot when a car is removed', () => {
    const { result } = setup();

    act(() => {
      result.current.toggleCompare('bmw-1-series');
    });
    act(() => {
      result.current.toggleCompare('audi-a3');
    });

    let removal = '';
    act(() => {
      removal = result.current.toggleCompare('bmw-1-series');
    });
    expect(removal).toBe('removed');

    let addition = '';
    act(() => {
      addition = result.current.toggleCompare('ford-fiesta');
    });
    expect(addition).toBe('added');
    expect(result.current.compareIds).toEqual(['audi-a3', 'ford-fiesta']);

    act(() => {
      result.current.clearCompare();
    });
    expect(result.current.compareIds).toEqual([]);
  });

  it('reports the outcome of clicks that land before a re-render', () => {
    const { result } = setup();
    const outcomes: string[] = [];

    // Three buttons clicked in the same tick: the third must still be told the comparison is full.
    act(() => {
      outcomes.push(result.current.toggleCompare('a'));
      outcomes.push(result.current.toggleCompare('b'));
      outcomes.push(result.current.toggleCompare('c'));
    });

    expect(outcomes).toEqual(['added', 'added', 'full']);
    expect(result.current.compareIds).toEqual(['a', 'b']);
  });

  it('gives back the slot held by a car that has left the stock list', () => {
    window.localStorage.setItem(COMPARE_KEY, JSON.stringify(['sold-car', 'still-here']));
    const { result } = setup();

    act(() => {
      result.current.pruneCompare(['still-here', 'another-car']);
    });
    expect(result.current.compareIds).toEqual(['still-here']);

    let outcome = '';
    act(() => {
      outcome = result.current.toggleCompare('another-car');
    });

    expect(outcome).toBe('added');
    expect(result.current.compareIds).toEqual(['still-here', 'another-car']);
  });

  it('leaves the comparison untouched when every car is still available', () => {
    window.localStorage.setItem(COMPARE_KEY, JSON.stringify(['a', 'b']));
    const { result } = setup();
    const before = result.current.compareIds;

    act(() => {
      result.current.pruneCompare(['a', 'b', 'c']);
    });

    expect(result.current.compareIds).toBe(before);
  });

  it('never restores more than two cars from an earlier session', () => {
    window.localStorage.setItem(COMPARE_KEY, JSON.stringify(['a', 'b', 'c', 'd']));

    const { result } = setup();

    expect(result.current.compareIds).toEqual(['a', 'b']);
  });

  it('keeps the stored comparison in step with the current selection', () => {
    const { result } = setup();

    act(() => {
      result.current.toggleCompare('bmw-1-series');
    });

    expect(JSON.parse(window.localStorage.getItem(COMPARE_KEY) || '[]')).toEqual(['bmw-1-series']);
  });
});
