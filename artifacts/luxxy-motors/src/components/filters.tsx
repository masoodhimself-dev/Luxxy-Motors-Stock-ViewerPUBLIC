import { useMemo } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Car,
  Check,
  Fuel,
  RotateCcw,
  Search,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
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
  dark = false,
}: {
  label: string;
  icon: typeof Car;
  children: React.ReactNode;
  dark?: boolean;
}) {
  return (
    <label className="block">
      <span
        className={`mb-2 flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.15em] ${
          dark ? 'text-white/65' : 'text-muted-foreground'
        }`}
      >
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
  dark = false,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  dark?: boolean;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      className={`h-11 w-full rounded-xl border px-3 text-sm font-bold outline-none transition focus:ring-2 disabled:cursor-not-allowed disabled:opacity-45 ${
        dark
          ? 'border-white/15 bg-white/10 text-white focus:border-accent focus:ring-accent/25'
          : 'border-border bg-background text-foreground focus:border-accent focus:ring-accent/25'
      }`}
    >
      {children}
    </select>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  tone = 'ink',
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  tone?: 'ink' | 'red' | 'gold';
}) {
  const color =
    tone === 'red'
      ? 'bg-destructive'
      : tone === 'gold'
        ? 'bg-amber-500'
        : 'bg-primary';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-border/70 bg-background px-3 py-3 text-left text-sm font-extrabold text-foreground transition hover:border-accent sm:px-3.5"
    >
      <span className="flex items-center gap-2.5">
        <span className={`grid h-5 w-5 place-items-center rounded-md ${checked ? color : 'border-2 border-muted-foreground/35'}`}>
          {checked && <Check className="h-3.5 w-3.5 text-primary-foreground" />}
        </span>
        {label}
      </span>
      <span className={`h-1.5 w-8 rounded-full ${checked ? color : 'bg-border'}`} />
    </button>
  );
}

