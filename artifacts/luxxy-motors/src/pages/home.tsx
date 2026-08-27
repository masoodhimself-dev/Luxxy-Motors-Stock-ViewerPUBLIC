import { useState, useMemo } from 'react';
import { useStock } from '@/lib/stock-context';
import { UploadView } from '@/components/upload-view';
import { CarCard } from '@/components/car-card';
import { Filters, type FilterState } from '@/components/filters';

export default function Home() {
  const { stock, isLoading } = useStock();
  
  const [filters, setFilters] = useState<FilterState>({
    search: '',
    make: '',
    minPrice: '',
    maxPrice: '',
    catS: false,
    catN: false,
    noWriteOff: false,
    sort: ''
  });

  const filteredCars = useMemo(() => {
    if (!stock) return [];
    
    let result = [...stock.cars];

    // Search
    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(c => 
        (c.title && c.title.toLowerCase().includes(q)) ||
        (c.make && c.make.toLowerCase().includes(q)) ||
        (c.model && c.model.toLowerCase().includes(q)) ||
        (c.plate && c.plate.toLowerCase().includes(q)) ||
        (c.registration && c.registration.toLowerCase().includes(q))
      );
    }

    // Make
    if (filters.make) {
      result = result.filter(c => c.make === filters.make);
    }

    // Price
    if (filters.minPrice) {
      const min = parseFloat(filters.minPrice);
      if (!isNaN(min)) result = result.filter(c => c.price && c.price >= min);
    }
    if (filters.maxPrice) {
      const max = parseFloat(filters.maxPrice);
      if (!isNaN(max)) result = result.filter(c => c.price && c.price <= max);
    }

    // Condition
    if (filters.noWriteOff || filters.catS || filters.catN) {
      result = result.filter(c => {
        const cat = (c.writeOffCategory || '').toUpperCase();
        const isS = cat.includes('S') || cat === 'CAT S';
        const isN = cat.includes('N') || cat === 'CAT N';
        const isClear = !isS && !isN;
        
        if (filters.noWriteOff && isClear) return true;
        if (filters.catS && isS) return true;
        if (filters.catN && isN) return true;
        
        return false;
      });
    }

    // Sort
    if (filters.sort) {
      result.sort((a, b) => {
        switch (filters.sort) {
          case 'price-asc': return (a.price || 0) - (b.price || 0);
          case 'price-desc': return (b.price || 0) - (a.price || 0);
          case 'mileage-asc': return (a.mileage || 0) - (b.mileage || 0);
          case 'mileage-desc': return (b.mileage || 0) - (a.mileage || 0);
          default: return 0;
        }
      });
    }

    return result;
  }, [stock, filters]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="animate-pulse flex flex-col items-center">
          <div className="w-12 h-12 rounded-full bg-primary/20 mb-4"></div>
          <div className="h-4 w-32 bg-muted rounded"></div>
        </div>
      </div>
    );
  }

  if (!stock || stock.cars.length === 0) {
    return <UploadView />;
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Showroom Stock</h1>
          <p className="text-muted-foreground">Showing {filteredCars.length} of {stock.cars.length} vehicles</p>
        </div>
      </div>
      
      <Filters cars={stock.cars} filters={filters} setFilters={setFilters} />

      {filteredCars.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredCars.map(car => (
            <CarCard key={car.id} car={car} />
          ))}
        </div>
      ) : (
        <div className="text-center py-20 bg-card rounded-xl border border-dashed">
          <h3 className="text-xl font-semibold mb-2">No vehicles match your search</h3>
          <p className="text-muted-foreground mb-6">Try adjusting your filters or clearing your search query.</p>
          <button 
            onClick={() => setFilters({ search: '', make: '', minPrice: '', maxPrice: '', catS: false, catN: false, noWriteOff: false, sort: '' })}
            className="text-primary font-medium hover:underline"
          >
            Clear all filters
          </button>
        </div>
      )}
    </div>
  );
}
