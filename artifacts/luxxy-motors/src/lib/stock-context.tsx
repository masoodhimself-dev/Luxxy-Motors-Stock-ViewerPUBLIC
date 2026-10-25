import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { useGetStock, getGetStockQueryKey } from '@workspace/api-client-react';
import { createStockLoader } from './stock-refresh';
import { canRefreshNow, useRefreshActive } from './refresh-policy';
import { useCustomerPreview } from './customer-preview-context';

export type CarImage = { url: string; caption: string | null } | string;

export interface Car {
  [key: string]: unknown;
  id: string;
  advertId: string;
  title: string | null;
  variant: string | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  year: number | null;
  price: number | null;
  priceType: string | null;
  currency: string | null;
  mileage: number | null;
  mileageText: string | null;
  registration: string | null;
  registrationBand: string | null;
  plate: string | null;
  vrm: string | null;
  vrmVerified: boolean | null;
  fuel: string | null;
  transmission: string | null;
  bodyType: string | null;
  engineSize: string | null;
  engineCC: number | null;
  doors: number | null;
  seats: number | null;
  colour: string | null;
  emissionClass: string | null;
  drivetrain: string | null;
  owners: number | null;
  writeOffCategory: string | null;
  advertUrl: string | null;
  dealerName: string | null;
  dealerLocation: string | null;
  imageCount: number | null;
  heroImage: string | null;
  images: CarImage[];
  specifications: Record<string, unknown> | null;
  sourceExtras: Record<string, unknown> | null;
}

export interface StockData {
  [key: string]: unknown;
  schemaVersion: 1;
  dealerName: string | null;
  dealerLocation: string | null;
  count: number;
  scrapedAt: string | null;
  cars: Car[];
}

interface StockContextType {
  stock: StockData | null;
  isLoading: boolean;
  error: string | null;
}

const StockContext = createContext<StockContextType | undefined>(undefined);

function normalizeStock(data: unknown): StockData | null {
  if (!data || typeof data !== 'object') return null;
  const candidate = data as Record<string, unknown>;
  if (!Array.isArray(candidate.cars)) return null;

  return {
    ...candidate,
    cars: candidate.cars.map((car, index) => {
      const value =
        car && typeof car === 'object'
          ? (car as Record<string, unknown>)
          : {};
      return {
        ...value,
        id: (typeof value.id === 'string' && value.id) ||
          (typeof value.advertId === 'string' && value.advertId) ||
          `car-${index}`,
      } as Car;
    }),
  } as StockData;
}

export function StockProvider({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const portal = /^\/portal(?:\/|$)/.test(location);
  const cache = useQueryClient();
  const active = useRefreshActive();
  const preview = useCustomerPreview();
  const [loadStock] = useState(() => createStockLoader());
  const { data: apiStock, isLoading, error } = useGetStock({ query: {
    queryKey: getGetStockQueryKey(), queryFn: ({ signal }) => loadStock(signal),
    enabled: active && !preview, staleTime: portal ? 30_000 : 5 * 60_000,
    refetchInterval: portal ? 5 * 60_000 : false,
    refetchIntervalInBackground: false, refetchOnWindowFocus: true, refetchOnReconnect: true,
  } });
  useEffect(() => {
    if (portal || preview) return;
    // A desktop app switch may focus the window without a visibility change.
    // Reuse fresh data, and let the query deduplicate any check already underway.
    const onFocus = () => {
      const queryKey = getGetStockQueryKey();
      const state = cache.getQueryState(queryKey);
      if (!canRefreshNow() || !state || state.fetchStatus === 'fetching' || Date.now() - state.dataUpdatedAt < 5 * 60_000) return;
      void cache.refetchQueries({ queryKey, exact: true, type: 'active' }, { cancelRefetch: false });
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [cache, portal, preview]);
  const stock = useMemo(() => normalizeStock(apiStock), [apiStock]);
  const errorMessage = error instanceof Error ? error.message : error ? 'Unable to load current stock.' : null;

  return (
    <StockContext.Provider value={{ stock, isLoading, error: errorMessage }}>
      {children}
    </StockContext.Provider>
  );
}

export function useStock() {
  const context = useContext(StockContext);
  if (context === undefined) {
    throw new Error('useStock must be used within a StockProvider');
  }
  return context;
}
