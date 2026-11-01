import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Search } from "lucide-react";
import type { Car } from "@/lib/stock-context";
import { stockBudgetOptions } from "@/lib/stock-budget-options";
import { arrivalTime } from "@/lib/stock-presentation";
import { formatPrice } from "@/lib/utils";
import { applyStockFilters } from "@/features/stock-search/apply-filters";
import { vehicleBenefits } from "@/lib/vehicle-benefits";
import { MakeLogo } from "./make-logo";
import {
  splitStockFacetValues,
  stockValueKey,
  type StockFacetKey,
  type StockFacetOption,
  type StockFilters,
} from "@/features/stock-search/types";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./ui/sheet";
import "./multi-stock-filters.css";

type Props = {
  cars: Car[];
  filters: StockFilters;
  onChange: (patch: Partial<StockFilters>) => void;
  onClear: () => void;
  matchCount: number;
  onShowResults?: () => void;
};
const iconFiles = {
  make: "02-filter-make-car.svg",
  model: "05-filter-model-layout-list.svg",
  colour: "06-filter-colour-palette.svg",
  bodyType: "07-filter-body-type-and-vehicle-type-truck.svg",
  engine: "08-filter-engine-size-and-gearbox-settings.svg",
  seats: "09-filter-seats-users.svg",
  mileage: "10-filter-mileage-gauge.svg",
  price: "11-filter-max-price-badge-pound-sterling.svg",
  fuel: "12-filter-fuel-type-fuel.svg",
  transmission: "08-filter-engine-size-and-gearbox-settings.svg",
  vehicleType: "07-filter-body-type-and-vehicle-type-truck.svg",
  ulez: "13-filter-ulez-leaf.svg",
  filters: "15-mobile-filters-button-filter.svg",
  sort: "16-sort-by-arrow-up-down.svg",
  close: "17-close-x.svg",
  check: "04-checkbox-check.svg",
  chevron: "03-chevron-down.svg",
  clear: "01-clear-all-refresh-ccw.svg",
} as const;
function FilterIcon({ name }: { name: keyof typeof iconFiles }) {
  return (
    <img
      className="multi-stock-icon"
      data-filter-icon={name}
      src={`/brand/multi-choice-motors/filters/${iconFiles[name]}`}
      width={name === "make" ? 20 : 16}
      height={name === "make" ? 20 : 16}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
const facetNames: Record<StockFacetKey, string> = {
  make: "Make",
  model: "Model",
  transmission: "Gearbox",
  fuel: "Fuel Type",
  bodyType: "Body Type",
  colour: "Colour",
  engine: "Engine Size",
  seats: "Seats",
};
const facetOrder: StockFacetKey[] = [
  "make",
  "model",
  "colour",
  "bodyType",
  "engine",
  "seats",
  "fuel",
  "transmission",
];
const selectedValues = (filters: StockFilters, key: StockFacetKey) =>
  splitStockFacetValues(filters[key]);
const isSelected = (values: string[], value: string) =>
  values.some((selected) => stockValueKey(selected) === stockValueKey(value));
function toggleFacet(
  filters: StockFilters,
  key: StockFacetKey,
  value: string,
): Partial<StockFilters> {
  const selected = selectedValues(filters, key);
  return {
    [key]: (isSelected(selected, value)
      ? selected.filter((item) => stockValueKey(item) !== stockValueKey(value))
      : [...selected, value]
    ).join(","),
  };
}

function FilterSection({
  title,
  icon,
  count = 0,
  children,
}: {
  title: string;
  icon: keyof typeof iconFiles;
  count?: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false),
    panelId = useId();
  return (
    <section className="multi-stock-section">
      <button
        type="button"
        className="multi-stock-section__toggle"
        aria-label={count ? `${title}, ${count} selected` : title}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <FilterIcon name={icon} />
        <span className="multi-stock-section__label">{title}</span>
        {count > 0 && (
          <span className="multi-stock-selection-count" aria-hidden="true">
            {count}
          </span>
        )}
        <span
          className="multi-stock-section__chevron"
          data-open={open || undefined}
        >
          <FilterIcon name="chevron" />
        </span>
      </button>
      <div id={panelId} hidden={!open} className="multi-stock-section__body">
        {children}
      </div>
    </section>
  );
}

const colours: Record<string, string> = {
  black: "#222",
  white: "#fff",
  grey: "#85898c",
  gray: "#85898c",
  silver: "#c3c8cc",
  blue: "#286396",
  red: "#ad3434",
  green: "#456f50",
  yellow: "#e6bf30",
  orange: "#d17c36",
  purple: "#76578c",
  pink: "#cd8fa8",
  brown: "#80654b",
  bronze: "#a37c52",
  gold: "#b69b60",
  beige: "#c8baa2",
};
function ColourSwatch({ value }: { value: string }) {
  const colour =
    colours[value.trim().toLowerCase()] ??
    Object.entries(colours).find(([name]) =>
      new RegExp(`\\b${name}\\b`, "i").test(value),
    )?.[1];
  return (
    <span
      className="multi-stock-colour"
      aria-hidden="true"
      data-unknown={!colour || undefined}
      style={colour ? { backgroundColor: colour } : undefined}
    />
  );
}
function FacetOption({
  option,
  selected,
  colour,
  make,
  onToggle,
}: {
  option: StockFacetOption;
  selected: boolean;
  colour: boolean;
  make: boolean;
  onToggle: () => void;
}) {
  const countId = useId(),
    disabled = !selected && option.count === 0;
  return (
    <label className="multi-stock-option" data-disabled={disabled || undefined}>
      <input
        type="checkbox"
        checked={selected}
        disabled={disabled}
        aria-label={option.label}
        aria-describedby={countId}
        onChange={onToggle}
      />
      <span className="multi-stock-checkbox" aria-hidden="true">
        <FilterIcon name="check" />
      </span>
      {make && (
        <span className="multi-stock-option__make-logo" aria-hidden="true">
          <MakeLogo make={option.label} size={24} />
        </span>
      )}
      {colour && <ColourSwatch value={option.label} />}
      <span className="multi-stock-option__label">{option.label}</span>
      <span className="multi-stock-option__count" aria-hidden="true">
        {option.count}
      </span>
      <span
        id={countId}
        className="sr-only"
      >{`${option.count} ${option.count === 1 ? "matching car" : "matching cars"}`}</span>
    </label>
  );
}
function CheckboxFacet({
  facet,
  options,
  filters,
  onChange,
  emptyText = "No choices in current stock.",
}: {
  facet: StockFacetKey;
  options: StockFacetOption[];
  filters: StockFilters;
  onChange: Props["onChange"];
  emptyText?: string;
}) {
  const [all, setAll] = useState(false),
    selected = selectedValues(filters, facet);
  const ordered = [
    ...options.filter((option) => isSelected(selected, option.value)),
    ...options.filter((option) => !isSelected(selected, option.value)),
  ];
  const limit = Math.max(8, selected.length),
    shown = all ? ordered : ordered.slice(0, limit);
  return (
    <FilterSection
      title={facetNames[facet]}
      icon={facet}
      count={selected.length}
    >
      <div
        className="multi-stock-options"
        role="group"
        aria-label={`${facetNames[facet]} options`}
      >
        {shown.length ? (
          shown.map((option) => (
            <FacetOption
              key={stockValueKey(option.value)}
              option={option}
              colour={facet === "colour"}
              make={facet === "make"}
              selected={isSelected(selected, option.value)}
              onToggle={() =>
                onChange(toggleFacet(filters, facet, option.value))
              }
            />
          ))
        ) : (
          <p className="multi-stock-empty-options">{emptyText}</p>
        )}
      </div>
      {ordered.length > limit && (
        <button
          type="button"
          className="multi-stock-show-all"
          onClick={() => setAll((value) => !value)}
        >
          {all ? "Show less" : `Show all (${ordered.length})`}
        </button>
      )}
    </FilterSection>
  );
}

function Budget({
  cars,
  filters,
  onChange,
}: Pick<Props, "cars" | "filters" | "onChange">) {
  return (
    <fieldset className="multi-stock-budget">
      <legend className="sr-only">Budget</legend>
      <div>
        {(["minPrice", "maxPrice"] as const).map((key) => (
          <label key={key}>
            <span>{key === "minPrice" ? "Min price" : "Max price"}</span>
            <span className="multi-stock-select-wrap">
              <select
                value={filters[key]}
                onChange={(event) => onChange({ [key]: event.target.value })}
              >
                <option value="">
                  {key === "minPrice" ? "Any" : "Any price"}
                </option>
                {stockBudgetOptions(cars, filters[key]).map((price) => (
                  <option key={price} value={price}>
                    {formatPrice(price)}
                  </option>
                ))}
              </select>
              <FilterIcon name="chevron" />
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
function mileageOptions(cars: Car[], selected: string) {
  const known = cars
    .map((car) => car.mileage)
    .filter(
      (value): value is number =>
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 5_000_000,
    );
  const highest = known.length ? Math.max(...known) : 0,
    ceiling = Math.ceil(highest / 50_000) * 50_000;
  const bands = [50_000, 75_000, 100_000, 125_000, 150_000, 200_000];
  if (ceiling > 200_000)
    bands.push(
      ...[
        250_000, 300_000, 400_000, 500_000, 750_000, 1_000_000, 2_000_000,
        5_000_000,
      ].filter((value) => value < ceiling),
      ceiling,
    );
  if (/^\d+$/.test(selected) && Number(selected) <= 5_000_000)
    bands.push(Number(selected));
  return [...new Set(bands)].sort((a, b) => a - b);
}

function FilterPanel({
  cars,
  filters,
  onChange,
  facets,
  ulezCount,
}: Pick<Props, "cars" | "filters" | "onChange"> & {
  facets: ReturnType<typeof applyStockFilters>["facets"];
  ulezCount: number;
}) {
  const ulezCountId = useId();
  const hasMileage =
    Boolean(filters.mileage) ||
    cars.some(
      (car) =>
        typeof car.mileage === "number" &&
        Number.isFinite(car.mileage) &&
        car.mileage >= 0 &&
        car.mileage <= 5_000_000,
    );
  const hasUlezChoice =
    filters.ulez || cars.some((car) => Boolean(vehicleBenefits(car).ulez));
  const emptyText: Partial<Record<StockFacetKey, string>> = {
    colour: "Colour details are not supplied for this stock.",
    bodyType: "Body type details are not supplied for this stock.",
    engine: "Engine size details are not supplied for this stock.",
    seats: "Seat details are not supplied for this stock.",
  };
  const facet = (key: StockFacetKey) => (
    <CheckboxFacet
      key={key}
      facet={key}
      options={facets[key]}
      filters={filters}
      onChange={onChange}
      emptyText={emptyText[key]}
    />
  );
  return (
    <>
      {(
        ["make", "model", "colour", "bodyType", "engine", "seats"] as const
      ).map(facet)}
      <FilterSection
        title="Mileage"
        icon="mileage"
        count={filters.mileage ? 1 : 0}
      >
        {hasMileage ? (
          <label className="multi-stock-mileage">
            <span>Maximum mileage</span>
            <span className="multi-stock-select-wrap">
              <select
                value={filters.mileage ?? ""}
                onChange={(event) => onChange({ mileage: event.target.value })}
              >
                <option value="">Any mileage</option>
                {mileageOptions(cars, filters.mileage ?? "").map((value) => (
                  <option key={value} value={value}>
                    Up to {value.toLocaleString("en-GB")} miles
                  </option>
                ))}
              </select>
              <FilterIcon name="chevron" />
            </span>
          </label>
        ) : (
          <p className="multi-stock-empty-options">
            Mileage details are not supplied for this stock.
          </p>
        )}
      </FilterSection>
      <FilterSection
        title="Max Price"
        icon="price"
        count={
          Number(Boolean(filters.minPrice)) + Number(Boolean(filters.maxPrice))
        }
      >
        <Budget cars={cars} filters={filters} onChange={onChange} />
      </FilterSection>
      {facet("fuel")}
      {facet("transmission")}
      <FilterSection title="Vehicle Type" icon="vehicleType">
        <p className="multi-stock-empty-options">
          Vehicle type details are not supplied for this stock.
        </p>
      </FilterSection>
      <FilterSection title="ULEZ" icon="ulez" count={filters.ulez ? 1 : 0}>
        {hasUlezChoice ? (
          <label className="multi-stock-option">
            <input
              type="checkbox"
              checked={filters.ulez}
              aria-label="ULEZ compliant"
              aria-describedby={ulezCountId}
              onChange={(event) => onChange({ ulez: event.target.checked })}
            />
            <span className="multi-stock-checkbox" aria-hidden="true">
              <FilterIcon name="check" />
            </span>
            <span className="multi-stock-option__label">ULEZ compliant</span>
            <span className="multi-stock-option__count" aria-hidden="true">
              {ulezCount}
            </span>
            <span
              id={ulezCountId}
              className="sr-only"
            >{`${ulezCount} ${ulezCount === 1 ? "matching car" : "matching cars"}`}</span>
          </label>
        ) : (
          <p className="multi-stock-empty-options">
            No stock is currently confirmed ULEZ compliant.
          </p>
        )}
      </FilterSection>
    </>
  );
}

type Chip = {
  id: string;
  label: string;
  removeLabel: string;
  patch: Partial<StockFilters>;
};
function filterChips(
  filters: StockFilters,
  facets: ReturnType<typeof applyStockFilters>["facets"],
): Chip[] {
  const chips: Chip[] = [];
  for (const key of facetOrder)
    for (const value of selectedValues(filters, key)) {
      const option = facets[key].find(
        (option) => stockValueKey(option.value) === stockValueKey(value),
      );
      const label = option?.label ?? value,
        shown = key === "seats" ? `${label} seats` : label;
      chips.push({
        id: `${key}-${stockValueKey(value)}`,
        label: shown,
        removeLabel: `Remove ${facetNames[key].toLowerCase()} ${label} filter`,
        patch: toggleFacet(filters, key, value),
      });
    }
  if (filters.minPrice)
    chips.push({
      id: "min-price",
      label: `From ${formatPrice(Number(filters.minPrice))}`,
      removeLabel: "Remove minimum price filter",
      patch: { minPrice: "" },
    });
  if (filters.maxPrice)
    chips.push({
      id: "max-price",
      label: `Up to ${formatPrice(Number(filters.maxPrice))}`,
      removeLabel: "Remove maximum price filter",
      patch: { maxPrice: "" },
    });
  if (filters.mileage)
    chips.push({
      id: "mileage",
      label: `Up to ${Number(filters.mileage).toLocaleString("en-GB")} miles`,
      removeLabel: "Remove mileage filter",
      patch: { mileage: "" },
    });
  if (filters.ulez)
    chips.push({
      id: "ulez",
      label: "ULEZ compliant",
      removeLabel: "Remove ULEZ compliant filter",
      patch: { ulez: false },
    });
  if (filters.search)
    chips.push({
      id: "search",
      label: `“${filters.search}”`,
      removeLabel: "Remove keyword filter",
      patch: { search: "" },
    });
  return chips;
}

/** Controlled filter controls only. Vehicle cards and result layout remain with Home. */
export function MultiStockFilters({
  cars,
  filters,
  onChange,
  onClear,
  matchCount,
  onShowResults,
}: Props) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(filters.search);
  const searchId = useId(),
    change = useRef(onChange),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    afterShow = useRef(false),
    search = useRef<HTMLInputElement>(null);
  change.current = onChange;
  // Navigation/reset is authoritative even when it restores the same search text.
  useEffect(() => {
    setQuery(filters.search);
  }, [filters]);
  useEffect(() => {
    if (query === filters.search) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      change.current({ search: query });
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [query, filters.search]);
  useEffect(() => {
    const resize = () => {
      if (window.innerWidth >= 1024) setOpen(false);
    };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const { facets } = useMemo(
    () => applyStockFilters(cars, filters),
    [cars, filters],
  );
  const ulezCount = useMemo(
    () => applyStockFilters(cars, { ...filters, ulez: true }).total,
    [cars, filters],
  );
  const chips = filterChips(filters, facets),
    activeCount = chips.length;
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    setQuery("");
    onClear();
  };
  const clearSearch = () => {
    if (timer.current) clearTimeout(timer.current);
    setQuery("");
    onChange({ search: "" });
    search.current?.focus();
  };
  const apply = (patch: Partial<StockFilters>) => {
    if (timer.current) clearTimeout(timer.current);
    onChange({
      ...patch,
      ...(query !== filters.search && !Object.hasOwn(patch, "search")
        ? { search: query }
        : {}),
    });
  };
  const hasArrivalDates = cars.some((car) => arrivalTime(car) !== null);
  const panel = (
    <FilterPanel
      cars={cars}
      filters={filters}
      onChange={apply}
      facets={facets}
      ulezCount={ulezCount}
    />
  );
  return (
    <>
      <aside
        className="stock-filter-sidebar multi-stock-filters"
        aria-label="Filter cars"
      >
        <div className="multi-stock-sidebar-heading">
          <h2>Search Filters</h2>
          {(activeCount > 0 || query) && (
            <button type="button" onClick={clear}>
              <FilterIcon name="clear" />
              Clear All
            </button>
          )}
        </div>
        <div className="multi-stock-sidebar-scroll">{panel}</div>
      </aside>
      <div
        className="stock-catalogue-controls multi-stock-controls"
        data-testid="multi-stock-toolbar"
      >
        <div className="multi-stock-toolbar-row">
          <div className="multi-stock-search">
            <label htmlFor={searchId} className="sr-only">
              Search cars
            </label>
            <Search size={18} aria-hidden="true" />
            <input
              id={searchId}
              ref={search}
              type="search"
              value={query}
              maxLength={200}
              placeholder="Make, model or registration"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (timer.current) clearTimeout(timer.current);
                  onChange({ search: query });
                }
              }}
            />
            {query && (
              <button
                type="button"
                aria-label="Clear car search"
                onClick={clearSearch}
              >
                <FilterIcon name="close" />
              </button>
            )}
          </div>
          <label className="multi-stock-sort">
            <span className="sr-only">Sort cars</span>
            <FilterIcon name="sort" />
            <select
              value={filters.sort}
              onChange={(event) =>
                apply({ sort: event.target.value as StockFilters["sort"] })
              }
            >
              <option value="">Recommended</option>
              <option value="price-asc">Price: low to high</option>
              <option value="price-desc">Price: high to low</option>
              {(hasArrivalDates || filters.sort === "arrival-desc") && (
                <option value="arrival-desc">
                  {hasArrivalDates ? "Newest listed" : "Saved stock order"}
                </option>
              )}
              <option value="mileage-asc">Mileage: low to high</option>
              <option value="mileage-desc">Mileage: high to low</option>
              <option value="year-desc">Year: newest first</option>
              <option value="year-asc">Year: oldest first</option>
            </select>
            <FilterIcon name="chevron" />
          </label>
          <p
            className="multi-stock-count"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {matchCount} {matchCount === 1 ? "car" : "cars"}
          </p>
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                className="multi-stock-mobile-trigger"
                aria-label={`Filters${activeCount ? `, ${activeCount} active` : ""}`}
              >
                <FilterIcon name="filters" />
                Filters{activeCount > 0 && <span>{activeCount}</span>}
              </button>
            </SheetTrigger>
            <SheetContent
              side="left"
              className="multi-stock-drawer"
              onCloseAutoFocus={(event) => {
                if (afterShow.current) {
                  afterShow.current = false;
                  if (onShowResults) {
                    event.preventDefault();
                    onShowResults();
                  }
                } else if (window.innerWidth >= 1024) {
                  event.preventDefault();
                  search.current?.focus({ preventScroll: true });
                }
              }}
            >
              <span
                className="multi-stock-drawer-close-icon"
                aria-hidden="true"
              >
                <FilterIcon name="close" />
              </span>
              <SheetHeader className="multi-stock-drawer-heading space-y-0">
                <SheetTitle className="sr-only">Filter cars</SheetTitle>
                <p className="multi-stock-drawer-caption" aria-hidden="true">
                  Filters
                </p>
                <SheetDescription className="sr-only">
                  Results update as you choose.
                </SheetDescription>
              </SheetHeader>
              <div className="multi-stock-drawer-scroll">
                <div className="multi-stock-sidebar-heading">
                  <h2>Search Filters</h2>
                  {(activeCount > 0 || query) && (
                    <button type="button" onClick={clear}>
                      <FilterIcon name="clear" />
                      Clear All
                    </button>
                  )}
                </div>
                {panel}
              </div>
              <div className="multi-stock-drawer-footer">
                <button
                  type="button"
                  onClick={clear}
                  disabled={!activeCount && !query}
                  aria-label="Clear filters"
                >
                  <FilterIcon name="clear" />
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => {
                    afterShow.current = true;
                    setOpen(false);
                  }}
                >
                  Show {matchCount} {matchCount === 1 ? "car" : "cars"}
                </button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
        {chips.length > 0 && (
          <div
            className="multi-stock-applied"
            aria-label="Applied stock filters"
          >
            {chips.map((chip) => (
              <button
                key={chip.id}
                type="button"
                aria-label={chip.removeLabel}
                title={chip.label}
                onClick={() => {
                  if (chip.id === "search") clearSearch();
                  else apply(chip.patch);
                }}
              >
                <span>{chip.label}</span>
                <FilterIcon name="close" />
              </button>
            ))}
            <button
              type="button"
              className="multi-stock-clear-all"
              onClick={clear}
            >
              Clear all
            </button>
          </div>
        )}
      </div>
    </>
  );
}
