export type StockSort =
  | ""
  | "price-asc"
  | "price-desc"
  | "mileage-asc"
  | "mileage-desc"
  | "year-desc"
  | "year-asc"
  | "arrival-desc";

/** Existing public URL names remain canonical. Multi-select facets use CSV strings. */
export interface StockFilters {
  make: string;
  model: string;
  minPrice: string;
  maxPrice: string;
  fuel: string;
  transmission: string;
  bodyType: string;
  search: string;
  ulez: boolean;
  sort: StockSort;
  colour?: string;
  engine?: string;
  seats?: string;
  mileage?: string;
  /** The number of twelve-car batches to reveal; not an offset into stock. */
  page?: number;
}

export const stockFacetKeys = [
  "make",
  "model",
  "colour",
  "bodyType",
  "engine",
  "seats",
  "fuel",
  "transmission",
] as const;
export type StockFacetKey = (typeof stockFacetKeys)[number];
export type StockFacetOption = { value: string; label: string; count: number };
export type StockFacets = Record<StockFacetKey, StockFacetOption[]>;

export function stockValueKey(value: string | null | undefined): string {
  return (value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Bound untrusted linked selections, keeping the first supplied display spelling. */
export function splitStockFacetValues(
  value: string | null | undefined,
): string[] {
  if (typeof value !== "string") return [];
  const seen = new Set<string>();
  return value
    .slice(0, 5_000)
    .split(",")
    .map((item) => item.trim().replace(/\s+/g, " ").slice(0, 100))
    .filter((item) => {
      const key = stockValueKey(item);
      if (!key || seen.has(key) || seen.size >= 50) return false;
      seen.add(key);
      return true;
    });
}

/** A display-size group, never a claim of the vehicle's exact cylinder capacity. */
export function stockEngineGroup(
  value: string | number | null | undefined,
): string | null {
  if (value == null) return null;
  const match = String(value)
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*(cc|l|litres?|liters?)?$/i);
  if (!match) return null;
  let litres = Number(match[1]);
  if (match[2]?.toLowerCase() === "cc" || (!match[2] && litres >= 100))
    litres /= 1000;
  return Number.isFinite(litres) && litres >= 0.1 && litres <= 20
    ? (Math.round(litres * 10) / 10).toFixed(1)
    : null;
}
