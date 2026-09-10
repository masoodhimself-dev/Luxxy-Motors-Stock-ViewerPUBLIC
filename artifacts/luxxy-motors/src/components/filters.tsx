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
      <span className="mb-2 block text-[15px] text-primary/80">
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
      className="h-12 rounded-none border-primary/20 text-[15px] shadow-none"
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
    <div className="mb-4 lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-12">
      <div className="py-2">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-primary">
            What are you looking for?
          </span>
          <span className="relative block max-w-3xl">
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
              className="h-12 border-0 border-b border-primary/20 bg-transparent px-0 pr-11 text-base placeholder:text-primary/40 focus-visible:border-primary focus-visible:ring-0 rounded-none shadow-none text-primary"
              data-testid="input-showroom-search"
            />
            {filters.search && (
              <button
                type="button"
                aria-label="Clear showroom search"
                onClick={() => setFilters((current) => ({ ...current, search: '' }))}
                className="absolute right-0 top-1/2 -translate-y-1/2 p-2 text-primary/50 transition hover:text-primary min-h-[44px] min-w-[44px] grid place-items-center"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </span>
        </label>

        <div className="mt-2">
          <button
            type="button"
            aria-expanded={showAdvanced}
            onClick={() => setShowAdvanced((current) => !current)}
            className="flex min-h-11 items-center gap-2 py-2 text-sm text-primary/70 hover:text-primary transition-colors"
          >
              <span className="font-medium">Advanced search</span>
              <ChevronDown className={`h-4 w-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
            </button>

            {showAdvanced && (
              <section
                className="mt-4 pb-8 border-b border-primary/10"
                aria-labelledby="advanced-search-heading"
              >
                <h3 id="advanced-search-heading" className="sr-only">
                  Refine the details
                </h3>
                <div className="grid gap-x-12 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
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
                    <Input
                      type="number"
                      min="0"
                      placeholder="£ Min"
                      value={filters.minPrice}
                      onChange={(event) => setFilters((current) => ({ ...current, minPrice: event.target.value }))}
                      className="h-12 shadow-none border-primary/20 rounded-none text-[15px]"
                    />
                  </Field>
                  <Field label="Max budget">
                    <Input
                      type="number"
                      min="0"
                      placeholder="£ Max"
                      value={filters.maxPrice}
                      onChange={(event) => setFilters((current) => ({ ...current, maxPrice: event.target.value }))}
                      className="h-12 shadow-none border-primary/20 rounded-none text-[15px]"
                    />
                  </Field>
                  <Field label="Fuel">
                    <Select value={filters.fuel} onChange={(fuel) => setFilters((current) => ({ ...current, fuel }))}>
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
                <fieldset className="mt-10 border-t border-primary/10 pt-8">
                  <legend className="text-[15px] font-medium text-primary">Insurance history</legend>
                  <p className="mt-2 max-w-2xl text-[14px] text-primary/70">
                    Choose one or more recorded categories. Category S is repaired structural damage; Category N is repaired non-structural damage.
                  </p>
                  <div className="mt-5 flex flex-wrap gap-6">
                    {[
                      ['noWriteOff', 'No recorded write-off'],
                      ['catS', 'Category S'],
                      ['catN', 'Category N'],
                    ].map(([key, label]) => (
                      <label key={key} className="flex items-center gap-3 text-[15px] text-primary">
                        <input
                          type="checkbox"
                          checked={filters[key as 'noWriteOff' | 'catS' | 'catN']}
                          onChange={(event) => setFilters((current) => ({ ...current, [key]: event.target.checked }))}
                          className="h-5 w-5 accent-accent"
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

        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between lg:mt-0">
          <div className="flex flex-row items-center justify-between gap-6 sm:justify-start">
            <button
              type="button"
              onClick={resetFilters}
              className="text-[15px] text-primary/70 hover:text-primary min-h-[44px] inline-flex items-center"
            >
              Reset filters
              {activeFilterCount > 0 && <span className="ml-1 text-accent font-medium">({activeFilterCount})</span>}
            </button>

            <div className="flex items-center gap-3">
              <span className="text-[15px] text-primary/70 hidden sm:inline">Sort</span>
              <NativeSelect
                aria-label="Sort results"
                value={filters.sort}
                onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value as FilterState['sort'] }))}
                className="h-11 w-44 rounded-none border-primary/20 text-sm shadow-none sm:w-56 sm:text-[15px]"
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
            className="flex h-12 w-full items-center justify-center rounded-none bg-primary px-6 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 sm:h-14 sm:w-auto sm:px-8 sm:text-[15px]"
          >
            View matching cars
          </button>
        </div>
      </div>
  );
}
