import { useIsMobile } from "@/hooks/use-mobile";
import { stockBodyTypes } from "@/lib/body-types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { arrivalTime } from "@/lib/stock-presentation";
import { useEffect, useMemo, useState, useRef } from "react";
import { ChevronDown, Search, SlidersHorizontal, X } from "@/components/icons";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Car as CarType } from "@/lib/stock-context";
import { stockBudgetOptions } from "@/lib/stock-budget-options";

export interface FilterState {
  make: string;
  model: string;
  minPrice: string;
  maxPrice: string;
  fuel: string;
  transmission: string;
  bodyType?: string;
  search: string;
  /** Optional for compatibility with saved searches created before benefit filters. */
  ulez?: boolean;
  sort:
    | "price-asc"
    | "price-desc"
    | "mileage-asc"
    | "mileage-desc"
    | "year-desc"
    | "arrival-desc"
    | "";
}

interface FiltersProps {
  cars: CarType[];
  filters: FilterState;
  setFilters: React.Dispatch<React.SetStateAction<FilterState>>;
  onSearch?: () => void;
  vehicleCount: number;
  matchCount?: number;
  quickFilters?: React.ReactNode;
  shortcuts?: React.ReactNode;
}

const emptyFilters: FilterState = {
  make: "",
  model: "",
  minPrice: "",
  maxPrice: "",
  fuel: "",
  transmission: "",
  bodyType: "",
  search: "",
  ulez: false,
  sort: "",
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
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary/50"
      />
    </span>
  );
}

