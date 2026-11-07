import type { Car } from "@/lib/stock-context";
import { arrivalTime } from "@/lib/stock-presentation";
import { createStockMatcher, getStockFacetValue, matchFacet } from "@workspace/vehicle-meta/stock-filters";
import { stockEngineGroup, stockFacetKeys, stockValueKey, type StockFacetOption, type StockFacets, type StockFilters } from "./types";

export { getStockFacetValue };

/** Unfiltered unknown values remain visible; choosing a numeric limit requires a known value. */
export function applyStockFilters(
  cars: ReadonlyArray<Car>,
  input: StockFilters,
): { items: Car[]; total: number; facets: StockFacets } {
  const { filters, matches, selections } = createStockMatcher(input);
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
