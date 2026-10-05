import { parseStockSearch } from '@/lib/natural-stock-search';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { arrivalTime } from '@/lib/stock-presentation';
import { useEffect, useMemo, useState, useRef } from 'react';
import {
  ChevronDown,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Car as CarType } from '@/lib/stock-context';

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
  sort: 'price-asc' | 'price-desc' | 'mileage-asc' | 'mileage-desc' | 'year-desc' | 'arrival-desc' | '';
}

interface FiltersProps {
  cars: CarType[];
  filters: FilterState;
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
  onSearch?: () => void;
  vehicleCount: number;
  matchCount?: number;
  quickFilters?: React.ReactNode;
}

const emptyFilters: FilterState = {
  make: '',
  model: '',
  minPrice: '',
  maxPrice: '',
  fuel: '',
  transmission: '',
  search: '',
  catS: false,
  catN: false,
  noWriteOff: false,
  sort: '',
};

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block min-w-0">
       <span className="stock-filter-label mb-2 block text-sm font-medium text-primary/70">
        {label}
      </span>
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  children,
  disabled = false,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <span className="relative block">
      <NativeSelect
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        aria-label={ariaLabel}
        className="stock-filter-select h-12 w-full appearance-none rounded-md border border-input bg-card pl-3 pr-8 text-base font-normal tracking-normal text-primary shadow-none transition-colors focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20"
      >
        {children}
      </NativeSelect>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary/50" />
    </span>
  );
}

