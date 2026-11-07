import {
  splitStockFacetValues,
  stockEngineGroup,
  stockValueKey,
  type StockFilters,
  type StockSort,
} from "./stock-filter-types.ts";
export { splitStockFacetValues } from "./stock-filter-types.ts";

const sorts = new Set<StockSort>([
  "",
  "price-asc",
  "price-desc",
  "mileage-asc",
  "mileage-desc",
  "year-desc",
  "year-asc",
  "arrival-desc",
]);
const listKeys = [
  "make",
  "model",
  "fuel",
  "transmission",
  "bodyType",
  "colour",
] as const;
const numericText = (
  value: unknown,
  maximum: number,
  integer = false,
): string => {
  const raw =
    typeof value === "string" || typeof value === "number"
      ? String(value).trim()
      : "";
  if (!(integer ? /^\d+$/ : /^\d+(?:\.\d{1,2})?$/).test(raw)) return "";
  const number = Number(raw);
  return Number.isFinite(number) && number >= 0 && number <= maximum
    ? String(number)
    : "";
};

export function createStockFilters(): StockFilters {
  return {
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
    colour: "",
    engine: "",
    seats: "",
    mileage: "",
    page: 1,
  };
}

export function normaliseStockFilters(
  input: Partial<StockFilters>,
): StockFilters {
  const result = createStockFilters();
  for (const key of listKeys)
    result[key] = splitStockFacetValues(input[key]).join(",");
  result.engine = [
    ...new Set(
      splitStockFacetValues(input.engine)
        .map(stockEngineGroup)
        .filter((value): value is string => value !== null),
    ),
  ].join(",");
  result.seats = [
    ...new Set(
      splitStockFacetValues(input.seats)
        .map((value) => numericText(value, 100, true))
        .filter((value) => value && Number(value) > 0),
    ),
  ].join(",");
  result.minPrice = numericText(input.minPrice, 10_000_000);
  result.maxPrice = numericText(input.maxPrice, 10_000_000);
  // The chosen maximum wins over an impossible old/linked minimum budget.
  if (
    result.minPrice &&
    result.maxPrice &&
    Number(result.minPrice) > Number(result.maxPrice)
  )
    result.minPrice = "";
  result.mileage = numericText(input.mileage, 5_000_000, true);
  result.search =
    typeof input.search === "string" ? input.search.slice(0, 200) : "";
  result.ulez = input.ulez === true;
  result.sort =
    typeof input.sort === "string" && sorts.has(input.sort as StockSort)
      ? (input.sort as StockSort)
      : "";
  const page = typeof input.page === "number" ? input.page : Number(input.page);
  result.page =
    Number.isInteger(page) && page >= 1 && page <= 100_000 ? page : 1;
  return result;
}

export function parseStockFilters(params: URLSearchParams): StockFilters {
  const input: Partial<StockFilters> = {};
  for (const key of listKeys) {
    const alias =
      key === "bodyType" ? "body" : key === "transmission" ? "gearbox" : key;
    input[key] = params.getAll(params.has(key) ? key : alias).join(",");
  }
  for (const key of [
    "minPrice",
    "maxPrice",
    "engine",
    "seats",
    "mileage",
  ] as const)
    input[key] = params.getAll(key).join(",");
  input.search = params.get(params.has("search") ? "search" : "q") ?? "";
  input.ulez = params.get("ulez") === "true";
  input.sort = (params.get("sort") ?? "") as StockSort;
  const page = params.get("page");
  input.page = page && /^\d+$/.test(page) ? Number(page) : 1;
  return normaliseStockFilters(input);
}

export function serializeStockFilters(filters: StockFilters): URLSearchParams {
  const current = normaliseStockFilters(filters),
    params = new URLSearchParams();
  for (const key of [
    "make",
    "model",
    "minPrice",
    "maxPrice",
    "fuel",
    "transmission",
    "bodyType",
    "colour",
    "engine",
    "seats",
    "mileage",
  ] as const) {
    if (current[key]) params.set(key, current[key]!);
  }
  if (current.search.trim()) params.set("search", current.search.trim());
  if (current.ulez) params.set("ulez", "true");
  if (current.sort) params.set("sort", current.sort);
  if (current.page! > 1) params.set("page", String(current.page));
  return params;
}

const sameSelection = (first: string, second: string) =>
  JSON.stringify(splitStockFacetValues(first).map(stockValueKey).sort()) ===
  JSON.stringify(splitStockFacetValues(second).map(stockValueKey).sort());

/** Only deliberate make edits prune models, using actual stock relationships.
 * Missing inventory is not evidence that a saved model should be discarded. */
export function updateStockFilters(
  current: StockFilters,
  patch: Partial<StockFilters>,
  cars?: ReadonlyArray<{ make?: string | null; model?: string | null }>,
): StockFilters {
  const previous = normaliseStockFilters(current),
    merged = { ...previous, ...patch };
  const min = numericText(merged.minPrice, 10_000_000),
    max = numericText(merged.maxPrice, 10_000_000);
  if (min && max && Number(min) > Number(max)) {
    if (Object.hasOwn(patch, "minPrice") && !Object.hasOwn(patch, "maxPrice"))
      merged.maxPrice = "";
    else merged.minPrice = "";
  }
  const next = normaliseStockFilters(merged);
  if (!sameSelection(previous.make, next.make)) {
    const makes = new Set(splitStockFacetValues(next.make).map(stockValueKey));
    next.model = makes.size
      ? splitStockFacetValues(next.model)
          .filter((model) => {
            const matching = cars?.filter(
              (car) => stockValueKey(car.model) === stockValueKey(model),
            );
            return (
              !matching?.length ||
              matching.some((car) => makes.has(stockValueKey(car.make)))
            );
          })
          .join(",")
      : "";
  }
  if (
    Object.keys(patch).some(
      (key) =>
        key !== "page" &&
        previous[key as keyof StockFilters] !== next[key as keyof StockFilters],
    )
  )
    next.page = 1;
  return next;
}
