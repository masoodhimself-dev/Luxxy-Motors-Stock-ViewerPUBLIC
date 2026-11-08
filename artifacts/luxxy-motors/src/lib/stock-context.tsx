import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { useGetStock, getGetStockQueryKey } from '@workspace/api-client-react';
import { isVehiclePagePath, vehicleCodeFromPath, vehicleDetailPath } from '@workspace/vehicle-meta';
import { createStockLoader } from './stock-refresh';
import { canRefreshNow, useRefreshActive } from './refresh-policy';
import { previewPublicRequestPath } from './private-website-preview';

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
  listedAt?: string | null;
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
  vehicle: Car | null;
  isVehicleLoading: boolean;
  vehicleError: string | null;
  retryVehicle: () => void;
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

function vehicleEndpoint(location: string) {
  const code = vehicleCodeFromPath(location);
  if (code) return `/api/vehicles/short/${code}`;
  const id = /^\/vehicle\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\/?$/i.exec(location)?.[1];
  return id ? `/api/vehicles/${id.toLowerCase()}` : null;
}

async function loadPublicVehicle(endpoint: string, signal: AbortSignal): Promise<Car | null> {
  const response = await fetch(previewPublicRequestPath(endpoint), {
    credentials: 'same-origin', cache: 'no-store', signal,
    headers: { Accept: 'application/json' },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Unable to load this vehicle.');
  const car = await response.json() as Car;
  if (!car || typeof car.id !== 'string' || !car.id) throw new Error('Unable to load this vehicle.');
  return car;
}

export function StockProvider({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const portal = /^\/portal(?:\/|$)/.test(location);
  const cache = useQueryClient();
  const active = useRefreshActive();
  const endpoint = vehicleEndpoint(location);
  const vehicleQuery = useQuery({
    queryKey: ['public-vehicle', endpoint],
    enabled: endpoint !== null,
    staleTime: 30_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const car = await loadPublicVehicle(endpoint!, signal);
      if (car) {
        // The legacy UUID can redirect to a published slug without a second fetch.
        const canonicalEndpoint = vehicleEndpoint(vehicleDetailPath(car));
        if (canonicalEndpoint && canonicalEndpoint !== endpoint) cache.setQueryData(['public-vehicle', canonicalEndpoint], car);
      }
      return car;
    },
  });
  // The full list is supplementary on vehicle pages. Start it after the
  // individual lookup so it cannot hold up the photo, price, or test drive.
  const loadStockForRoute = !isVehiclePagePath(location) || endpoint === null || vehicleQuery.data !== undefined;
  const [loadStock] = useState(() => createStockLoader());
  const { data: apiStock, isLoading, error } = useGetStock({ query: {
    queryKey: getGetStockQueryKey(), queryFn: ({ signal }) => loadStock(signal),
    enabled: active && loadStockForRoute, staleTime: portal ? 30_000 : 5 * 60_000,
    refetchInterval: portal ? 5 * 60_000 : false,
    refetchIntervalInBackground: false, refetchOnWindowFocus: true, refetchOnReconnect: true,
  } });
  useEffect(() => {
    if (portal || !loadStockForRoute) return;
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
  }, [cache, loadStockForRoute, portal]);
  const stock = useMemo(() => normalizeStock(apiStock), [apiStock]);
  const errorMessage = error instanceof Error ? error.message : error ? 'Unable to load current stock.' : null;

  return (
    <StockContext.Provider value={{
      stock, isLoading, error: errorMessage,
      vehicle: vehicleQuery.data ?? null,
      isVehicleLoading: vehicleQuery.isPending && endpoint !== null,
      vehicleError: vehicleQuery.error?.message ?? null,
      retryVehicle: () => { void vehicleQuery.refetch(); },
    }}>
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
