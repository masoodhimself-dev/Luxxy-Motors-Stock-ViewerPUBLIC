import { useLayoutEffect, type ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import type { Car } from '@/lib/stock-context';
import { useStockSearch } from './use-stock-search';

const cars = [
  { id: 'bmw-one', make: 'BMW', model: '1 Series', price: 5000, colour: 'Blue' },
  { id: 'audi-three', make: 'Audi', model: 'A3', price: 8000, colour: 'Silver' },
  { id: 'ford-fiesta', make: 'Ford', model: 'Fiesta', price: 6000, colour: 'Blue' },
] as Car[];

function wrapper({ children }: { children: ReactNode }) {
  return <Router>{children}</Router>;
}

function mount(initial = '/stock', enabled = true) {
  window.history.replaceState({}, '', initial);
  return renderHook(() => useStockSearch({ enabled, cars }), { wrapper });
}

const params = () => new URLSearchParams(window.location.search);

beforeEach(() => {
  window.history.replaceState({}, '', '/stock');
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('stock search with the real browser router', () => {
  it('reads query-only push and replace navigation without remounting', async () => {
    const { result } = mount('/stock?make=BMW');
    expect(result.current.filters.make).toBe('BMW');

    act(() => window.history.pushState({}, '', '/stock?make=Audi&model=A3&colour=Silver'));
    await waitFor(() => expect(result.current.filters).toMatchObject({ make: 'Audi', model: 'A3', colour: 'Silver' }));
    expect(window.location.pathname).toBe('/stock');

    act(() => window.history.replaceState({}, '', '/stock?make=Ford&maxPrice=6000'));
    await waitFor(() => expect(result.current.filters).toMatchObject({ make: 'Ford', model: '', maxPrice: '6000', colour: '' }));
    expect(params().get('make')).toBe('Ford');
  });

  it('treats an empty stock URL as cleared even when legacy browsing state exists', async () => {
    sessionStorage.setItem('luxxy.browse.v1', JSON.stringify({ filters: { make: 'Ford', model: 'Fiesta', maxPrice: '6000' }, visibleCount: 36 }));
    const { result } = mount();
    expect(result.current.filters).toMatchObject({ make: '', model: '', maxPrice: '', page: 1 });
    expect(result.current.visibleCount).toBe(12);
    expect(window.location.search).toBe('');

    act(() => result.current.onChange({ make: 'BMW', colour: 'Blue' }));
    expect(result.current.filters.make).toBe('BMW');
    act(() => window.history.pushState({}, '', '/stock'));
    await waitFor(() => expect(result.current.filters).toMatchObject({ make: '', colour: '', page: 1 }));
    expect(window.location.search).toBe('');
  });

  it('canonicalizes compatible aliases and removes invalid or unsupported query values', async () => {
    const { result } = mount('/stock?gearbox=automatic&body=Hatchback&q=blue&seats=-1&mileage=-5&maxPrice=NaN&sort=finance&page=0&ulez=false&monthly=250');
    await waitFor(() => expect(window.location.search).toBe('?transmission=automatic&bodyType=Hatchback&search=blue'));
    expect(result.current.filters).toMatchObject({ transmission: 'automatic', bodyType: 'Hatchback', search: 'blue', seats: '', mileage: '', maxPrice: '', sort: '', page: 1, ulez: false });
    for (const key of ['gearbox', 'body', 'q', 'monthly', 'seats', 'page']) expect(params().has(key)).toBe(false);
  });

  it('does not canonicalize a previous render over a newer navigation', async () => {
    window.history.replaceState({}, '', '/stock?gearbox=automatic&body=Hatchback');
    const { result } = renderHook(() => {
      const state = useStockSearch({ enabled: true, cars });
      useLayoutEffect(() => {
        window.history.pushState({}, '', '/stock?make=Audi&colour=Silver');
      }, []);
      return state;
    }, { wrapper });

    await waitFor(() => expect(result.current.filters).toMatchObject({ make: 'Audi', colour: 'Silver', transmission: '', bodyType: '' }));
    expect(window.location.search).toBe('?make=Audi&colour=Silver');
  });

  it('merges batched changes and functional edits from the latest query', () => {
    const { result } = mount('/stock?make=BMW');
    act(() => {
      result.current.onChange({ model: '1 Series' });
      result.current.onChange({ colour: 'Blue' });
      result.current.setFilters(current => ({ ...current, maxPrice: '5000' }));
    });
    expect(result.current.filters).toMatchObject({ make: 'BMW', model: '1 Series', colour: 'Blue', maxPrice: '5000' });
    expect(params().get('model')).toBe('1 Series');
    expect(params().get('colour')).toBe('Blue');
    expect(params().get('maxPrice')).toBe('5000');
  });

  it('pushes load-more batches and restores their counts with browser Back and Forward', async () => {
    const { result } = mount('/stock?make=BMW');
    const initialLength = window.history.length;
    act(() => result.current.showMore());
    expect(result.current.visibleCount).toBe(24);
    expect(params().get('page')).toBe('2');
    act(() => result.current.showMore());
    expect(result.current.visibleCount).toBe(36);
    expect(window.history.length).toBe(initialLength + 2);
    expect(params().get('make')).toBe('BMW');

    await act(async () => {
      window.history.back();
      await new Promise<void>(resolve => window.addEventListener('popstate', () => resolve(), { once: true }));
    });
    await waitFor(() => expect(result.current.visibleCount).toBe(24));
    expect(params().get('page')).toBe('2');

    await act(async () => {
      window.history.forward();
      await new Promise<void>(resolve => window.addEventListener('popstate', () => resolve(), { once: true }));
    });
    await waitFor(() => expect(result.current.visibleCount).toBe(36));
    expect(params().get('page')).toBe('3');
  });

  it('replaces filter and sort changes while resetting the visible batch to one', () => {
    const { result } = mount('/stock?make=BMW&page=3');
    const initialLength = window.history.length;
    act(() => result.current.onChange({ colour: 'Blue' }));
    expect(result.current.visibleCount).toBe(12);
    expect(params().has('page')).toBe(false);
    expect(window.history.length).toBe(initialLength);

    act(() => result.current.showMore());
    expect(result.current.visibleCount).toBe(24);
    act(() => result.current.onChange({ sort: 'price-desc' }));
    expect(result.current.visibleCount).toBe(12);
    expect(params().get('sort')).toBe('price-desc');
    expect(params().get('make')).toBe('BMW');
    expect(params().get('colour')).toBe('Blue');
    expect(params().has('page')).toBe(false);
    expect(window.history.length).toBe(initialLength + 1);
  });

  it('clears every active facet and page through the same URL state', () => {
    const { result } = mount('/stock?make=BMW,Audi&model=1%20Series&minPrice=1000&maxPrice=9000&fuel=Petrol&transmission=Automatic&bodyType=Hatchback&colour=Blue&engine=2.0&seats=5&mileage=50000&search=blue&ulez=true&sort=price-asc&page=3');
    act(() => result.current.clear());
    expect(window.location.search).toBe('');
    expect(result.current.filters).toMatchObject({ make: '', model: '', minPrice: '', maxPrice: '', fuel: '', transmission: '', bodyType: '', colour: '', engine: '', seats: '', mileage: '', search: '', ulez: false, sort: '', page: 1 });
    expect(result.current.visibleCount).toBe(12);
  });

  it('never rewrites the URL or history when disabled', () => {
    window.history.replaceState({}, '', '/stock?gearbox=automatic&unrelated=keep&page=3');
    const replace = vi.spyOn(window.history, 'replaceState');
    const push = vi.spyOn(window.history, 'pushState');
    const { result } = renderHook(() => useStockSearch({ enabled: false, cars }), { wrapper });
    act(() => {
      result.current.onChange({ make: 'BMW' });
      result.current.setFilters(current => ({ ...current, search: 'silver' }));
      result.current.clear();
      result.current.showMore();
    });
    expect(window.location.search).toBe('?gearbox=automatic&unrelated=keep&page=3');
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('preserves linked page and unavailable selections while stock is still absent or changes', () => {
    window.history.replaceState({}, '', '/stock?make=Volvo&model=V60&page=3');
    const { result, rerender } = renderHook(({ stock }: { stock: Car[] }) => useStockSearch({ enabled: true, cars: stock }), { wrapper, initialProps: { stock: [] } });
    expect(result.current.filters).toMatchObject({ make: 'Volvo', model: 'V60', page: 3 });
    expect(result.current.visibleCount).toBe(36);
    rerender({ stock: cars });
    expect(result.current.filters).toMatchObject({ make: 'Volvo', model: 'V60', page: 3 });
    expect(result.current.visibleCount).toBe(36);
    expect(window.location.search).toBe('?make=Volvo&model=V60&page=3');
  });
});
