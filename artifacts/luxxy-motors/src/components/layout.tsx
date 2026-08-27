import { Link } from 'wouter';
import { Upload, Car as CarIcon, MapPin, Clock } from 'lucide-react';
import { useStock } from '@/lib/stock-context';
import { Button } from '@/components/ui/button';

export function Layout({ children }: { children: React.ReactNode }) {
  const { stock, setStock } = useStock();

  const handleUploadClick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        let newStock;
        if (Array.isArray(parsed)) {
          newStock = { cars: parsed.map((c, i) => ({ ...c, id: c.id || c.advertId || `car-${i}` })) };
        } else if (parsed.cars) {
          newStock = {
            ...parsed,
            cars: parsed.cars.map((c: any, i: number) => ({ ...c, id: c.id || c.advertId || `car-${i}` }))
          };
        }
        if (newStock) setStock(newStock);
      } catch (err) {
        console.error('Failed to update stock', err);
        alert('Invalid JSON file.');
      }
    };
    input.click();
  };

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
              <div className="h-8 w-px bg-border hidden md:block"></div>
              <Button onClick={handleUploadClick} variant="outline" size="sm" className="gap-2">
                <Upload className="w-4 h-4" />
                <span className="hidden sm:inline">Update Stock</span>
              </Button>
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