export function Filters({
  cars,
  filters,
  setFilters,
  onSearch,
  vehicleCount,
  matchCount,
  quickFilters,
  shortcuts,
}: FiltersProps) {
  const mobileFilters = useIsMobile(1024);
  const filterButton = useRef<HTMLButtonElement>(null);
  const searchAfterClose = useRef(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [dialogBrandStyle, setDialogBrandStyle] =
    useState<React.CSSProperties>();
  const [budgetNotice, setBudgetNotice] = useState("");
  const toggleFilters = () => {
    if (!showAdvanced && filterButton.current) {
      // The Stock dialog is portalled outside the dealer's branded page shell.
      const style = window.getComputedStyle(filterButton.current);
      const tokens: Record<string, string> = {};
      // Portalled mobile filters must retain the full dealership panel palette.
      for (let i = 0; i < style.length; i++) {
        const key = style[i];
        if (key.startsWith("--dealer-") || key.startsWith("--premium-"))
          tokens[key] = style.getPropertyValue(key).trim();
      }
      setDialogBrandStyle(tokens as React.CSSProperties);
    }
    setShowAdvanced(!showAdvanced);
  };
  useEffect(() => {
    if (!mobileFilters) setShowAdvanced(false);
  }, [mobileFilters]);
  useEffect(() => {
    // Older saved browsing sessions may contain an impossible range.
    if (
      filters.minPrice &&
      filters.maxPrice &&
      Number(filters.minPrice) > Number(filters.maxPrice)
    ) {
      setFilters((current) => ({ ...current, minPrice: "" }));
      setBudgetNotice(
        "Minimum budget cleared because it exceeded your maximum budget.",
      );
    }
  }, [filters.minPrice, filters.maxPrice, setFilters]);
  const changeBudget = (key: "minPrice" | "maxPrice", value: string) => {
    const other = key === "minPrice" ? "maxPrice" : "minPrice";
    const conflict =
      value &&
      filters[other] &&
      (key === "minPrice"
        ? Number(value) > Number(filters.maxPrice)
        : Number(value) < Number(filters.minPrice));
    setFilters((current) => ({
      ...current,
      [key]: value,
      ...(conflict ? { [other]: "" } : {}),
    }));
    setBudgetNotice(
      conflict
        ? `${key === "minPrice" ? "Maximum" : "Minimum"} budget cleared to keep your selected price range valid.`
        : "",
    );
  };
  const appliedFilters: Array<{ key: keyof FilterState; label: string }> = [
    ...(filters.search
      ? [{ key: "search" as const, label: filters.search }]
      : []),
    ...(filters.make ? [{ key: "make" as const, label: filters.make }] : []),
    ...(filters.model ? [{ key: "model" as const, label: filters.model }] : []),
    ...(filters.minPrice
      ? [
          {
            key: "minPrice" as const,
            label: `From £${Number(filters.minPrice).toLocaleString("en-GB")}`,
          },
        ]
      : []),
    ...(filters.maxPrice
      ? [
          {
            key: "maxPrice" as const,
            label: `Up to £${Number(filters.maxPrice).toLocaleString("en-GB")}`,
          },
        ]
      : []),
    ...(filters.fuel ? [{ key: "fuel" as const, label: filters.fuel }] : []),
    ...(filters.bodyType
      ? [{ key: "bodyType" as const, label: filters.bodyType }]
      : []),
    ...(filters.transmission
      ? [{ key: "transmission" as const, label: filters.transmission }]
      : []),
    ...([["ulez", "ULEZ compliant"]] as const)
      .filter(([key]) => filters[key])
      .map(([key, label]) => ({ key, label })),
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
    // Linked shortcuts may use the canonical Automatic label while supplied
    // stock uses a case variant or a more detailed label such as Automatic DCT.
    if (filters.transmission) transmissionSet.add(filters.transmission);
    return Array.from(transmissionSet).sort();
  }, [cars, filters.transmission]);

  const bodyTypes = useMemo(() => stockBodyTypes(cars), [cars]);
  const activeFilterCount =
    Number(Boolean(filters.search)) +
    Number(Boolean(filters.make)) +
    Number(Boolean(filters.model)) +
    Number(Boolean(filters.minPrice || filters.maxPrice)) +
    Number(Boolean(filters.fuel)) +
    Number(Boolean(filters.transmission)) +
    Number(Boolean(filters.bodyType)) +
    Number(Boolean(filters.ulez));

  const maxBudgets = stockBudgetOptions(cars, filters.maxPrice);

  const handleSearchClick = () => {
    onSearch?.();
  };

  const resetFilters = () => {
    setFilters(emptyFilters);
    setBudgetNotice("");
  };

  const searchField = (
    <label className="stock-search-input relative block min-w-0">
      <span className="sr-only">Find your next car</span>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        aria-label="Search the showroom"
        data-testid="input-showroom-search"
        placeholder="Search cars"
        aria-describedby="stock-search-hint"
        value={filters.search}
        onChange={(event) =>
          setFilters((current) => ({ ...current, search: event.target.value }))
        }
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            handleSearchClick();
          }
        }}
        className="h-11 border-input bg-card pl-10 pr-11 text-base shadow-none"
      />
      {filters.search && (
        <button
          type="button"
          className="stock-clear-search absolute right-0 top-0 grid h-11 w-11 place-items-center"
          onClick={() => setFilters((current) => ({ ...current, search: "" }))}
        >
          <X aria-hidden="true" className="h-4 w-4" />
          <span className="sr-only">Clear search</span>
        </button>
      )}
    </label>
  );
  const fields = (
    <>
      <div className="stock-filter-primary">
        <Field label="Make">
          <Select
            ariaLabel="Make"
            value={filters.make}
            onChange={(make) =>
              setFilters((current) => ({ ...current, make, model: "" }))
            }
          >
            <option value="">Any make</option>
            {makes.map((make) => (
              <option key={make} value={make}>
                {make}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Model">
          <Select
            ariaLabel="Model"
            value={filters.model}
            disabled={!filters.make || !models.length}
            onChange={(model) =>
              setFilters((current) => ({ ...current, model }))
            }
          >
            <option value="">Any model</option>
            {models.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </Select>
        </Field>
        <fieldset className="stock-budget-range grid grid-cols-2 gap-3">
          <legend className="sr-only">Budget range</legend>
          <Field label="Min budget">
            <Select
              ariaLabel="Min budget"
              value={filters.minPrice}
              onChange={(value) => changeBudget("minPrice", value)}
            >
              <option value="">Any</option>
              {stockBudgetOptions(cars, filters.minPrice).map((price) => (
                <option key={price} value={String(price)}>
                  £{price.toLocaleString("en-GB")}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Max budget">
            <Select
              ariaLabel="Max budget"
              value={filters.maxPrice}
              onChange={(value) => changeBudget("maxPrice", value)}
            >
              <option value="">Any</option>
              {maxBudgets.map((price) => (
                <option key={price} value={String(price)}>
                  £{price.toLocaleString("en-GB")}
                </option>
              ))}
            </Select>
          </Field>
        </fieldset>
      </div>
      <details
        className="stock-more-filters"
        open={
          Boolean(filters.bodyType || filters.fuel || filters.transmission) ||
          undefined
        }
      >
        <summary>
          More filters <ChevronDown aria-hidden="true" className="h-4 w-4" />
        </summary>
        <div className="stock-filter-fields">
          <Field label="Body type">
            <Select
              ariaLabel="Body type"
              value={filters.bodyType ?? ""}
              onChange={(bodyType) =>
                setFilters((current) => ({ ...current, bodyType }))
              }
            >
              <option value="">Any body type</option>
              {filters.bodyType &&
                !bodyTypes.some((type) => type.label === filters.bodyType) && (
                  <option value={filters.bodyType}>{filters.bodyType}</option>
                )}
              {bodyTypes.map((type) => (
                <option key={type.label} value={type.label}>
                  {type.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Fuel">
            <Select
              ariaLabel="Fuel"
              value={filters.fuel}
              onChange={(fuel) =>
                setFilters((current) => ({ ...current, fuel }))
              }
            >
              <option value="">Any fuel</option>
              {fuels.map((fuel) => (
                <option key={fuel} value={fuel}>
                  {fuel}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Transmission">
            <Select
              ariaLabel="Transmission"
              value={filters.transmission}
              onChange={(transmission) =>
                setFilters((current) => ({ ...current, transmission }))
              }
            >
              <option value="">Any</option>
              {transmissions.map((transmission) => (
                <option key={transmission} value={transmission}>
                  {transmission}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </details>
      {shortcuts && <div className="stock-sidebar-shortcuts">{shortcuts}</div>}
      {quickFilters && (
        <div className="stock-quick-choices">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Other preferences
          </p>
          {quickFilters}
        </div>
      )}
      {budgetNotice && (
        <p className="mt-2 text-sm text-muted-foreground" role="status">
          {budgetNotice}
        </p>
      )}
    </>
  );
  return (
    <>
      {!mobileFilters && (
        <aside className="stock-filter-sidebar" aria-label="Filter cars">
          <div className="stock-sidebar-heading">
            <h2>Filter cars</h2>
            <button
              type="button"
              onClick={resetFilters}
              disabled={!activeFilterCount && !filters.sort}
            >
              Reset filters
            </button>
          </div>
          <div className="stock-sidebar-scroll">
            <div className="stock-sidebar-search">
              {searchField}
              <button
                type="button"
                className="stock-search-submit"
                onClick={handleSearchClick}
              >
                Search
              </button>
            </div>
            {fields}
          </div>
        </aside>
      )}
      <div
        className="stock-toolbar stock-catalogue-controls"
        data-testid="stock-search-toolbar"
      >
        <div className="stock-search-row">
          {mobileFilters && (
            <>
              {searchField}
              <button
                type="button"
                className="stock-filter-trigger"
                onClick={toggleFilters}
                aria-expanded={showAdvanced}
                ref={filterButton}
                aria-label="Advanced search"
                aria-controls="advanced-stock-filters"
              >
                <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
                Filters
                {activeFilterCount > 0 && <span>({activeFilterCount})</span>}
              </button>
            </>
          )}
          <p className="stock-controls-count">
            {matchCount ?? vehicleCount}{" "}
            {(matchCount ?? vehicleCount) === 1 ? "car" : "cars"}
            {activeFilterCount ? " found" : " available"}
          </p>
          <NativeSelect
            aria-label="Sort results"
            value={filters.sort}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                sort: event.target.value as FilterState["sort"],
              }))
            }
            className="stock-sort h-11 min-w-0 w-full border-input bg-card pl-3 pr-6 text-base shadow-none"
          >
            <option value="">Stock order</option>
            {cars.some((car) => arrivalTime(car) !== null) && (
              <option value="arrival-desc">Recently added</option>
            )}
            <option value="year-desc">Newest registration year</option>
            <option value="price-asc">Price: low to high</option>
            <option value="price-desc">Price: high to low</option>
            <option value="mileage-asc">Lowest mileage</option>
            <option value="mileage-desc">Highest mileage</option>
          </NativeSelect>
        </div>
        <p id="stock-search-hint" className="stock-search-hint">
          Search by make, model or registration.
        </p>
        {(activeFilterCount > 0 || filters.sort) && (
          <div className="stock-applied-filters" aria-label="Applied filters">
            {appliedFilters.map(({ key, label }) => (
              <button
                type="button"
                key={key}
                aria-label={`Remove ${label} filter`}
                onClick={() => {
                  setFilters((current) => ({
                    ...current,
                    [key]: typeof current[key] === "boolean" ? false : "",
                    ...(key === "make" ? { model: "" } : {}),
                  }));
                  setBudgetNotice("");
                }}
              >
                {label}
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            ))}
            <button type="button" onClick={resetFilters}>
              Reset all
            </button>
          </div>
        )}
      </div>
      <Dialog
        open={mobileFilters && showAdvanced}
        onOpenChange={setShowAdvanced}
      >
        <DialogContent
          style={dialogBrandStyle}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            // Reveal results only after the modal focus trap has been removed.
            // Otherwise its delayed focus restoration can steal focus on iPad.
            if (searchAfterClose.current) {
              searchAfterClose.current = false;
              handleSearchClick();
            } else {
              filterButton.current?.focus({ preventScroll: true });
            }
          }}
          className="stock-filter-dialog premium-stock-filter-dialog stock-sidebar-dialog flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-2xl"
        >
          <div className="stock-filter-heading">
            <DialogTitle>Filter used cars</DialogTitle>
            <DialogDescription>Results update as you choose.</DialogDescription>
          </div>
          <section
            id="advanced-stock-filters"
            className="stock-filter-body min-h-0 flex-1 overflow-y-auto"
          >
            {fields}
          </section>
          <div className="stock-filter-footer flex shrink-0 items-center justify-between gap-4 border-t">
            <button type="button" onClick={resetFilters}>
              Reset filters
            </button>
            <button
              type="button"
              className="stock-search-submit"
              onClick={() => {
                searchAfterClose.current = true;
                setShowAdvanced(false);
              }}
            >
              Show {matchCount ?? vehicleCount}{" "}
              {(matchCount ?? vehicleCount) === 1 ? "car" : "cars"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
