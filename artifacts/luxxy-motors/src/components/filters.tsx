import { useMemo, useState } from 'react';
import {
  ChevronDown,
  Search,
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
  sort: 'price-asc' | 'price-desc' | 'mileage-asc' | 'mileage-desc' | '';
}

interface FiltersProps {
  cars: CarType[];
  filters: FilterState;
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
  onSearch?: () => void;
  vehicleCount: number;
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
       <span className="mb-2 block font-display text-[11px] font-semibold tracking-normal text-primary/70">
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
}: {
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <span className="relative block">
      <NativeSelect
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="h-12 w-full appearance-none rounded-md border border-input bg-card pl-3 pr-8 text-base font-normal tracking-normal text-primary shadow-none transition-colors focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20"
      >
        {children}
      </NativeSelect>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary/50" />
    </span>
  );
}

export function Filters({ cars, filters, setFilters, onSearch, vehicleCount }: FiltersProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

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

  const handleSearchClick = () => {
    onSearch?.();
  };

  const resetFilters = () => {
    setFilters(emptyFilters);
  };

  return (
    <div className="border-y border-border py-3" data-testid="stock-search-toolbar">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] min-[375px]:grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 lg:grid-cols-[minmax(0,1fr)_auto_200px_auto] lg:gap-3">
        <label className="relative col-span-2 min-[375px]:col-span-3 block min-w-0 lg:col-span-1">
          <span className="sr-only">Find your next car</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search the showroom"
            data-testid="input-showroom-search"
            placeholder="Make, model or registration"
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
        <button
          type="button"
          className="flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-input bg-card px-3 text-sm font-medium hover:bg-secondary"
          onClick={() => setShowAdvanced(!showAdvanced)}
          aria-expanded={showAdvanced}
          aria-label="Advanced search"
          aria-controls="advanced-stock-filters"
        >
          Filters{activeFilterCount > 0 && <span className="tabular-nums"> ({activeFilterCount})</span>}
          <ChevronDown aria-hidden="true" className={`h-4 w-4 transition-transform duration-200 ${showAdvanced ? 'rotate-180' : ''}`} />
        </button>
        <NativeSelect
          aria-label="Sort results"
          value={filters.sort}
          onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value as FilterState['sort'] }))}
          className="h-11 min-w-0 w-full border-input bg-card pl-3 pr-6 text-base shadow-none lg:text-sm"
        >
          <option value="">Stock order</option>
          <option value="price-asc">Lowest price</option>
          <option value="price-desc">Highest price</option>
          <option value="mileage-asc">Lowest mileage</option>
          <option value="mileage-desc">Highest mileage</option>
        </NativeSelect>
        <button
          type="button"
          onClick={handleSearchClick}
          aria-label="View matching cars"
          className="col-span-2 min-[375px]:col-span-1 flex min-h-11 items-center justify-center rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 sm:px-5"
        >
          <span className="sm:hidden">View cars</span><span className="hidden sm:inline">View matching cars</span>
        </button>
      </div>
      {(activeFilterCount > 0 || filters.sort) && (
        <button type="button" onClick={resetFilters} className="mt-1 flex min-h-11 items-center gap-2 text-xs font-medium text-muted-foreground underline underline-offset-4 hover:text-primary">
          <X aria-hidden="true" className="h-3.5 w-3.5" /> Reset filters
        </button>
      )}
      {showAdvanced && (
         <section id="advanced-stock-filters" className="mt-3 border-t border-border pt-4 animate-in fade-in duration-200">
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
                onChange={(minPrice) => setFilters((current) => ({ ...current, minPrice }))}
              >
                <option value="">Any</option>
                {[5000, 10000, 20000, 30000, 40000, 50000, 75000].map((price) => (
                  <option key={price} value={String(price)}>£{price.toLocaleString()}</option>
                ))}
              </Select>
            </Field>
            <Field label="Max budget">
              <Select
                value={filters.maxPrice}
                onChange={(maxPrice) => setFilters((current) => ({ ...current, maxPrice }))}
              >
                <option value="">Any</option>
                {[5000, 10000, 20000, 30000, 40000, 50000, 75000, 100000].map((price) => (
                  <option key={price} value={String(price)}>£{price.toLocaleString()}</option>
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
                <option value="">Any transmission</option>
                {transmissions.map((transmission) => <option key={transmission} value={transmission}>{transmission}</option>)}
              </Select>
            </Field>
          </div>
          <fieldset className="mt-8 border-t border-primary/10 pt-6">
             <legend className="font-display text-[11px] font-semibold tracking-normal text-primary">Insurance history</legend>
             <p className="mt-2 max-w-2xl text-[12px] font-medium leading-relaxed text-primary/65">
              Choose one or more recorded categories. Category S is repaired structural damage; Category N is repaired non-structural damage.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              {[
                ['noWriteOff', 'No recorded write-off'],
                ['catS', 'Category S'],
                ['catN', 'Category N'],
              ].map(([key, label]) => (
                 <label key={key} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-primary/15 bg-primary/5 p-3 text-[12px] font-medium text-primary transition-colors hover:bg-primary hover:text-primary-foreground">
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
      )}
    </div>
  );
}