export function Filters({ cars, filters, setFilters, onSearch, vehicleCount, matchCount, quickFilters }: FiltersProps) {
  const filterButton = useRef<HTMLButtonElement>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [dialogBrandStyle, setDialogBrandStyle] = useState<React.CSSProperties>();
  const [budgetNotice, setBudgetNotice] = useState('');
  const toggleFilters = () => {
    if (!showAdvanced && filterButton.current) {
      // The Stock dialog is portalled outside the dealer's branded page shell.
      const style = window.getComputedStyle(filterButton.current);
      setDialogBrandStyle({
        '--premium-accent': style.getPropertyValue('--premium-accent').trim() || '#215a7e',
        '--premium-accent-foreground': style.getPropertyValue('--premium-accent-foreground').trim() || '#fff',
        '--premium-panel': style.getPropertyValue('--premium-panel').trim() || '#fff',
        '--premium-ink': style.getPropertyValue('--premium-ink').trim() || '#192a36',
      } as React.CSSProperties);
    }
    setShowAdvanced(!showAdvanced);
  };
  useEffect(() => {
    // Older saved browsing sessions may contain an impossible range.
    if (filters.minPrice && filters.maxPrice && Number(filters.minPrice) > Number(filters.maxPrice)) {
      setFilters((current) => ({ ...current, minPrice: '' }));
      setBudgetNotice('Minimum budget cleared because it exceeded your maximum budget.');
    }
  }, [filters.minPrice, filters.maxPrice, setFilters]);
  const changeBudget = (key: 'minPrice' | 'maxPrice', value: string) => {
    const other = key === 'minPrice' ? 'maxPrice' : 'minPrice';
    const conflict = value && filters[other] && (key === 'minPrice' ? Number(value) > Number(filters.maxPrice) : Number(value) < Number(filters.minPrice));
    setFilters((current) => ({ ...current, [key]: value, ...(conflict ? { [other]: '' } : {}) }));
    setBudgetNotice(conflict ? `${key === 'minPrice' ? 'Maximum' : 'Minimum'} budget cleared to keep your selected price range valid.` : '');
  };
  const appliedFilters: Array<{ key: keyof FilterState; label: string }> = [
    ...(filters.search ? [{ key: 'search' as const, label: filters.search }] : []),
    ...(filters.make ? [{ key: 'make' as const, label: filters.make }] : []),
    ...(filters.model ? [{ key: 'model' as const, label: filters.model }] : []),
    ...(filters.minPrice ? [{ key: 'minPrice' as const, label: `From £${Number(filters.minPrice).toLocaleString('en-GB')}` }] : []),
    ...(filters.maxPrice ? [{ key: 'maxPrice' as const, label: `Up to £${Number(filters.maxPrice).toLocaleString('en-GB')}` }] : []),
    ...(filters.fuel ? [{ key: 'fuel' as const, label: filters.fuel }] : []),
    ...(filters.transmission ? [{ key: 'transmission' as const, label: filters.transmission }] : []),
    ...(['catS', 'catN', 'noWriteOff'] as const).filter((key) => filters[key]).map((key) => ({ key, label: key === 'catS' ? 'Category S' : key === 'catN' ? 'Category N' : 'No recorded write-off' })),
  ];

  const makes = useMemo(() => {
    const makeSet = new Set<string>();
    cars.forEach((car) => {
      if (car.make) makeSet.add(car.make);
    });
    return Array.from(makeSet).sort();
  }, [cars]);

  const models = useMemo(() => {
    const modelSet = new Set<string>();
    cars.forEach((car) => {
      if (car.model && (!filters.make || car.make === filters.make)) {
        modelSet.add(car.model);
      }
    });
    return Array.from(modelSet).sort();
  }, [cars, filters.make]);

  const fuels = useMemo(() => {
    const fuelSet = new Set<string>();
    cars.forEach((car) => {
      if (car.fuel) fuelSet.add(car.fuel);
    });
    return Array.from(fuelSet).sort();
  }, [cars]);

  const transmissions = useMemo(() => {
    const transmissionSet = new Set<string>();
    cars.forEach((car) => {
      if (car.transmission) transmissionSet.add(car.transmission);
    });
    return Array.from(transmissionSet).sort();
  }, [cars]);

  const activeFilterCount =
    Number(Boolean(filters.search)) +
    Number(Boolean(filters.make)) +
    Number(Boolean(filters.model)) +
    Number(Boolean(filters.minPrice || filters.maxPrice)) +
    Number(Boolean(filters.fuel)) +
    Number(Boolean(filters.transmission)) +
    Number(filters.noWriteOff) +
    Number(filters.catS) +
    Number(filters.catN);

  const maxBudgets = Array.from(new Set([5000, 10000, 15000, 20000, 30000, 40000, 50000, 75000, 100000, ...(filters.maxPrice && Number.isFinite(Number(filters.maxPrice)) ? [Number(filters.maxPrice)] : [])])).sort((a, b) => a - b);

  const handleSearchClick = () => {
    setFilters(current => {const parsed = parseStockSearch(current.search, cars); return {...current, ...(parsed.make && parsed.make !== current.make ? {model:''} : {}), ...parsed};});
    onSearch?.();
  };

  const resetFilters = () => {
    setFilters(emptyFilters);
    setBudgetNotice('');
  };

  return (
    <div className="stock-toolbar border-y border-border bg-background py-3" data-testid="stock-search-toolbar">
      <div className="stock-search-row">
        <label className="stock-search-input relative block min-w-0">
          <span className="sr-only">Find your next car</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search the showroom"
            data-testid="input-showroom-search"
            placeholder="Make or model"
            value={filters.search}
            onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleSearchClick();
              }
            }}
            className="h-11 border-input bg-card pl-10 pr-11 text-base shadow-none"
          />
          {filters.search && (
            <button
              type="button"
              className="absolute right-0 top-0 grid h-11 w-11 place-items-center text-muted-foreground hover:text-primary"
              onClick={() => setFilters((current) => ({ ...current, search: '' }))}
            >
              <X aria-hidden="true" className="h-4 w-4" />
              <span className="sr-only">Clear search</span>
            </button>
          )}
        </label>
        <button type="button" className="stock-search-submit" onClick={handleSearchClick}>Search</button>
        <button
          type="button"
          className="stock-filter-trigger flex min-h-11 items-center justify-center gap-2 rounded-md border border-input bg-card px-3 text-sm font-medium hover:bg-secondary"
          onClick={toggleFilters}
          aria-expanded={showAdvanced}
          ref={filterButton}
          aria-label="Advanced search"
          aria-controls="advanced-stock-filters"
        >
          <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
          Filters{activeFilterCount > 0 && <span className="tabular-nums"> ({activeFilterCount})</span>}
        </button>
        <NativeSelect
          aria-label="Sort results"
          value={filters.sort}
          onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value as FilterState['sort'] }))}
          className="stock-sort h-11 min-w-0 w-full border-input bg-card pl-3 pr-6 text-base shadow-none"
        >
          <option value="">Stock order</option>
          {cars.some(car => arrivalTime(car) !== null) && <option value="arrival-desc">Recently added</option>}
          <option value="year-desc">Newest registration year</option>
          <option value="price-asc">Price: low to high</option>
          <option value="price-desc">Price: high to low</option>
          <option value="mileage-asc">Lowest mileage</option>
          <option value="mileage-desc">Highest mileage</option>
        </NativeSelect>
      </div>
      <div className="stock-basic-filters">
        <div className="min-w-0">
          <span className="stock-filter-label">Make</span>
          <Select ariaLabel="Quick filter by make" value={filters.make} onChange={make => setFilters(current => ({ ...current, make, model: '' }))}>
            <option value="">Any make</option>
            {makes.map(make => <option key={make} value={make}>{make}</option>)}
          </Select>
        </div>
        <div className="min-w-0">
          <span className="stock-filter-label">Model</span>
          <Select ariaLabel="Quick filter by model" value={filters.model} disabled={!filters.make || models.length === 0} onChange={model => setFilters(current => ({ ...current, model }))}>
            <option value="">Any model</option>
            {models.map(model => <option key={model} value={model}>{model}</option>)}
          </Select>
        </div>
        <div className="min-w-0">
          <span className="stock-filter-label">Maximum price</span>
          <Select ariaLabel="Quick filter by maximum price" value={filters.maxPrice} onChange={value => changeBudget('maxPrice', value)}>
            <option value="">Any price</option>
            {maxBudgets.map(price => <option key={price} value={String(price)}>£{price.toLocaleString('en-GB')}</option>)}
          </Select>
        </div>
        <p className="stock-search-hint">Search by registration, or try “automatic under £15k”.</p>
      </div>
      {(activeFilterCount > 0 || filters.sort) && (
        <div className="mt-2 flex items-center gap-4 overflow-x-auto whitespace-nowrap" aria-label="Applied filters">
          {appliedFilters.map(({ key, label }) => <button type="button" key={key} aria-label={`Remove ${label} filter`} className="inline-flex shrink-0 min-h-11 items-center gap-2 text-xs font-medium text-primary" onClick={() => {
            setFilters((current) => ({ ...current, [key]: typeof current[key] === 'boolean' ? false : '', ...(key === 'make' ? { model: '' } : {}) }));
            setBudgetNotice('');
          }}>{label}<X className="h-3.5 w-3.5" aria-hidden="true" /></button>)}
          <button type="button" onClick={resetFilters} className="ml-auto min-h-11 shrink-0 text-xs font-medium text-muted-foreground underline underline-offset-4 hover:text-primary">Reset all</button>
        </div>
      )}
      {budgetNotice && <p className="mt-2 text-sm text-muted-foreground" role="status">{budgetNotice}</p>}
      <Dialog open={showAdvanced} onOpenChange={setShowAdvanced}><DialogContent style={dialogBrandStyle} onCloseAutoFocus={event => {event.preventDefault(); filterButton.current?.focus({preventScroll:true});}} className="stock-filter-dialog premium-stock-filter-dialog flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-2xl">
        <div className="stock-filter-heading"><DialogTitle>Filter used cars</DialogTitle><DialogDescription>Choose what matters to you. Results update as you go.</DialogDescription></div>
         <section id="advanced-stock-filters" className="stock-filter-body min-h-0 flex-1 overflow-y-auto border-t border-border py-4">
          {quickFilters && <div className="stock-quick-choices mb-5" onClick={event => {if ((event.target as HTMLElement).closest("button")) setShowAdvanced(false);}}><p className="mb-2 text-xs font-medium text-muted-foreground">Quick choices</p>{quickFilters}</div>}
          <div className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3">
            <Field label="Make">
              <Select
                value={filters.make}
                onChange={(make) => setFilters((current) => ({ ...current, make, model: '' }))}
              >
                <option value="">Any make</option>
                {makes.map((make) => <option key={make} value={make}>{make}</option>)}
              </Select>
            </Field>
            <Field label="Model">
              <Select
                value={filters.model}
                onChange={(model) => setFilters((current) => ({ ...current, model }))}
                disabled={!filters.make || models.length === 0}
              >
                <option value="">Any model</option>
                {models.map((model) => <option key={model} value={model}>{model}</option>)}
              </Select>
            </Field>
            <Field label="Min budget">
              <Select
                value={filters.minPrice}
                onChange={(value) => changeBudget('minPrice', value)}
              >
                <option value="">Any</option>
                {Array.from(new Set([5000, 10000, 20000, 30000, 40000, 50000, 75000, ...(filters.minPrice && Number.isFinite(Number(filters.minPrice)) ? [Number(filters.minPrice)] : [])])).sort((a,b) => a-b).map((price) => (
                  <option key={price} value={String(price)}>£{price.toLocaleString()}</option>
                ))}
              </Select>
            </Field>
            <Field label="Max budget">
              <Select
                value={filters.maxPrice}
                onChange={(value) => changeBudget('maxPrice', value)}
              >
                <option value="">Any</option>
                {maxBudgets.map((price) => (
                  <option key={price} value={String(price)}>£{price.toLocaleString('en-GB')}</option>
                ))}
              </Select>
            </Field>
            <Field label="Fuel">
              <Select
                value={filters.fuel}
                onChange={(fuel) => setFilters((current) => ({ ...current, fuel }))}
              >
                <option value="">Any fuel</option>
                {fuels.map((fuel) => <option key={fuel} value={fuel}>{fuel}</option>)}
              </Select>
            </Field>
            <Field label="Transmission">
              <Select
                value={filters.transmission}
                onChange={(transmission) => setFilters((current) => ({ ...current, transmission }))}
              >
                <option value="">Any</option>
                {transmissions.map((transmission) => <option key={transmission} value={transmission}>{transmission}</option>)}
              </Select>
            </Field>
          </div>
          <fieldset className="stock-insurance-filters mt-8 border-t border-primary/10 pt-6">
             <legend className="text-sm font-semibold text-primary">Insurance history</legend>
             <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
              Choose one or more recorded categories. Category S records structural damage; Category N records non-structural damage. Ask for available repair and inspection records.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              {[
                ['noWriteOff', 'No recorded write-off'],
                ['catS', 'Category S'],
                ['catN', 'Category N'],
              ].map(([key, label]) => (
                 <label key={key} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border bg-background p-3 text-sm font-medium text-primary transition-colors hover:bg-secondary">
                  <input
                    type="checkbox"
                    checked={filters[key as 'noWriteOff' | 'catS' | 'catN']}
                    onChange={(event) => setFilters((current) => ({ ...current, [key]: event.target.checked }))}
                    className="h-5 w-5 accent-accent flex-shrink-0"
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
        </section>
        <div className="stock-filter-footer flex shrink-0 items-center justify-between gap-4 border-t pt-4"><button type="button" className="min-h-11 underline underline-offset-4" onClick={resetFilters}>Reset filters</button><button type="button" className="stock-search-submit min-h-12 px-6" onClick={() => {setShowAdvanced(false); handleSearchClick();}}>Show {matchCount ?? vehicleCount} {(matchCount ?? vehicleCount) === 1 ? 'car' : 'cars'}</button></div>
      </DialogContent></Dialog>
    </div>
  );
}
