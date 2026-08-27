import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { useGetStock } from '@workspace/api-client-react';

export type CarImage = { url: string; caption?: string } | string;

export interface Car {
  [key: string]: unknown;
  id: string; // locally generated
  title?: string;
  variant?: string;
  make?: string;
  model?: string;
  trim?: string;
  year?: number;
  price?: number;
  priceType?: string;
  currency?: string;
  mileage?: number;
  mileageText?: string;
  registration?: string;
  plate?: string;
  fuel?: string;
  transmission?: string;
  bodyType?: string;
  engineSize?: string;
  engineCC?: number;
  doors?: number;
  seats?: number;
  colour?: string;
  emissionClass?: string;
  drivetrain?: string;
  owners?: number;
  writeOffCategory?: string;
  advertId?: string;
  advertUrl?: string;
  dealerName?: string;
  dealerLocation?: string;
  imageCount?: number;
  heroImage?: string;
  images?: CarImage[];
}

export interface StockData {
  [key: string]: unknown;
  dealerName?: string;
  dealerLocation?: string;
  count?: number;
  scrapedAt?: string;
  cars: Car[];
}

interface StockContextType {
  stock: StockData | null;
  isLoading: boolean;
}

const StockContext = createContext<StockContextType | undefined>(undefined);

function normalizeStock(data: unknown): StockData | null {
  if (!data || typeof data !== 'object') return null;
  const candidate = data as Record<string, unknown>;
  if (!Array.isArray(candidate.cars) || candidate.cars.length === 0) return null;

  return {
    ...candidate,
    cars: candidate.cars.map((car, index) => {
      const value =
        car && typeof car === 'object'
          ? (car as Record<string, unknown>)
          : {};
      return {
        ...value,
        id:
          (typeof value.id === 'string' && value.id) ||
          (typeof value.advertId === 'string' && value.advertId) ||
          `car-${index}`,
      } as Car;
    }),
  } as StockData;
}

export function StockProvider({ children }: { children: ReactNode }) {
  const { data: apiStock, isLoading: isApiLoading } = useGetStock();
  const [fallbackStock, setFallbackStock] = useState<StockData | null>(null);
  const [isFallbackLoading, setIsFallbackLoading] = useState(false);
  const [hasAttemptedFallback, setHasAttemptedFallback] = useState(false);

  useEffect(() => {
    // If API loaded but returned no valid cars, try fallback once
    if (!isApiLoading && (!apiStock || !apiStock.cars || apiStock.cars.length === 0) && !hasAttemptedFallback) {
      setIsFallbackLoading(true);
      setHasAttemptedFallback(true);
      
      fetch(`${import.meta.env.BASE_URL}full-stock.json`)
        .then(res => {
          if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) {
            return null;
          }
          return res.json();
        })
        .then(data => {
          if (!data) return;
          if (Array.isArray(data)) {
            setFallbackStock({ cars: data.map((c, i) => ({ ...c, id: c.id || c.advertId || `car-${i}` })) });
          } else if (data && data.cars) {
            setFallbackStock(normalizeStock(data));
          }
        })
        .catch(() => undefined)
        .finally(() => {
          setIsFallbackLoading(false);
        });
    }
  }, [apiStock, isApiLoading, hasAttemptedFallback]);

  // Use API stock if valid, otherwise fallback
  const stock = normalizeStock(apiStock) ?? fallbackStock;
  const isLoading = isApiLoading || isFallbackLoading;

  return (
    <StockContext.Provider value={{ stock, isLoading }}>
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
