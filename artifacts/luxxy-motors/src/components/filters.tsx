import { useState, useMemo } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Car } from '@/lib/stock-context';
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
  cars: Car[];
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
    <div className="bg-card border-y shadow-sm">
      <div className="container mx-auto px-4 py-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 mb-6">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary mb-1">Search Stock</p>
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight">Find the right vehicle</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            {vehicleCount} {vehicleCount === 1 ? 'vehicle' : 'vehicles'} publicly available
          </p>
        </div>
        {/* Primary Filters */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground">Make</label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={filters.make}
              onChange={(e) => setFilters(f => ({ ...f, make: e.target.value, model: '' }))}
            >
              <option value="">All</option>
              {makes.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground">Model</label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              value={filters.model}
              onChange={(e) => setFilters(f => ({ ...f, model: e.target.value }))}
              disabled={!filters.make || models.length === 0}
            >
              <option value="">All</option>
              {models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground">Min Price</label>
            <Input
              type="number"
              placeholder="£"
              value={filters.minPrice}
              onChange={(e) => setFilters(f => ({ ...f, minPrice: e.target.value }))}
              className="h-10"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground">Max Price</label>
            <Input
              type="number"
              placeholder="£"
              value={filters.maxPrice}
              onChange={(e) => setFilters(f => ({ ...f, maxPrice: e.target.value }))}
              className="h-10"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground">Fuel</label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={filters.fuel}
              onChange={(e) => setFilters(f => ({ ...f, fuel: e.target.value }))}
            >
              <option value="">All</option>
              {fuels.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground">Transmission</label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={filters.transmission}
              onChange={(e) => setFilters(f => ({ ...f, transmission: e.target.value }))}
            >
              <option value="">All</option>
              {transmissions.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-6">
          <Button
            variant="outline"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full sm:w-auto relative"
          >
            <SlidersHorizontal className="w-4 h-4 mr-2" />
            Advanced Filters
            {activeAdvancedCount > 0 && (
              <span className="absolute -top-2 -right-2 w-5 h-5 bg-primary text-primary-foreground text-xs rounded-full flex items-center justify-center">
                {activeAdvancedCount}
              </span>
            )}
          </Button>

          <div className="flex w-full sm:w-auto gap-4">
            <select
              className="flex h-10 w-full sm:w-48 rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={filters.sort}
              onChange={(e) => setFilters(f => ({ ...f, sort: e.target.value as FilterState['sort'] }))}
            >
              <option value="">Sort: Recommended</option>
              <option value="price-asc">Price: Low to High</option>
              <option value="price-desc">Price: High to Low</option>
              <option value="mileage-asc">Mileage: Low to High</option>
              <option value="mileage-desc">Mileage: High to Low</option>
            </select>
            <Button onClick={handleSearchClick} className="w-full sm:w-auto px-8 font-semibold">
              Search Stock
            </Button>
          </div>
        </div>

        {/* Advanced Filters */}
        {showAdvanced && (
          <div className="mt-6 pt-6 border-t grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in slide-in-from-top-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Keyword Search</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Make, model, plate..."
                  className="pl-9 h-10"
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
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Condition History</label>
              <div className="flex flex-wrap gap-2 pt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="rounded border-input text-primary focus:ring-primary h-4 w-4"
                    checked={filters.noWriteOff}
                    onChange={(e) => setFilters(f => ({ ...f, noWriteOff: e.target.checked }))}
                  />
                  <span className="text-sm font-medium">HPI Clear</span>
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
    </div>
  );
}
