import { createContext, useContext, type ReactNode } from 'react';
import { useGetStock, getGetStockQueryKey } from '@workspace/api-client-react';

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
  const { data: apiStock, isLoading, error } = useGetStock({ query: { queryKey: getGetStockQueryKey(), staleTime: 30_000, refetchInterval: 60_000, refetchOnWindowFocus: true } });
  const stock = normalizeStock(apiStock);
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
