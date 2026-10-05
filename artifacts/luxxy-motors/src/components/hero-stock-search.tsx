import { useEffect, useId, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { Link } from 'wouter';
import { Search, ChevronDown, RotateCcw, ArrowRight } from 'lucide-react';
import type { Car } from '@/lib/stock-context';
import type { FilterState } from '@/components/filters';
import { formatPrice } from '@/lib/utils';

export function HeroStockSearch({ cars, filters, setFilters, onSearch, onReset, count, buttonLabel }: {
  buttonLabel?: string; cars: Car[]; filters: FilterState; setFilters: Dispatch<SetStateAction<FilterState>>;
  onSearch: () => void; onReset: () => void; count: number;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const advancedId = useId();
  const [mobile, setMobile] = useState(() => window.matchMedia?.('(max-width: 639px)').matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 639px)');
    if (!media) return;
    const update = () => setMobile(media.matches);
    update(); media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  const options = (key: 'make' | 'model' | 'fuel' | 'transmission') => Array.from(new Set(cars.filter(car => key !== 'model' || !filters.make || car.make === filters.make).map(car => car[key]).filter((value): value is string => Boolean(value)))).sort();
  const hasFilters = Object.entries(filters).some(([key, value]) => key !== 'sort' && Boolean(value));
  const budgets = [1000, 2500, 5000, 7500, 10000, 12500, 15000, 20000, 25000, 30000, 40000, 50000, 75000, 100000, 150000, 250000, 500000];
  const update = (key: keyof FilterState, value: string) => setFilters(current => ({ ...current, [key]: value, ...(key === 'make' ? { model: '' } : {}), ...(key === 'minPrice' && value && current.maxPrice && +value > +current.maxPrice ? { maxPrice: '' } : {}), ...(key === 'maxPrice' && value && current.minPrice && +value < +current.minPrice ? { minPrice: '' } : {}) }));
  const select = (key: 'make' | 'model' | 'fuel' | 'transmission', label: string) => (
    <label className="hero-search-field">
      <span className="hero-search-label">{label}</span>
      <select aria-label={`Search ${label.toLowerCase()}`} value={filters[key]} onChange={event => update(key, event.target.value)} disabled={key === 'model' && !filters.make}>
        <option value="">{key === 'model' && !filters.make ? 'Pick a make' : key === 'transmission' ? 'Any' : `Any ${label.toLowerCase()}`}</option>
        {options(key).map(value => <option key={value} value={value}>{value}</option>)}
      </select>
      <ChevronDown aria-hidden="true" />
    </label>
  );
  const budget = (key: 'minPrice' | 'maxPrice') => (
    <label key={key} className="hero-search-field">
      <span className="hero-search-label">{key === 'minPrice' ? 'Minimum price' : 'Maximum price'}</span>
      <select aria-label={key === 'minPrice' ? 'Search minimum price' : 'Search maximum price'} value={filters[key]} onChange={event => update(key, event.target.value)}>
        <option value="">No limit</option>
        {Array.from(new Set([...budgets, ...(filters[key] ? [+filters[key]] : [])])).sort((a,b) => a-b).map(price => <option key={price} value={price}>{formatPrice(price)}</option>)}
      </select>
      <ChevronDown aria-hidden="true" />
    </label>
  );
  return <form className="hero-stock-search" aria-label="Search used cars" onSubmit={event => { event.preventDefault(); onSearch(); }}>
    <div className="hero-search-primary-fields">
      {select('make', 'Make')}{mobile ? budget('maxPrice') : select('model', 'Model')}
      {!mobile && <fieldset className="hero-search-budget"><legend className="sr-only">Vehicle price</legend><div className="hero-search-field-grid">{budget('minPrice')}{budget('maxPrice')}</div></fieldset>}
    </div>
    <button type="submit" className="hero-search-submit"><Search aria-hidden="true" className="h-4 w-4" />{buttonLabel ? `${buttonLabel} (${count})` : `Search ${count} used ${count === 1 ? 'car' : 'cars'}`}</button>
    <div className="hero-search-secondary">
      <button type="button" aria-expanded={advancedOpen} aria-controls={advancedId} onClick={() => setAdvancedOpen(open => !open)}>More filters<ChevronDown aria-hidden="true" size={15} className={advancedOpen ? 'rotate-180' : ''} /></button>
      {hasFilters && <button type="button" onClick={onReset}><RotateCcw aria-hidden="true" size={15} />Reset</button>}
      <Link href="/stock?all=1">See all cars<ArrowRight aria-hidden="true" size={15} /></Link>
    </div>
    <div id={advancedId} hidden={!advancedOpen} className="hero-search-expanded">
      <div className="hero-search-field-grid">
        {mobile && <>{select('model', 'Model')}{budget('minPrice')}</>}
        {select('fuel', 'Fuel')}{select('transmission', 'Transmission')}
      </div>
    </div>
  </form>;
}
