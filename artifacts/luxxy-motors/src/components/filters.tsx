import { useMemo, useState } from 'react';
import {
  ChevronDown,
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
    <label className="block">
      <span className="mb-2 block font-display text-[11px] font-black uppercase tracking-[0.2em] text-primary">
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
    <NativeSelect
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      className="h-12 w-full appearance-none rounded-none border-2 border-primary bg-background px-4 font-bold uppercase tracking-wider text-[12px] text-primary shadow-[2px_2px_0px_hsl(var(--primary))] outline-none transition-all focus-visible:border-accent focus-visible:ring-0 focus-visible:shadow-[4px_4px_0px_hsl(var(--accent))]"
    >
      {children}
    </NativeSelect>
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
    <div className="mb-3 border-4 border-primary bg-background p-4 shadow-[6px_6px_0px_hsl(var(--primary))] sm:p-6 sm:shadow-[8px_8px_0px_hsl(var(--primary))] lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-12">
      <div className="sm:py-2">
        <label className="block">
          <span className="mb-2 block font-display text-xl font-black uppercase tracking-tighter text-primary sm:mb-4 sm:text-2xl">
            SEARCH SHOWROOM
          </span>
          <span className="relative block max-w-3xl">
            <Input
              aria-label="Search the showroom"
              data-testid="input-showroom-search"
              placeholder="Try “BMW”, “Golf” or a registration"
              value={filters.search}
              onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handleSearchClick();
                }
              }}
              className="h-12 bg-background pr-10 text-[14px] shadow-[3px_3px_0px_hsl(var(--primary))] sm:h-14 sm:shadow-[4px_4px_0px_hsl(var(--primary))]"
            />
            {filters.search && (
              <button
                type="button"
                className="absolute right-0 top-0 grid h-12 w-12 place-items-center text-primary/40 hover:text-accent sm:h-14 sm:w-14"
                onClick={() => setFilters((current) => ({ ...current, search: '' }))}
              >
                <X className="h-5 w-5" />
                <span className="sr-only">Clear search</span>
              </button>
            )}
          </span>
        </label>

        <div className="mt-4 border-t-2 border-primary/10 pt-4 sm:mt-8 sm:pt-6">
          <button
            type="button"
            className="flex items-center gap-2 font-display text-[12px] font-black uppercase tracking-[0.2em] text-primary hover:text-accent transition-colors"
            onClick={() => setShowAdvanced(!showAdvanced)}
            aria-expanded={showAdvanced}
            aria-label="Advanced search"
          >
            {showAdvanced ? 'HIDE FILTERS' : 'ADVANCED FILTERS'}
            <ChevronDown
              className={`h-4 w-4 transition-transform duration-200 ${showAdvanced ? 'rotate-180' : ''}`}
            />
          </button>

          {showAdvanced && (
            <section className="mt-8 animate-in fade-in slide-in-from-top-4 duration-300">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
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
              <fieldset className="mt-8 border-t-2 border-primary/10 pt-6">
                <legend className="font-display text-[11px] font-black uppercase tracking-[0.2em] text-primary">Insurance history</legend>
                <p className="mt-2 max-w-2xl text-[12px] font-bold uppercase tracking-widest text-primary/70 leading-relaxed">
                  Choose one or more recorded categories. Category S is repaired structural damage; Category N is repaired non-structural damage.
                </p>
                <div className="mt-6 flex flex-wrap gap-6">
                  {[
                    ['noWriteOff', 'No recorded write-off'],
                    ['catS', 'Category S'],
                    ['catN', 'Category N'],
                  ].map(([key, label]) => (
                    <label key={key} className="flex items-center gap-3 font-bold text-[12px] uppercase tracking-widest text-primary cursor-pointer border-2 border-primary bg-primary/5 p-3 hover:bg-primary hover:text-primary-foreground transition-colors shadow-[2px_2px_0px_hsl(var(--primary))]">
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

      <div className="mt-4 flex flex-col gap-3 border-t-2 border-primary/10 pt-4 sm:mt-6 sm:flex-row sm:items-end sm:justify-between sm:gap-4 sm:pt-6 lg:mt-0 lg:border-t-0 lg:pt-0">
        <div className="flex flex-row items-center justify-between gap-4 sm:gap-6 sm:justify-start w-full sm:w-auto">
          <button
            type="button"
            onClick={resetFilters}
            className="font-display text-[11px] font-black uppercase tracking-[0.2em] text-primary/70 hover:text-primary min-h-[44px] flex items-center shrink-0"
          >
            Reset filters
            {activeFilterCount > 0 && <span className="ml-2 bg-accent text-accent-foreground px-2 py-0.5 shadow-[2px_2px_0px_hsl(var(--primary))]">({activeFilterCount})</span>}
          </button>

          <div className="flex items-center gap-3 flex-1 sm:flex-none">
            <span className="font-display text-[11px] font-black uppercase tracking-[0.2em] text-primary/70 hidden sm:inline">SORT</span>
            <NativeSelect
              aria-label="Sort results"
              value={filters.sort}
              onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value as FilterState['sort'] }))}
              className="h-12 w-full flex-1 rounded-none border-2 border-primary bg-background px-2 sm:px-4 font-bold uppercase tracking-wider text-[11px] text-primary shadow-[2px_2px_0px_hsl(var(--primary))] sm:w-56"
            >
              <option value="">Recommended</option>
              <option value="price-asc">Price: low to high</option>
              <option value="price-desc">Price: high to low</option>
              <option value="mileage-asc">Mileage: low to high</option>
              <option value="mileage-desc">Mileage: high to low</option>
            </NativeSelect>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSearchClick}
          className="flex h-12 w-full items-center justify-center rounded-none bg-primary px-8 font-display text-[12px] font-black uppercase tracking-[0.18em] text-primary-foreground shadow-[4px_4px_0px_hsl(var(--accent))] transition-all hover:-translate-y-1 hover:shadow-[6px_6px_0px_hsl(var(--accent))] sm:h-14 sm:w-auto sm:text-[13px] sm:tracking-[0.2em]"
        >
          View matching cars
        </button>
      </div>
    </div>
  );
}