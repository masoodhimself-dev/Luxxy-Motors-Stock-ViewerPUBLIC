import type { Car } from "@/lib/stock-context";
import { applyStockFilters } from "./apply-filters";
import { createStockFilters } from "./url";
import type { StockFilters } from "./types";

/** Count each proposed change against the full stock, never the empty result set. */
export function stockRecoverySuggestions(cars: Car[], filters: StockFilters) {
  const candidates: { label: string; patch: Partial<StockFilters> }[] = [];
  if (filters.minPrice || filters.maxPrice)
    candidates.push({
      label: "Remove price limits",
      patch: { minPrice: "", maxPrice: "" },
    });
  if (filters.maxPrice) {
    const maxPrice = Math.ceil((Number(filters.maxPrice) * 1.25) / 500) * 500;
    if (Number.isFinite(maxPrice))
      candidates.push({
        label: `Budget up to £${maxPrice.toLocaleString("en-GB")}`,
        patch: { maxPrice: String(maxPrice) },
      });
  }
  const choices = [
    ["search", "Remove search words"],
    ["transmission", "Any gearbox"],
    ["make", "Any make"],
    ["model", "Any model"],
    ["colour", "Any colour"],
    ["bodyType", "Any body type"],
    ["fuel", "Any fuel"],
    ["engine", "Any engine size"],
    ["seats", "Any seats"],
    ["mileage", "Any mileage"],
  ] as const;
  choices.forEach(([key, label]) => {
    if (filters[key])
      candidates.push({
        label,
        patch: key === "make" ? { make: "", model: "" } : { [key]: "" },
      });
  });
  if (filters.ulez)
    candidates.push({
      label: "Include all emissions standards",
      patch: { ulez: false },
    });
  return candidates
    .map((candidate) => ({
      ...candidate,
      count: applyStockFilters(cars, {
        ...createStockFilters(),
        ...filters,
        ...candidate.patch,
        page: 1,
      }).items.length,
    }))
    .filter((candidate) => candidate.count > 0)
    .sort((a, b) => a.count - b.count)
    .slice(0, 3);
}
