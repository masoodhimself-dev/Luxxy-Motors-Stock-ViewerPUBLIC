import { useCallback, useEffect, useMemo, type SetStateAction } from 'react';
import { useLocation, useSearch } from 'wouter';
import type { Car } from '@/lib/stock-context';
import type { StockFilters } from './types';
import { createStockFilters, parseStockFilters, serializeStockFilters, updateStockFilters } from './url';

/** The query is authoritative; browser session storage only remembers return position. */
export function useStockSearch({ enabled, cars }: { enabled: boolean; cars: Car[] }) {
  const [location, navigate] = useLocation();
  const search = useSearch();
  const filters = useMemo(() => parseStockFilters(new URLSearchParams(search)), [search]);
  const href = useCallback((next: StockFilters) => {
    const query = serializeStockFilters(next).toString();
    return location + (query ? '?' + query : '');
  }, [location]);

  useEffect(() => {
    if (!enabled) return;
    // A newer navigation may already have happened before this effect runs.
    // Never write a previous render's query over that navigation.
    if (window.location.search.replace(/^\?/, '') !== search.replace(/^\?/, '')) return;
    const canonical = serializeStockFilters(filters).toString();
    if (canonical !== search.replace(/^\?/, '')) navigate(href(filters), { replace: true });
  }, [enabled, filters, href, navigate, search]);

  const onChange = useCallback((patch: Partial<StockFilters>) => {
    if (!enabled) return;
    const current = parseStockFilters(new URLSearchParams(window.location.search));
    const next = updateStockFilters(current, patch, cars);
    if (href(next) !== window.location.pathname + window.location.search) navigate(href(next), { replace: true });
  }, [enabled, cars, href, navigate]);

  const setFilters = useCallback((action: SetStateAction<StockFilters>) => {
    const current = parseStockFilters(new URLSearchParams(window.location.search));
    onChange(typeof action === 'function' ? action(current) : action);
  }, [onChange]);

  const clear = useCallback(() => onChange(createStockFilters()), [onChange]);
  const showMore = useCallback(() => {
    if (!enabled) return;
    const current = parseStockFilters(new URLSearchParams(window.location.search));
    navigate(href({ ...current, page: (current.page || 1) + 1 }));
  }, [enabled, href, navigate]);

  return { filters, onChange, setFilters, clear, showMore, visibleCount: (filters.page || 1) * 12 };
}
