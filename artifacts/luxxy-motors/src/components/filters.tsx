import { useState, useMemo } from 'react';
import { Search, X, Car, Banknote, Fuel, Settings2, Filter, AlertTriangle, ChevronDown, Sparkles } from 'lucide-react';
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

  const activeAdvancedCount =
    (filters.catS ? 1 : 0) +
    (filters.catN ? 1 : 0) +
    (filters.noWriteOff ? 1 : 0);

  const handleSearchClick = () => {
    if (onSearch) onSearch();
  };

  return (
    <div className="relative z-20 mx-4 max-w-7xl overflow-hidden rounded-2xl border border-border/50 bg-background shadow-xl lg:mx-auto">
      <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-primary via-accent to-primary" />

      <div className="p-5 sm:p-6 md:p-8">
        <div className="flex flex-col gap-3 mb-6 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2 text-primary">
              <Sparkles className="w-4 h-4" />
              <p className="text-xs font-bold uppercase tracking-[0.18em]">Browse our stock</p>
            </div>
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">Find a car you’ll love</h2>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              Search by make, model, registration or a feature, then refine your shortlist below.
            </p>
          </div>
          <div className="inline-flex w-fit items-center rounded-full border border-border/70 bg-secondary/60 px-3 py-1.5 text-xs font-bold text-muted-foreground">
            {vehicleCount} vehicles in stock
          </div>
        </div>

        {/* Primary search */}
        <div className="mb-7 rounded-2xl border border-primary/10 bg-secondary/50 p-3 sm:p-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-primary" />
              <Input
                aria-label="Search vehicles"
                placeholder="Try “BMW”, “Golf”, “automatic” or a registration"
                className="h-14 border-border/70 bg-background pl-12 pr-12 text-base font-medium shadow-sm focus-visible:ring-primary"
                value={filters.search}
                onChange={(e) => setFilters(f => ({ ...f, search: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSearchClick();
                  }
                }}
              />
              {filters.search && (
                <button
                  type="button"
                  aria-label="Clear vehicle search"
                  onClick={() => setFilters(f => ({ ...f, search: '' }))}
                  className="absolute right-4 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <Button
              type="button"
              onClick={handleSearchClick}
              size="lg"
              className="h-14 w-full shrink-0 px-8 font-bold shadow-md shadow-primary/20 sm:w-auto"
            >
              Find cars
              <Search className="ml-2 h-4 w-4" />
            </Button>
          </div>
          {makes.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 px-1">
              <span className="mr-1 text-xs font-semibold text-muted-foreground">Quick picks</span>
              {makes.slice(0, 5).map((make) => (
                <button
                  key={make}
                  type="button"
                  onClick={() => setFilters(f => ({ ...f, make, model: '' }))}
                  className={`rounded-full border px-3 py-1 text-xs font-bold transition-colors ${
                    filters.make === make
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border/70 bg-background text-foreground hover:border-primary/40 hover:text-primary'
                  }`}
                >
                  {make}
                </button>
              ))}
            </div>
          )}
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
            className="relative h-11 w-full rounded-lg border-border/80 font-semibold hover:bg-secondary md:w-auto"
          >
            <Filter className="w-4 h-4 mr-2" />
            More filters
            {activeAdvancedCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-accent text-accent-foreground font-bold text-[10px] rounded-full flex items-center justify-center shadow-sm">
                {activeAdvancedCount}
              </span>
            )}
            <ChevronDown className={`ml-2 h-4 w-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
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
                type="button"
                onClick={handleSearchClick}
                variant="outline"
                size="lg"
                className="h-11 w-full px-6 font-bold sm:w-auto"
              >
                Show results
              </Button>
          </div>
        </div>

        {/* Advanced Filters */}
        {showAdvanced && (
          <div className="mt-6 border-t border-border/50 pt-6 animate-in fade-in slide-in-from-top-4 duration-300">
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
