import { Link } from 'wouter';
import { Car as CarIcon, MapPin, Clock } from 'lucide-react';
import { useStock } from '@/lib/stock-context';

export function Layout({ children }: { children: React.ReactNode }) {
  const { stock } = useStock();

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background font-sans text-foreground">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground group-hover:scale-105 transition-transform">
              <CarIcon className="w-5 h-5" />
            </div>
            <span className="font-bold text-xl tracking-tight hidden sm:inline-block">Luxxy Motors</span>
          </Link>
          
          {stock && (
            <div className="flex items-center gap-4">
              <div className="hidden md:flex flex-col items-end text-xs text-muted-foreground">
                <span className="font-semibold text-foreground flex items-center gap-1">
                  {stock.dealerName || 'Independent Dealer'}
                  {stock.dealerLocation && <><MapPin className="w-3 h-3 ml-1" />{stock.dealerLocation}</>}
                </span>
                {stock.scrapedAt && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Updated {new Date(stock.scrapedAt).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1">
        {children}
      </main>
      
      <footer className="border-t bg-card py-8 mt-auto">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>© {new Date().getFullYear()} Luxxy Motors. Harrow, London.</p>
        </div>
      </footer>
    </div>
  );
}
