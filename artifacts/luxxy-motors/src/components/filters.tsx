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
    <div className="mb-3 border-y border-border bg-card p-4 sm:p-5">
      <div className="min-w-0">
        <label className="block min-w-0">
           <span className="mb-3 block field-label">
             Find your next car
          </span>
          <span className="relative block">
            <Search aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-primary/50" />
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
               className="h-12 rounded-md border border-input bg-card pl-11 pr-12 text-base font-normal placeholder:font-normal shadow-none"
            />
            {filters.search && (
              <button
                type="button"
                className="absolute right-0 top-0 grid h-12 w-12 place-items-center text-primary/40 hover:text-accent sm:h-12 sm:w-12"
                onClick={() => setFilters((current) => ({ ...current, search: '' }))}
              >
                <X className="h-5 w-5" />
                <span className="sr-only">Clear search</span>
              </button>
            )}
          </span>
        </label>

        <div className="mt-2">
          <div className="flex items-center justify-between gap-3">
          <button
            type="button"
             className="flex min-h-11 items-center gap-2 font-display text-[13px] font-semibold text-primary hover:text-accent transition-colors"
            onClick={() => setShowAdvanced(!showAdvanced)}
            aria-expanded={showAdvanced}
            aria-label="Advanced search"
            aria-controls="advanced-stock-filters"
          >
             {showAdvanced ? 'Hide filters' : 'More filters'}
            <ChevronDown
              className={`h-4 w-4 transition-transform duration-200 ${showAdvanced ? 'rotate-180' : ''}`}
            />
          </button>

          <button
            type="button"
            onClick={resetFilters}
            className="flex min-h-11 shrink-0 items-center font-display text-xs font-medium text-primary/65 hover:text-primary"
          >
            Reset filters
            {activeFilterCount > 0 && <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-primary-foreground">({activeFilterCount})</span>}
          </button>
          </div>

          {showAdvanced && (
             <section id="advanced-stock-filters" className="mt-3 border-t border-primary/10 pt-4 animate-in fade-in duration-200">
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
      </div>

      <div className="mt-2 grid grid-cols-1 items-end gap-3 min-[360px]:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] sm:mt-4 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <div className="relative flex min-w-0 items-center gap-3">
               <span className="hidden font-display text-[11px] font-semibold text-primary/70 sm:inline">Sort</span>
            <NativeSelect
              aria-label="Sort results"
              value={filters.sort}
              onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value as FilterState['sort'] }))}
               className="h-12 min-w-0 w-full flex-1 rounded-md border border-input bg-card pl-3 pr-8 text-base tracking-normal font-medium text-primary shadow-none sm:max-w-64 sm:text-sm"
            >
              <option value="">Recommended</option>
              <option value="price-asc">Price: low to high</option>
              <option value="price-desc">Price: high to low</option>
              <option value="mileage-asc">Mileage: low to high</option>
              <option value="mileage-desc">Mileage: high to low</option>
            </NativeSelect>
            <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 h-4 w-4 text-primary/50 sm:hidden" />
          </div>
        </div>

        <button
          type="button"
          onClick={handleSearchClick}
           className="flex h-12 w-full items-center justify-center rounded-md bg-accent px-3 font-display text-[12px] font-semibold text-accent-foreground shadow-none transition-colors hover:bg-primary hover:text-primary-foreground sm:w-auto sm:px-8 sm:text-sm"
        >
           View matching cars
        </button>
      </div>
    </div>
  );
}
