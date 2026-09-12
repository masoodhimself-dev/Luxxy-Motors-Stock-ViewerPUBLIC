import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Search, X, SlidersHorizontal, List, Grid2X2 } from 'lucide-react';
import { FluidButton } from './_fluid-Button';
import { FluidCarCard } from './_fluid-CarCard';
import { FluidChrome } from './_fluid-Chrome';
import { MockLink } from './_shared/Link';
import {
  cn,
  dealerConfig,
  stock,
} from './_data';
import './_fluid-theme.css';

type FilterState = {
  make: string;
  model: string;
  minPrice: string;
  maxPrice: string;
  search: string;
  sort: string;
};

const defaultFilters: FilterState = {
  make: '',
  model: '',
  minPrice: '',
  maxPrice: '',
  search: '',
  sort: '',
};

export default function FluidHome() {
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [stockView, setStockView] = useState<'cards' | 'compact'>('cards');

  const filteredCars = useMemo(() => {
    if (!stock) return [];
    let result = [...stock.cars];

    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(c => 
        (c.title && c.title.toLowerCase().includes(q)) ||
        (c.make && c.make.toLowerCase().includes(q)) ||
        (c.model && c.model.toLowerCase().includes(q))
      );
    }
    if (filters.make) result = result.filter(c => c.make === filters.make);
    if (filters.minPrice) {
      const min = parseFloat(filters.minPrice);
      if (!isNaN(min)) result = result.filter(c => c.price && c.price >= min);
    }
    if (filters.maxPrice) {
      const max = parseFloat(filters.maxPrice);
      if (!isNaN(max)) result = result.filter(c => c.price && c.price <= max);
    }
    return result;
  }, [stock, filters]);

  const makes = useMemo(() => Array.from(new Set(stock?.cars.map(c => c.make).filter(Boolean))).sort() as string[], [stock]);
  
  return (
    <FluidChrome>
      {/* Hero Section */}
      <section className="relative pt-[calc(var(--site-header-height,5.5rem)+2rem)] pb-12 sm:pb-24 lg:pb-32 overflow-hidden">
        <div className="absolute inset-0 z-[-1] pointer-events-none bg-gradient-to-b from-secondary/50 to-background" />
        
        <div className="container mx-auto px-4 lg:px-8">
          <div className="max-w-4xl">
            {dealerConfig.hero.announcement && (
              <div className="inline-flex items-center rounded-full bg-accent/10 px-4 py-1.5 text-sm font-semibold text-accent mb-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
                {dealerConfig.hero.announcement}
              </div>
            )}
            <h1 className="text-4xl sm:text-5xl lg:text-7xl font-semibold tracking-tight text-foreground leading-[1.1] mb-6 animate-in fade-in slide-in-from-bottom-6 duration-700 delay-100 fill-mode-both">
              {dealerConfig.hero.copy}
            </h1>
            <p className="text-lg sm:text-xl text-muted-foreground leading-relaxed max-w-2xl mb-10 animate-in fade-in slide-in-from-bottom-6 duration-700 delay-200 fill-mode-both">
              {dealerConfig.hero.subcopy}
            </p>
            <div className="flex flex-col sm:flex-row gap-4 animate-in fade-in slide-in-from-bottom-6 duration-700 delay-300 fill-mode-both">
              <FluidButton size="lg" className="w-full sm:w-auto text-base h-14" onClick={() => document.getElementById('inventory')?.scrollIntoView({ behavior: 'smooth' })}>
                {dealerConfig.hero.primaryCta}
              </FluidButton>
            </div>
          </div>
        </div>
      </section>

      {/* Main Stock Section */}
      <section id="inventory" className="py-12 sm:py-20 bg-background">
        <div className="container mx-auto px-4 lg:px-8">
          
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-8">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight mb-2">Our Collection</h2>
              <p className="text-muted-foreground">Showing {filteredCars.length} vehicles</p>
            </div>
            
            <div className="flex items-center gap-2 bg-secondary/50 p-1 rounded-lg self-start lg:self-auto">
              <button 
                onClick={() => setStockView('cards')}
                className={cn('px-3 py-2 rounded-md flex items-center gap-2 text-sm font-medium transition-all focus-ring', stockView === 'cards' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}
              >
                <Grid2X2 className="w-4 h-4" /> Grid
              </button>
              <button 
                onClick={() => setStockView('compact')}
                className={cn('px-3 py-2 rounded-md flex items-center gap-2 text-sm font-medium transition-all focus-ring', stockView === 'compact' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground')}
              >
                <List className="w-4 h-4" /> List
              </button>
            </div>
          </div>

          {/* Filters Bar */}
          <div className="bg-background rounded-2xl border border-border/60 soft-shadow p-4 sm:p-6 mb-10">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input 
                  type="text" 
                  placeholder="Search vehicles..." 
                  value={filters.search}
                  onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
                  className="w-full h-12 pl-12 pr-10 bg-secondary/30 border border-border/50 rounded-xl text-base focus-ring transition-colors hover:bg-secondary/50"
                />
                {filters.search && (
                  <button onClick={() => setFilters(prev => ({ ...prev, search: '' }))} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground focus-ring rounded-full">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <button 
                onClick={() => setShowAdvanced(!showAdvanced)}
                className={cn("flex items-center gap-2 h-12 px-6 rounded-xl border font-medium transition-all focus-ring whitespace-nowrap", showAdvanced ? "bg-accent/10 border-accent/20 text-accent" : "bg-background border-border/60 hover:bg-secondary/50 text-foreground")}
              >
                <SlidersHorizontal className="w-4 h-4" />
                Filters
              </button>
            </div>

            {showAdvanced && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6 pt-6 border-t border-border/40 animate-in fade-in slide-in-from-top-2 duration-200">
                <label className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-muted-foreground">Make</span>
                  <select 
                    value={filters.make}
                    onChange={(e) => setFilters(prev => ({ ...prev, make: e.target.value }))}
                    className="h-12 px-4 bg-secondary/30 border border-border/50 rounded-xl focus-ring appearance-none"
                  >
                    <option value="">All Makes</option>
                    {makes.map(make => <option key={make} value={make}>{make}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-muted-foreground">Max Price</span>
                  <select 
                    value={filters.maxPrice}
                    onChange={(e) => setFilters(prev => ({ ...prev, maxPrice: e.target.value }))}
                    className="h-12 px-4 bg-secondary/30 border border-border/50 rounded-xl focus-ring appearance-none"
                  >
                    <option value="">Any Price</option>
                    {[20000, 40000, 60000, 80000, 100000].map(price => (
                      <option key={price} value={price}>£{price.toLocaleString()}</option>
                    ))}
                  </select>
                </label>
                <div className="flex items-end">
                  <FluidButton variant="outline" className="w-full h-12 rounded-xl" onClick={() => setFilters(defaultFilters)}>
                    Clear Filters
                  </FluidButton>
                </div>
              </div>
            )}
          </div>

          {/* Results */}
          {filteredCars.length > 0 ? (
            <div className={cn("grid gap-6 lg:gap-8", stockView === 'compact' ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3')}>
              {filteredCars.slice(0, 6).map(car => (
                <FluidCarCard key={car.id} car={car} layout={stockView} />
              ))}
            </div>
          ) : (
            <div className="py-24 text-center rounded-2xl bg-secondary/30 border border-border/50 border-dashed">
              <Search className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No vehicles found</h3>
              <p className="text-muted-foreground mb-6">Try adjusting your filters to see more results.</p>
              <FluidButton onClick={() => setFilters(defaultFilters)}>Clear Filters</FluidButton>
            </div>
          )}
        </div>
      </section>
      
      {/* Testimonials / Why us equivalent */}
      {dealerConfig.whyBuy && dealerConfig.whyBuy.length > 0 && (
        <section className="py-24 bg-secondary/30 border-t border-border/40">
          <div className="container mx-auto px-4 lg:px-8">
            <div className="max-w-2xl mb-16">
              <h2 className="text-3xl font-semibold tracking-tight mb-4">The {dealerConfig.identity.name} Standard</h2>
              <p className="text-lg text-muted-foreground">Every vehicle in our collection meets rigorous standards for quality, history, and presentation.</p>
            </div>
            
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
              {dealerConfig.whyBuy.map((item, idx) => (
                <div key={idx} className="bg-background rounded-2xl p-8 soft-shadow border border-border/50">
                  <h3 className="text-lg font-semibold mb-3">{item.title}</h3>
                  <p className="text-muted-foreground leading-relaxed">{item.description}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </FluidChrome>
  );
}
