import { useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { Link } from 'wouter';
import { Search, ChevronDown, RotateCcw, ArrowRight } from 'lucide-react';
import type { Car } from '@/lib/stock-context';
import type { FilterState } from '@/components/filters';
import { formatPrice } from '@/lib/utils';

export function HeroStockSearch({ cars, filters, setFilters, onSearch, onReset, count }: {
  cars: Car[]; filters: FilterState; setFilters: Dispatch<SetStateAction<FilterState>>;
  onSearch: () => void; onReset: () => void; count: number;
}) {
  const [mobile, setMobile] = useState(() => window.matchMedia?.('(max-width: 639px)').matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 639px)');
    if (!media) return;
    const update = () => setMobile(media.matches);
    update(); media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  const options = (key: 'make' | 'model' | 'fuel' | 'transmission') => Array.from(new Set(cars.filter(car => key !== 'model' || !filters.make || car.make === filters.make).map(car => car[key]).filter((value): value is string => Boolean(value)))).sort();
  const budgets = [1000, 2500, 5000, 7500, 10000, 12500, 15000, 20000, 25000, 30000, 40000, 50000, 75000, 100000, 150000, 250000, 500000];
  const update = (key: keyof FilterState, value: string) => setFilters(current => ({ ...current, [key]: value, ...(key === 'make' ? { model: '' } : {}), ...(key === 'minPrice' && value && current.maxPrice && +value > +current.maxPrice ? { maxPrice: '' } : {}), ...(key === 'maxPrice' && value && current.minPrice && +value < +current.minPrice ? { minPrice: '' } : {}) }));
  const select = (key: 'make' | 'model' | 'fuel' | 'transmission', label: string) => <label className="hero-search-field"><span className="sr-only">Search {label.toLowerCase()}</span><select aria-label={`Search ${label.toLowerCase()}`} value={filters[key]} onChange={event => update(key, event.target.value)} disabled={key === 'model' && !filters.make}><option value="">{key === 'model' && !filters.make ? 'Choose make first' : `Any ${label.toLowerCase()}`}</option>{options(key).map(value => <option key={value} value={value}>{value}</option>)}</select><ChevronDown aria-hidden="true" /></label>;
  const budget = (key: 'minPrice' | 'maxPrice') => <label key={key} className="hero-search-field"><span className="sr-only">{key === 'minPrice' ? 'Search minimum price' : 'Search maximum price'}</span><select aria-label={key === 'minPrice' ? 'Search minimum price' : 'Search maximum price'} value={filters[key]} onChange={event => update(key, event.target.value)}><option value="">{key === 'minPrice' ? 'Minimum price' : 'Maximum price'}</option>{Array.from(new Set([...budgets, ...(filters[key] ? [+filters[key]] : [])])).sort((a,b) => a-b).map(price => <option key={price} value={price}>{formatPrice(price)}</option>)}</select><ChevronDown aria-hidden="true" /></label>;
  return <form className="hero-stock-search" aria-label="Search used cars" onSubmit={event => { event.preventDefault(); onSearch(); }}>
    {select('make', 'Make')}{!mobile && select('model', 'Model')}
    {mobile ? budget('maxPrice') : <fieldset><legend className="mb-2 text-xs text-white/80">Vehicle price</legend><div className="grid grid-cols-2 gap-3">{budget('minPrice')}{budget('maxPrice')}</div></fieldset>}
    <button type="submit" className="hero-search-submit"><Search aria-hidden="true" className="h-4 w-4" />Search {count} used {count === 1 ? 'car' : 'cars'}</button>
    <div className="hero-search-secondary">
      <button type="button" onClick={onReset}><RotateCcw aria-hidden="true" size={15} />Reset</button>
      <Link href="/stock?all=1">See all cars<ArrowRight aria-hidden="true" size={15} /></Link>
    </div>
    <details className="hero-search-advanced"><summary>More filters</summary><div className="mt-3 grid gap-3">{mobile && <>{select('model', 'Model')}{budget('minPrice')}</>}{select('fuel', 'Fuel')}{select('transmission', 'Transmission')}</div></details>
  </form>;
}
