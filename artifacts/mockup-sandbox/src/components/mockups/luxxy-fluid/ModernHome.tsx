import { useMemo, useState } from 'react';
import { ChevronDown, Grid2X2, List, Search, SlidersHorizontal, X } from 'lucide-react';
import { ModernCarCard } from './_modern-CarCard';
import { ModernChrome } from './_modern-Chrome';
import { dealerConfig, stock } from './_data';
import './_modern-theme.css';

type Filters = { search: string; make: string; maxPrice: string; sort: string };
const emptyFilters: Filters = { search: '', make: '', maxPrice: '', sort: '' };

export default function ModernHome() {
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [filterOpen, setFilterOpen] = useState(false);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const makes = useMemo(() => Array.from(new Set(stock.cars.map((car) => car.make).filter(Boolean))).sort() as string[], []);
  const filteredCars = useMemo(() => {
    let cars = [...stock.cars];
    const query = filters.search.trim().toLowerCase();
    if (query) cars = cars.filter((car) => [car.title, car.make, car.model, car.registration].some((value) => value?.toLowerCase().includes(query)));
    if (filters.make) cars = cars.filter((car) => car.make === filters.make);
    if (filters.maxPrice) cars = cars.filter((car) => car.price != null && car.price <= Number(filters.maxPrice));
    if (filters.sort === 'price-asc') cars.sort((a, b) => (a.price || 0) - (b.price || 0));
    if (filters.sort === 'price-desc') cars.sort((a, b) => (b.price || 0) - (a.price || 0));
    if (filters.sort === 'mileage') cars.sort((a, b) => (a.mileage || 0) - (b.mileage || 0));
    return cars;
  }, [filters]);
  const update = (key: keyof Filters, value: string) => setFilters((current) => ({ ...current, [key]: value }));

  return (
    <ModernChrome>
      <section className="border-b modern-rule pt-[calc(var(--modern-header-height,4rem)+1.5rem)]">
        <div className="mx-auto max-w-[1320px] px-4 pb-8 sm:px-6 sm:pb-10 lg:px-8">
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div className="max-w-xl">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[.18em] text-[hsl(var(--modern-blue))]">Current stock / {stock.count || stock.cars.length} vehicles</p>
              <h1 className="modern-display text-3xl font-semibold sm:text-5xl">Cars worth<br className="hidden sm:block" /> looking at.</h1>
              <p className="mt-3 max-w-md text-sm leading-6 text-[hsl(var(--modern-muted))]">{dealerConfig.hero.subcopy}</p>
            </div>
            <p className="max-w-[220px] text-sm leading-6 text-[hsl(var(--modern-muted))] md:text-right">Browse the live showroom. Search first, then take your time with the details.</p>
          </div>
        </div>
      </section>

      <section id="inventory" className="mx-auto w-full max-w-[1320px] px-4 py-7 sm:px-6 sm:py-10 lg:px-8">
        <div className="flex flex-col gap-4 border-b modern-rule pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 sm:max-w-xl">
            <Search className="pointer-events-none absolute left-0 top-1/2 h-5 w-5 -translate-y-1/2 text-[hsl(var(--modern-muted))]" />
            <input
              value={filters.search}
              onChange={(event) => update('search', event.target.value)}
              placeholder="Search make, model or registration"
              aria-label="Search stock"
              className="modern-focus h-12 w-full border-b modern-rule bg-transparent pl-8 pr-9 text-sm placeholder:text-[hsl(var(--modern-muted))] focus:border-[hsl(var(--modern-blue))]"
            />
            {filters.search && <button type="button" onClick={() => update('search', '')} aria-label="Clear search" className="modern-focus absolute right-0 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center"><X className="h-4 w-4" /></button>}
          </div>
          <div className="flex items-center justify-between gap-3">
            <button type="button" onClick={() => setFilterOpen((open) => !open)} className="modern-focus flex min-h-11 items-center gap-2 rounded-full border modern-rule px-4 text-sm hover:border-[hsl(var(--modern-ink))]"><SlidersHorizontal className="h-4 w-4" /> Filters <ChevronDown className={`h-4 w-4 transition-transform ${filterOpen ? 'rotate-180' : ''}`} /></button>
            <div className="flex rounded-full bg-[hsl(var(--modern-panel))] p-1" aria-label="Stock view">
              <button type="button" onClick={() => setView('grid')} aria-pressed={view === 'grid'} className={`modern-focus grid h-9 w-9 place-items-center rounded-full ${view === 'grid' ? 'bg-[hsl(var(--modern-ivory))] shadow-sm' : 'text-[hsl(var(--modern-muted))]'}`}><Grid2X2 className="h-4 w-4" /></button>
              <button type="button" onClick={() => setView('list')} aria-pressed={view === 'list'} className={`modern-focus grid h-9 w-9 place-items-center rounded-full ${view === 'list' ? 'bg-[hsl(var(--modern-ivory))] shadow-sm' : 'text-[hsl(var(--modern-muted))]'}`}><List className="h-4 w-4" /></button>
            </div>
          </div>
        </div>

        {filterOpen && (
          <div className="grid grid-cols-1 gap-4 border-b modern-rule bg-[hsl(var(--modern-panel)/.55)] px-4 py-5 sm:grid-cols-3">
            <label className="flex flex-col gap-2 text-xs font-semibold text-[hsl(var(--modern-muted))]">Make
              <select value={filters.make} onChange={(event) => update('make', event.target.value)} className="modern-focus h-11 rounded-md border modern-rule bg-[hsl(var(--modern-ivory))] px-3 text-sm font-normal text-[hsl(var(--modern-ink))]"><option value="">All makes</option>{makes.map((make) => <option key={make}>{make}</option>)}</select>
            </label>
            <label className="flex flex-col gap-2 text-xs font-semibold text-[hsl(var(--modern-muted))]">Maximum price
              <select value={filters.maxPrice} onChange={(event) => update('maxPrice', event.target.value)} className="modern-focus h-11 rounded-md border modern-rule bg-[hsl(var(--modern-ivory))] px-3 text-sm font-normal text-[hsl(var(--modern-ink))]"><option value="">Any price</option>{[10000, 20000, 30000, 50000, 75000].map((price) => <option key={price} value={price}>Up to £{price.toLocaleString()}</option>)}</select>
            </label>
            <label className="flex flex-col gap-2 text-xs font-semibold text-[hsl(var(--modern-muted))]">Sort by
              <select value={filters.sort} onChange={(event) => update('sort', event.target.value)} className="modern-focus h-11 rounded-md border modern-rule bg-[hsl(var(--modern-ivory))] px-3 text-sm font-normal text-[hsl(var(--modern-ink))]"><option value="">Recommended</option><option value="price-asc">Price: low to high</option><option value="price-desc">Price: high to low</option><option value="mileage">Mileage: low to high</option></select>
            </label>
          </div>
        )}

        <div className="flex items-center justify-between py-5">
          <p className="text-sm text-[hsl(var(--modern-muted))]"><strong className="font-semibold text-[hsl(var(--modern-ink))]">{filteredCars.length}</strong> available now</p>
          {Object.values(filters).some(Boolean) && <button type="button" onClick={() => setFilters(emptyFilters)} className="modern-focus min-h-11 rounded-sm px-1 text-xs font-semibold text-[hsl(var(--modern-blue))] hover:underline">Clear filters</button>}
        </div>

        {filteredCars.length > 0 ? (
          <div className={view === 'grid' ? 'grid grid-cols-1 gap-x-6 gap-y-9 sm:grid-cols-2 lg:grid-cols-3' : 'grid grid-cols-1 gap-x-8 gap-y-7 md:grid-cols-2'}>
            {filteredCars.slice(0, 9).map((car) => <ModernCarCard key={car.id} car={car} featured={view === 'list'} />)}
          </div>
        ) : (
          <div className="border-y modern-rule py-20 text-center"><Search className="mx-auto mb-4 h-8 w-8 text-[hsl(var(--modern-muted))]" /><p className="font-semibold">No matching vehicles</p><p className="mt-2 text-sm text-[hsl(var(--modern-muted))]">Try a wider search.</p></div>
        )}
      </section>
    </ModernChrome>
  );
}