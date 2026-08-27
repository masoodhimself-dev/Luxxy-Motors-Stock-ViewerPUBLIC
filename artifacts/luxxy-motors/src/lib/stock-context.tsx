import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

export type CarImage = { url: string; caption?: string } | string;

export interface Car {
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
  dealerName?: string;
  dealerLocation?: string;
  count?: number;
  scrapedAt?: string;
  cars: Car[];
}

interface StockContextType {
  stock: StockData | null;
  setStock: (data: StockData | null) => void;
  isLoading: boolean;
}

const StockContext = createContext<StockContextType | undefined>(undefined);

export function StockProvider({ children }: { children: ReactNode }) {
  const [stock, setStockState] = useState<StockData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('luxxy_stock');
      if (stored) {
        setStockState(JSON.parse(stored));
      }
    } catch (err) {
      console.error('Failed to parse stock from localStorage', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const setStock = (data: StockData | null) => {
    setStockState(data);
    if (data) {
      localStorage.setItem('luxxy_stock', JSON.stringify(data));
    } else {
      localStorage.removeItem('luxxy_stock');
    }
  };

  return (
    <StockContext.Provider value={{ stock, setStock, isLoading }}>
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