export function Filters({ cars, filters, setFilters, onSearch, vehicleCount }: FiltersProps) {
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
    <div className="relative z-20 mx-4 max-w-7xl overflow-hidden rounded-[24px] border border-border/70 bg-card shadow-[0_20px_60px_hsl(var(--primary)/0.1)] lg:mx-auto">
      <div className="h-1.5 bg-gradient-to-r from-primary via-accent to-primary" />

      <div className="p-5 sm:p-8">
        <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <div className="mb-2 flex items-center gap-2 text-accent">
              <Sparkles className="h-4 w-4" />
              <p className="text-[10px] font-extrabold uppercase tracking-[0.2em]">Browse our stock</p>
            </div>
            <h2 className="font-display text-[clamp(1.8rem,4vw,2.7rem)] leading-none tracking-[-0.04em] text-primary">
              Find a car you&apos;ll love
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
              Start with a simple search, then fine-tune the details that matter to you.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-primary text-accent">
              <Car className="h-4 w-4" />
            </span>
            <span className="text-xs font-extrabold text-muted-foreground">{vehicleCount} vehicles in stock</span>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.08fr)_minmax(320px,0.92fr)]">
          <section className="rounded-2xl border border-border/70 bg-secondary/55 p-4 sm:p-5" aria-labelledby="showroom-search-heading">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-accent">01 · Search the showroom</p>
                <h3 id="showroom-search-heading" className="mt-1 text-xl font-black tracking-[-0.04em] text-primary">
                  What are you looking for?
                </h3>
              </div>
              <span className="rounded-full bg-background px-2.5 py-1 text-[10px] font-black text-muted-foreground">Start here</span>
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-accent" />
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
                className="h-14 rounded-xl border-border bg-background pl-12 pr-11 text-sm font-semibold text-foreground shadow-none placeholder:text-muted-foreground focus-visible:border-accent focus-visible:ring-accent/25"
                data-testid="input-showroom-search"
              />
              {filters.search && (
                <button
                  type="button"
                  aria-label="Clear showroom search"
                  onClick={() => setFilters((current) => ({ ...current, search: '' }))}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <div className="mt-5">
              <p className="mb-3 text-[10px] font-extrabold uppercase tracking-[0.15em] text-muted-foreground">Quick picks</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setFilters((current) => ({ ...current, transmission: current.transmission === 'Automatic' ? '' : 'Automatic' }))}
                  className={`rounded-full border px-3 py-2 text-[11px] font-extrabold transition ${
                    filters.transmission === 'Automatic'
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background text-foreground hover:border-accent'
                  }`}
                >
                  Automatic
                </button>
                <button
                  type="button"
                  onClick={() => setFilters((current) => ({ ...current, maxPrice: current.maxPrice === '5000' ? '' : '5000' }))}
                  className={`rounded-full border px-3 py-2 text-[11px] font-extrabold transition ${
                    filters.maxPrice === '5000'
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background text-foreground hover:border-accent'
                  }`}
                >
                  Under £5,000
                </button>
                <button
                  type="button"
                  onClick={() => setFilters((current) => ({ ...current, sort: current.sort === 'mileage-asc' ? '' : 'mileage-asc' }))}
                  className={`rounded-full border px-3 py-2 text-[11px] font-extrabold transition ${
                    filters.sort === 'mileage-asc'
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background text-foreground hover:border-accent'
                  }`}
                >
                  Low mileage
                </button>
                <button
                  type="button"
                  onClick={() => setFilters((current) => ({ ...current, noWriteOff: !current.noWriteOff }))}
                  className={`rounded-full border px-3 py-2 text-[11px] font-extrabold transition ${
                    filters.noWriteOff
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background text-foreground hover:border-accent'
                  }`}
                >
                  HPI clear
                </button>
              </div>
            </div>

            <div className="mt-7 border-t border-border/70 pt-5">
              <div className="flex items-center gap-2 text-[11px] font-extrabold text-primary">
                <SlidersHorizontal className="h-4 w-4 text-accent" />
                Your search, your shortlist
              </div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                Use the panel beside this search when you know the exact shape, budget or history you want.
              </p>
            </div>
          </section>

          <section className="rounded-2xl border border-primary bg-primary p-4 text-primary-foreground shadow-[0_14px_35px_hsl(var(--primary)/0.18)] sm:p-5" aria-labelledby="advanced-search-heading">
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-accent">02 · Advanced search</p>
                <h3 id="advanced-search-heading" className="mt-1 text-xl font-black tracking-[-0.04em]">Refine the details</h3>
              </div>
              <span className="grid h-8 w-8 place-items-center rounded-full border border-white/15 text-accent">
                <Settings2 className="h-4 w-4" />
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Make" icon={Car} dark>
                <Select
                  value={filters.make}
                  onChange={(make) => setFilters((current) => ({ ...current, make, model: '' }))}
                  dark
                >
                  <option value="">Any make</option>
                  {makes.map((make) => <option key={make} value={make}>{make}</option>)}
                </Select>
              </Field>
              <Field label="Model" icon={Car} dark>
                <Select
                  value={filters.model}
                  onChange={(model) => setFilters((current) => ({ ...current, model }))}
                  dark
                  disabled={!filters.make || models.length === 0}
                >
                  <option value="">Any model</option>
                  {models.map((model) => <option key={model} value={model}>{model}</option>)}
                </Select>
              </Field>
              <Field label="Min budget" icon={Banknote} dark>
                <Input
                  type="number"
                  min="0"
                  placeholder="£ Min"
                  value={filters.minPrice}
                  onChange={(event) => setFilters((current) => ({ ...current, minPrice: event.target.value }))}
                  className="h-11 rounded-xl border-white/15 bg-white/10 font-bold text-white placeholder:text-white/45 focus-visible:border-accent focus-visible:ring-accent/25"
                />
              </Field>
              <Field label="Max budget" icon={Banknote} dark>
                <Input
                  type="number"
                  min="0"
                  placeholder="£ Max"
                  value={filters.maxPrice}
                  onChange={(event) => setFilters((current) => ({ ...current, maxPrice: event.target.value }))}
                  className="h-11 rounded-xl border-white/15 bg-white/10 font-bold text-white placeholder:text-white/45 focus-visible:border-accent focus-visible:ring-accent/25"
                />
              </Field>
              <Field label="Fuel" icon={Fuel} dark>
                <Select
                  value={filters.fuel}
                  onChange={(fuel) => setFilters((current) => ({ ...current, fuel }))}
                  dark
                >
                  <option value="">Any fuel</option>
                  {fuels.map((fuel) => <option key={fuel} value={fuel}>{fuel}</option>)}
                </Select>
              </Field>
              <Field label="Transmission" icon={Settings2} dark>
                <Select
                  value={filters.transmission}
                  onChange={(transmission) => setFilters((current) => ({ ...current, transmission }))}
                  dark
                >
                  <option value="">Any transmission</option>
                  {transmissions.map((transmission) => <option key={transmission} value={transmission}>{transmission}</option>)}
                </Select>
              </Field>
            </div>

            <div className="mt-5 border-t border-white/15 pt-4">
              <div className="mb-3 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.15em] text-white/80">
                <AlertTriangle className="h-3.5 w-3.5 text-accent" />
                Condition history
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <Toggle label="HPI clear" checked={filters.noWriteOff} onChange={(noWriteOff) => setFilters((current) => ({ ...current, noWriteOff }))} />
                <Toggle label="CAT S" tone="red" checked={filters.catS} onChange={(catS) => setFilters((current) => ({ ...current, catS }))} />
                <Toggle label="CAT N" tone="gold" checked={filters.catN} onChange={(catN) => setFilters((current) => ({ ...current, catN }))} />
              </div>
            </div>
          </section>
        </div>

        <div className="mt-5 flex flex-col justify-between gap-3 border-t border-border/70 pt-5 sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={resetFilters}
            className="text-left text-xs font-extrabold text-muted-foreground transition hover:text-primary"
          >
            <RotateCcw className="mr-1.5 inline h-3.5 w-3.5" />
            Reset search
            {activeFilterCount > 0 && <span className="ml-1.5 text-accent">({activeFilterCount})</span>}
          </button>

          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold text-muted-foreground">Sort by</span>
              <select
                aria-label="Sort results"
                value={filters.sort}
                onChange={(event) => setFilters((current) => ({ ...current, sort: event.target.value as FilterState['sort'] }))}
                className="h-11 flex-1 rounded-xl border border-border bg-background px-3 text-sm font-bold text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/25 sm:w-52"
              >
                <option value="">Recommended</option>
                <option value="price-asc">Price: low to high</option>
                <option value="price-desc">Price: high to low</option>
                <option value="mileage-asc">Mileage: low to high</option>
                <option value="mileage-desc">Mileage: high to low</option>
              </select>
            </div>
            <button
              type="button"
              onClick={handleSearchClick}
              className="h-11 rounded-xl bg-accent px-6 text-sm font-black text-accent-foreground shadow-md shadow-accent/20 transition hover:-translate-y-0.5"
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