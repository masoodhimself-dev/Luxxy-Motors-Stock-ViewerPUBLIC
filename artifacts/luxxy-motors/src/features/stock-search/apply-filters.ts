import type { Car } from "@/lib/stock-context";
import { arrivalTime } from "@/lib/stock-presentation";
import { vehicleBenefits } from "@/lib/vehicle-benefits";
import { normaliseStockFilters } from "./url";
import {
  splitStockFacetValues,
  stockEngineGroup,
  stockFacetKeys,
  stockValueKey,
  type StockFacetKey,
  type StockFacetOption,
  type StockFacets,
  type StockFilters,
} from "./types";

export function getStockFacetValue(
  car: Car,
  key: StockFacetKey,
): string | null {
  if (key === "engine") {
    if (/^(electric|bev|battery electric)$/i.test(car.fuel?.trim() ?? ""))
      return null;
    const cc = car.engineCC;
    return typeof cc === "number" &&
      Number.isFinite(cc) &&
      cc >= 100 &&
      cc <= 20_000
      ? stockEngineGroup(`${cc}cc`)
      : stockEngineGroup(car.engineSize);
  }
  if (key === "seats")
    return typeof car.seats === "number" &&
      Number.isInteger(car.seats) &&
      car.seats > 0 &&
      car.seats <= 100
      ? String(car.seats)
      : null;
  const value = key === "transmission" ? car.transmission : car[key];
  return typeof value === "string" &&
    value.trim() &&
    !/^(unknown|n\/a|not specified|not provided|unspecified)$/i.test(
      value.trim(),
    )
    ? value.trim().replace(/\s+/g, " ")
    : null;
}

function matchFacet(car: Car, key: StockFacetKey, selection: string): boolean {
  const value = getStockFacetValue(car, key);
  if (value === null) return false;
  const wanted = stockValueKey(selection),
    actual = stockValueKey(value);
  if (key === "engine") return stockEngineGroup(selection) === value;
  if (key === "seats")
    return /^\d+$/.test(selection) && Number(selection) === Number(value);
  if (key === "fuel" && wanted === "hybrid & electric")
    return /hybrid|electric|^bev$/.test(actual);
  if (key === "transmission" && wanted === "automatic")
    return /automatic/.test(actual);
  return actual === wanted;
}

function matchesSearch(car: Car, search: string): boolean {
  const words = stockValueKey(search.slice(0, 200))
    .split(/\s+/)
    .filter(Boolean);
  const text = stockValueKey(
    [
      car.title,
      car.make,
      car.model,
      car.variant,
      car.trim,
      car.fuel,
      car.bodyType,
      car.colour,
      car.year,
    ]
      .filter((value) => value != null)
      .join(" "),
  );
  const registrations = [car.registration, car.plate, car.vrm]
    .filter((value): value is string => typeof value === "string")
    .map((value) => stockValueKey(value).replace(/[\s-]/g, ""));
  return words.every(
    (word) =>
      text.includes(word) ||
      registrations.some(
        (registration) =>
          Boolean(word.replace(/[\s-]/g, "")) &&
          registration.includes(word.replace(/[\s-]/g, "")),
      ),
  );
}

/** Unfiltered unknown values remain visible; choosing a numeric limit requires a known value. */
export function applyStockFilters(
  cars: ReadonlyArray<Car>,
  input: StockFilters,
): { items: Car[]; total: number; facets: StockFacets } {
  const filters = normaliseStockFilters(input);
  const selections = Object.fromEntries(
    stockFacetKeys.map((key) => [key, splitStockFacetValues(filters[key])]),
  ) as Record<StockFacetKey, string[]>;
  const searchMatches = new Map(
    cars.map((car) => [car, matchesSearch(car, filters.search)]),
  );
  const benefits = filters.ulez
    ? new Map(cars.map((car) => [car, Boolean(vehicleBenefits(car).ulez)]))
    : null;
  const matches = (car: Car, except?: StockFacetKey) => {
    if (!searchMatches.get(car)) return false;
    for (const key of stockFacetKeys)
      if (
        key !== except &&
        selections[key].length &&
        !selections[key].some((value) => matchFacet(car, key, value))
      )
        return false;
    if (filters.ulez && !benefits?.get(car)) return false;
    if (filters.minPrice || filters.maxPrice) {
      if (
        typeof car.price !== "number" ||
        !Number.isFinite(car.price) ||
        car.price <= 0
      )
        return false;
      if (filters.minPrice && car.price < Number(filters.minPrice))
        return false;
      if (filters.maxPrice && car.price > Number(filters.maxPrice))
        return false;
    }
    if (filters.mileage) {
      if (
        typeof car.mileage !== "number" ||
        !Number.isFinite(car.mileage) ||
        car.mileage < 0 ||
        car.mileage > Number(filters.mileage)
      )
        return false;
    }
    return true;
  };
  const items = cars.filter((car) => matches(car));
  const facets = Object.fromEntries(
    stockFacetKeys.map((key) => {
      const options = new Map<string, StockFacetOption>();
      const makes = selections.make;
      for (const car of cars) {
        if (
          key === "model" &&
          makes.length &&
          !makes.some((make) => matchFacet(car, "make", make))
        )
          continue;
        const value = getStockFacetValue(car, key);
        if (value !== null && !options.has(stockValueKey(value)))
          options.set(stockValueKey(value), {
            value,
            label: key === "engine" ? `${value}L` : value,
            count: 0,
          });
      }
      for (const selected of selections[key]) {
        const value =
          key === "engine"
            ? (stockEngineGroup(selected) ?? selected)
            : selected;
        if (!options.has(stockValueKey(value)))
          options.set(stockValueKey(value), {
            value,
            label:
              key === "engine" && stockEngineGroup(value)
                ? `${stockEngineGroup(value)}L`
                : value,
            count: 0,
          });
      }
      const candidates = cars.filter((car) => matches(car, key));
      for (const option of options.values())
        option.count = candidates.filter((car) =>
          matchFacet(car, key, option.value),
        ).length;
      const result = [...options.values()].sort((a, b) =>
        key === "engine" || key === "seats"
          ? Number(a.value) - Number(b.value)
          : a.label.localeCompare(b.label, "en-GB", {
              sensitivity: "base",
              numeric: true,
            }),
      );
      return [key, result];
    }),
  ) as StockFacets;
  if (filters.sort) {
    const descending = filters.sort.endsWith("-desc");
    const number = (car: Car): number | null =>
      filters.sort === "arrival-desc"
        ? arrivalTime(car)
        : filters.sort.startsWith("price-")
          ? car.price
          : filters.sort.startsWith("year-")
            ? car.year
            : car.mileage;
    items.sort((first, second) => {
      const a = number(first),
        b = number(second);
      const known = (value: number | null) =>
        typeof value === "number" &&
        Number.isFinite(value) &&
        (filters.sort.startsWith("price-")
          ? value > 0
          : filters.sort.startsWith("year-")
            ? value >= 1886
            : filters.sort.startsWith("mileage-")
              ? value >= 0
              : true);
      const knownA = known(a),
        knownB = known(b);
      if (!knownA || !knownB) return knownA ? -1 : knownB ? 1 : 0;
      return descending ? b! - a! : a! - b!;
    });
  }
  return { items, total: items.length, facets };
}
