import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Banknote,
  Car,
  ChevronDown,
  Fuel,
  RotateCcw,
  Search,
  Settings2,
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
  icon: Icon,
  children,
}: {
  label: string;
  icon: typeof Car;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="luxxy-label mb-2 flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5 text-accent" />
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
    <NativeSelect value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}>
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
    <div className="container mx-auto px-4 sm:px-6 lg:px-8">
      <div className="luxxy-surface border border-border bg-card">
        <div className="flex flex-col justify-between gap-4 border-b border-border bg-primary text-primary-foreground px-5 py-8 sm:flex-row sm:items-end sm:px-8">
          <div>
            <p className="luxxy-label text-accent">Browse our stock</p>
            <h2 className="mt-4 font-display text-4xl font-semibold leading-none tracking-tight md:text-5xl">
              Find a car you&apos;ll love
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-primary-foreground/70">
              Start with a simple search, then fine-tune the details that matter to you.
            </p>
          </div>
          <p className="font-mono text-[13px] font-bold text-accent">{vehicleCount} vehicles in stock</p>
        </div>

        <div className="px-5 py-6 sm:px-8 bg-card">
          <label className="block">
            <span className="luxxy-label mb-2 flex items-center gap-1.5 text-muted-foreground">
              <Search className="h-3.5 w-3.5 text-accent" />
              What are you looking for?
            </span>
            <span className="relative block">
              <Input
                aria-label="Search the showroom"
                placeholder="Try “BMW”, “Golf” or a registration"
                value={filters.search}
                onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    handleSearchClick();
                  }
                }}
                className="h-14 pr-11 text-base placeholder:font-normal focus-visible:border-accent"
                data-testid="input-showroom-search"
              />
              {filters.search && (
                <button
                  type="button"
                  aria-label="Clear showroom search"
                  onClick={() => setFilters((current) => ({ ...current, search: '' }))}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-muted-foreground transition hover:text-primary"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </span>
          </label>

          <div className="mt-5 border-t border-border/70 pt-5">
            <button
              type="button"
              aria-expanded={showAdvanced}
              onClick={() => setShowAdvanced((current) => !current)}
              className="flex w-full items-center justify-between gap-3 border border-border bg-secondary/40 px-4 py-3 text-left text-sm font-bold text-primary transition hover:border-accent"
            >
              <span className="flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-accent" />
                Advanced search
              </span>
              <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
            </button>

            {showAdvanced && (
              <section
                className="mt-4 border border-border bg-secondary/25 p-4 sm:p-5"
                aria-labelledby="advanced-search-heading"
              >
                <h3 id="advanced-search-heading" className="luxxy-label mb-5 text-muted-foreground">
                  Refine the details
                </h3>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="Make" icon={Car}>
                    <Select
                      value={filters.make}
                      onChange={(make) => setFilters((current) => ({ ...current, make, model: '' }))}
                    >
                      <option value="">Any make</option>
                      {makes.map((make) => <option key={make} value={make}>{make}</option>)}
                    </Select>
                  </Field>
                  <Field label="Model" icon={Car}>
                    <Select
                      value={filters.model}
                      onChange={(model) => setFilters((current) => ({ ...current, model }))}
                      disabled={!filters.make || models.length === 0}
                    >
                      <option value="">Any model</option>
                      {models.map((model) => <option key={model} value={model}>{model}</option>)}
                    </Select>
                  </Field>
                  <Field label="Min budget" icon={Banknote}>
                    <Input
                      type="number"
                      min="0"
                      placeholder="£ Min"
                      value={filters.minPrice}
                      onChange={(event) => setFilters((current) => ({ ...current, minPrice: event.target.value }))}
                      className="h-11 placeholder:font-semibold"
                    />
                  </Field>
                  <Field label="Max budget" icon={Banknote}>
                    <Input
                      type="number"
                      min="0"
                      placeholder="£ Max"
                      value={filters.maxPrice}
                      onChange={(event) => setFilters((current) => ({ ...current, maxPrice: event.target.value }))}
                      className="h-11 placeholder:font-semibold"
                    />
                  </Field>
                  <Field label="Fuel" icon={Fuel}>
                    <Select value={filters.fuel} onChange={(fuel) => setFilters((current) => ({ ...current, fuel }))}>
                      <option value="">Any fuel</option>
                      {fuels.map((fuel) => <option key={fuel} value={fuel}>{fuel}</option>)}
                    </Select>
                  </Field>
                  <Field label="Transmission" icon={Settings2}>
                    <Select
                      value={filters.transmission}
                      onChange={(transmission) => setFilters((current) => ({ ...current, transmission }))}
                    >
                      <option value="">Any transmission</option>
                      {transmissions.map((transmission) => <option key={transmission} value={transmission}>{transmission}</option>)}
                    </Select>
                  </Field>
                </div>
                <fieldset className="mt-6 border-t border-border pt-5">
                  <legend className="luxxy-label text-muted-foreground">Insurance history</legend>
                  <p className="mt-2 max-w-2xl text-xs leading-5 text-muted-foreground">
                    Choose one or more recorded categories. Category S is repaired structural damage; Category N is repaired non-structural damage.
                  </p>
                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    {[
                      ['noWriteOff', 'No recorded write-off'],
                      ['catS', 'Category S'],
                      ['catN', 'Category N'],
                    ].map(([key, label]) => (
                      <label key={key} className="flex min-h-11 items-center gap-3 border border-border bg-background px-3 py-2 text-sm font-semibold">
                        <input
                          type="checkbox"
                          checked={filters[key as 'noWriteOff' | 'catS' | 'catN']}
                          onChange={(event) => setFilters((current) => ({ ...current, [key]: event.target.checked }))}
                          className="h-4 w-4 accent-[hsl(var(--primary))]"
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

        <div className="flex flex-col justify-between gap-4 border-t border-border bg-secondary/25 px-5 py-4 sm:flex-row sm:items-center sm:px-8">
          <button
            type="button"
            onClick={resetFilters}
            className="text-left text-xs font-bold uppercase tracking-[.12em] text-muted-foreground transition hover:text-primary"
          >
            <RotateCcw className="mr-1.5 inline h-3.5 w-3.5" />
            Reset search
            {activeFilterCount > 0 && <span className="ml-1.5 text-accent">({activeFilterCount})</span>}
          </button>

          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
            <div className="flex items-center gap-2">
              <span className="luxxy-label text-muted-foreground">Sort by</span>
              <NativeSelect
                aria-label="Sort results"
                value={filters.sort}
                onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value as FilterState['sort'] }))}
                className="sm:w-52"
              >
                <option value="">Recommended</option>
                <option value="price-asc">Price: low to high</option>
                <option value="price-desc">Price: high to low</option>
                <option value="mileage-asc">Mileage: low to high</option>
                <option value="mileage-desc">Mileage: high to low</option>
              </NativeSelect>
            </div>
            <button
              type="button"
              onClick={handleSearchClick}
              className="h-11 rounded-none bg-accent px-6 text-sm font-bold text-accent-foreground transition hover:bg-accent/90"
            >
              Show results
              <ArrowRight className="ml-2 inline h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
