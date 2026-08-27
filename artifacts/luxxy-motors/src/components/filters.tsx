import { useState, useMemo } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Car } from '@/lib/stock-context';
import { Badge } from '@/components/ui/badge';

export interface FilterState {
  search: string;
  make: string;
  minPrice: string;
  maxPrice: string;
  catS: boolean;
  catN: boolean;
  noWriteOff: boolean;
  sort: 'price-asc' | 'price-desc' | 'mileage-asc' | 'mileage-desc' | '';
}

interface FiltersProps {
  cars: Car[];
  filters: FilterState;
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
}

export function Filters({ cars, filters, setFilters }: FiltersProps) {
  const [isOpen, setIsOpen] = useState(false);

  const makes = useMemo(() => {
    const m = new Set<string>();
    cars.forEach(c => { if (c.make) m.add(c.make); });
    return Array.from(m).sort();
  }, [cars]);

  const activeFilterCount = (filters.make ? 1 : 0) + 
    (filters.minPrice ? 1 : 0) + 
    (filters.maxPrice ? 1 : 0) + 
    (filters.catS ? 1 : 0) + 
    (filters.catN ? 1 : 0) + 
    (filters.noWriteOff ? 1 : 0);

  const resetFilters = () => {
    setFilters(prev => ({
      ...prev,
      make: '', minPrice: '', maxPrice: '', catS: false, catN: false, noWriteOff: false
    }));
  };

  return (
    <div className="bg-card border rounded-xl shadow-sm mb-6">
      <div className="p-4 flex flex-col sm:flex-row gap-4 items-center">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            placeholder="Search make, model, plate, or keyword..." 
            className="pl-9 bg-muted/50 border-transparent focus-visible:bg-background"
            value={filters.search}
            onChange={(e) => setFilters(f => ({ ...f, search: e.target.value }))}
          />
          {filters.search && (
            <button 
              onClick={() => setFilters(f => ({ ...f, search: '' }))}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        
        <div className="flex gap-2 w-full sm:w-auto">
          <select
            className="flex h-10 w-full sm:w-48 rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            value={filters.sort}
            onChange={(e) => setFilters(f => ({ ...f, sort: e.target.value as FilterState['sort'] }))}
          >
            <option value="">Sort by: Default</option>
            <option value="price-asc">Price: Low to High</option>
            <option value="price-desc">Price: High to Low</option>
            <option value="mileage-asc">Mileage: Low to High</option>
            <option value="mileage-desc">Mileage: High to Low</option>
          </select>
          
          <Button 
            variant={isOpen ? 'secondary' : 'outline'} 
            onClick={() => setIsOpen(!isOpen)}
            className="relative"
          >
            <SlidersHorizontal className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Filters</span>
            {activeFilterCount > 0 && (
              <span className="absolute -top-2 -right-2 w-5 h-5 bg-primary text-primary-foreground text-xs rounded-full flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </Button>
        </div>
      </div>

      {isOpen && (
        <div className="p-4 border-t bg-muted/30 grid grid-cols-1 md:grid-cols-3 gap-6 animate-in fade-in slide-in-from-top-2">
          {/* Make Filter */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Make</label>
            <select
              className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              value={filters.make}
              onChange={(e) => setFilters(f => ({ ...f, make: e.target.value }))}
            >
              <option value="">All Makes</option>
              {makes.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          {/* Price Range */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Price Range (£)</label>
            <div className="flex items-center gap-2">
              <Input 
                type="number" 
                placeholder="Min" 
                value={filters.minPrice}
                onChange={(e) => setFilters(f => ({ ...f, minPrice: e.target.value }))}
              />
              <span className="text-muted-foreground">-</span>
              <Input 
                type="number" 
                placeholder="Max" 
                value={filters.maxPrice}
                onChange={(e) => setFilters(f => ({ ...f, maxPrice: e.target.value }))}
              />
            </div>
          </div>

          {/* Condition / Write-off */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Condition History</label>
              {activeFilterCount > 0 && (
                <button onClick={resetFilters} className="text-xs text-primary hover:underline">Clear all</button>
              )}
            </div>
            <div className="flex flex-wrap gap-2 pt-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input 
                  type="checkbox" 
                  className="rounded border-input text-primary focus:ring-primary h-4 w-4"
                  checked={filters.noWriteOff}
                  onChange={(e) => setFilters(f => ({ ...f, noWriteOff: e.target.checked }))}
                />
                <span className="text-sm">HPI Clear / No Cat</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer ml-4">
                <input 
                  type="checkbox" 
                  className="rounded border-input text-primary focus:ring-primary h-4 w-4"
                  checked={filters.catS}
                  onChange={(e) => setFilters(f => ({ ...f, catS: e.target.checked }))}
                />
                <Badge variant="destructive">Cat S</Badge>
              </label>
              <label className="flex items-center gap-2 cursor-pointer ml-4">
                <input 
                  type="checkbox" 
                  className="rounded border-input text-primary focus:ring-primary h-4 w-4"
                  checked={filters.catN}
                  onChange={(e) => setFilters(f => ({ ...f, catN: e.target.checked }))}
                />
                <Badge variant="warning">Cat N</Badge>
              </label>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
