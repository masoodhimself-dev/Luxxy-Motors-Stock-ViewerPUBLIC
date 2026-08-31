import { useState, useMemo } from 'react';
import { Search, SlidersHorizontal, X, Car, Banknote, Fuel, Settings2, Filter, AlertTriangle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Car as CarType } from '@/lib/stock-context';
import { Badge } from '@/components/ui/badge';

export interface FilterState {
  make: string;
  model: string;
  minPrice: string;
  maxPrice: string;
  fuel: string;
  transmission: string;
  search: string;
  catS: boolean;
  catN: boolean;
  noWriteOff: boolean;
  sort: 'price-asc' | 'price-desc' | 'mileage-asc' | 'mileage-desc' | '';
}

interface FiltersProps {
  cars: CarType[];
  filters: FilterState;
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
  onSearch?: () => void;
  vehicleCount: number;
}

export function Filters({ cars, filters, setFilters, onSearch, vehicleCount }: FiltersProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const makes = useMemo(() => {
    const m = new Set<string>();
    cars.forEach(c => { if (c.make) m.add(c.make); });
    return Array.from(m).sort();
  }, [cars]);

  const models = useMemo(() => {
    const m = new Set<string>();
    cars.forEach(c => {
      if (c.model && (!filters.make || c.make === filters.make)) {
        m.add(c.model);
      }
    });
    return Array.from(m).sort();
  }, [cars, filters.make]);

  const fuels = useMemo(() => {
    const f = new Set<string>();
    cars.forEach(c => { if (c.fuel) f.add(c.fuel); });
    return Array.from(f).sort();
  }, [cars]);

  const transmissions = useMemo(() => {
    const t = new Set<string>();
    cars.forEach(c => { if (c.transmission) t.add(c.transmission); });
    return Array.from(t).sort();
  }, [cars]);

  const activeAdvancedCount = (filters.search ? 1 : 0) +
    (filters.catS ? 1 : 0) +
    (filters.catN ? 1 : 0) +
    (filters.noWriteOff ? 1 : 0);

  const handleSearchClick = () => {
    if (onSearch) onSearch();
  };

  return (
    <div className="bg-background relative -mt-10 mx-4 lg:mx-auto max-w-7xl rounded-2xl shadow-xl border border-border/50 z-20 overflow-hidden">
      <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-primary via-accent to-primary" />

      <div className="p-6 md:p-8">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-2 mb-2 text-primary">
              <Search className="w-5 h-5" />
              <p className="text-sm font-bold uppercase tracking-widest">Find Your Next Car</p>
            </div>
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">Search our stock of {vehicleCount} vehicles</h2>
          </div>
        </div>

        {/* Primary Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-5 mb-6">
          <div className="space-y-2">
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Car className="w-3.5 h-3.5" /> Make
            </label>
            <select
              className="flex h-11 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm font-medium shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary hover:border-primary/50"
              value={filters.make}
              onChange={(e) => setFilters(f => ({ ...f, make: e.target.value, model: '' }))}
            >
              <option value="">Any Make</option>
              {makes.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Car className="w-3.5 h-3.5" /> Model
            </label>
            <select
              className="flex h-11 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm font-medium shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 disabled:cursor-not-allowed hover:border-primary/50"
              value={filters.model}
              onChange={(e) => setFilters(f => ({ ...f, model: e.target.value }))}
              disabled={!filters.make || models.length === 0}
            >
              <option value="">Any Model</option>
              {models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Banknote className="w-3.5 h-3.5" /> Min Price
            </label>
            <Input
              type="number"
              placeholder="£ Min"
              value={filters.minPrice}
              onChange={(e) => setFilters(f => ({ ...f, minPrice: e.target.value }))}
              className="h-11 font-medium bg-card"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Banknote className="w-3.5 h-3.5" /> Max Price
            </label>
            <Input
              type="number"
              placeholder="£ Max"
              value={filters.maxPrice}
              onChange={(e) => setFilters(f => ({ ...f, maxPrice: e.target.value }))}
              className="h-11 font-medium bg-card"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Fuel className="w-3.5 h-3.5" /> Fuel
            </label>
            <select
              className="flex h-11 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm font-medium shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary hover:border-primary/50"
              value={filters.fuel}
              onChange={(e) => setFilters(f => ({ ...f, fuel: e.target.value }))}
            >
              <option value="">Any Fuel</option>
              {fuels.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Settings2 className="w-3.5 h-3.5" /> Transmission
            </label>
            <select
              className="flex h-11 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm font-medium shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary hover:border-primary/50"
              value={filters.transmission}
              onChange={(e) => setFilters(f => ({ ...f, transmission: e.target.value }))}
            >
              <option value="">Any Transmission</option>
              {transmissions.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 pt-4 border-t border-border/50">
          <Button
            variant="outline"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full md:w-auto relative font-semibold rounded-lg h-11 border-border/80 hover:bg-secondary"
          >
            <Filter className="w-4 h-4 mr-2" />
            Advanced Filters
            {activeAdvancedCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-accent text-accent-foreground font-bold text-[10px] rounded-full flex items-center justify-center shadow-sm">
                {activeAdvancedCount}
              </span>
            )}
          </Button>

          <div className="flex flex-col sm:flex-row w-full md:w-auto gap-3">
            <select
              className="flex h-11 w-full sm:w-56 rounded-lg border border-input bg-card px-3 py-2 text-sm font-medium shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              value={filters.sort}
              onChange={(e) => setFilters(f => ({ ...f, sort: e.target.value as FilterState['sort'] }))}
            >
              <option value="">Sort: Recommended</option>
              <option value="price-asc">Price: Low to High</option>
              <option value="price-desc">Price: High to Low</option>
              <option value="mileage-asc">Mileage: Low to High</option>
              <option value="mileage-desc">Mileage: High to Low</option>
            </select>
            <Button
              onClick={handleSearchClick}
              size="lg"
              className="w-full sm:w-auto px-8 font-bold h-11 shadow-md shadow-primary/20"
            >
              Search Stock
            </Button>
          </div>
        </div>

        {/* Advanced Filters */}
        {showAdvanced && (
          <div className="mt-6 pt-6 border-t border-border/50 grid grid-cols-1 md:grid-cols-2 gap-8 animate-in fade-in slide-in-from-top-4 duration-300">
            <div className="space-y-3">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Search className="w-3.5 h-3.5" /> Keyword Search
              </label>
              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="e.g. Navigation, Leather, M Sport..."
                  className="pl-10 h-11 font-medium bg-card"
                  value={filters.search}
                  onChange={(e) => setFilters(f => ({ ...f, search: e.target.value }))}
                />
                {filters.search && (
                  <button
                    onClick={() => setFilters(f => ({ ...f, search: '' }))}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> Condition History
              </label>
              <div className="flex flex-wrap gap-4 pt-1 bg-secondary/30 p-3 rounded-lg border border-border/50">
                <label className="flex items-center gap-2.5 cursor-pointer group">
                  <div className="relative flex items-center justify-center">
                    <input
                      type="checkbox"
                      className="peer appearance-none w-5 h-5 border-2 border-muted-foreground/30 rounded focus:ring-2 focus:ring-primary focus:ring-offset-2 checked:bg-primary checked:border-primary transition-all"
                      checked={filters.noWriteOff}
                      onChange={(e) => setFilters(f => ({ ...f, noWriteOff: e.target.checked }))}
                    />
                    <div className="absolute text-primary-foreground pointer-events-none opacity-0 peer-checked:opacity-100">
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                  </div>
                  <span className="text-sm font-semibold group-hover:text-primary transition-colors">HPI Clear</span>
                </label>

                <div className="w-px h-5 bg-border mx-1 hidden sm:block"></div>

                <label className="flex items-center gap-2.5 cursor-pointer group">
                  <div className="relative flex items-center justify-center">
                    <input
                      type="checkbox"
                      className="peer appearance-none w-5 h-5 border-2 border-muted-foreground/30 rounded focus:ring-2 focus:ring-destructive focus:ring-offset-2 checked:bg-destructive checked:border-destructive transition-all"
                      checked={filters.catS}
                      onChange={(e) => setFilters(f => ({ ...f, catS: e.target.checked }))}
                    />
                    <div className="absolute text-destructive-foreground pointer-events-none opacity-0 peer-checked:opacity-100">
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                  </div>
                  <Badge variant="destructive" className="font-bold tracking-wider rounded-md">CAT S</Badge>
                </label>

                <label className="flex items-center gap-2.5 cursor-pointer group">
                  <div className="relative flex items-center justify-center">
                    <input
                      type="checkbox"
                      className="peer appearance-none w-5 h-5 border-2 border-muted-foreground/30 rounded focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 checked:bg-amber-500 checked:border-amber-500 transition-all"
                      checked={filters.catN}
                      onChange={(e) => setFilters(f => ({ ...f, catN: e.target.checked }))}
                    />
                    <div className="absolute text-black pointer-events-none opacity-0 peer-checked:opacity-100">
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M10 3L4.5 8.5L2 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                  </div>
                  <Badge variant="warning" className="font-bold tracking-wider rounded-md bg-amber-500 text-black border-transparent">CAT N</Badge>
                </label>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
