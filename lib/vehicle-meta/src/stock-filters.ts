import { normaliseStockFilters, serializeStockFilters } from './stock-filter-url.ts';
import { splitStockFacetValues, stockEngineGroup, stockFacetKeys, stockValueKey, type StockFacetKey, type StockFilters } from './stock-filter-types.ts';
import { ulezReport, validatedCazooSourceReport } from './stock-source-ulez.ts';
export type { StockFilters } from './stock-filter-types.ts';

export interface StockFilterCar {
  title?: string | null;
  make?: string | null;
  model?: string | null;
  variant?: string | null;
  trim?: string | null;
  fuel?: string | null;
  transmission?: string | null;
  bodyType?: string | null;
  colour?: string | null;
  engineSize?: string | null;
  engineCC?: number | null;
  seats?: number | null;
  year?: number | null;
  registration?: string | null;
  plate?: string | null;
  vrm?: string | null;
  mileage?: number | null;
  price?: number | null;
  emissionClass?: string | null;
  sourceExtras?: unknown;
  advertId?: string | null;
  advertUrl?: string | null;
}

export function getStockFacetValue(
  car: StockFilterCar,
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

export function matchFacet(car: StockFilterCar, key: StockFacetKey, selection: string): boolean {
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

function matchesSearch(car: StockFilterCar, search: string): boolean {
  const words = stockValueKey(search.slice(0, 200))
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return true;
  const gearbox = stockValueKey(car.transmission ?? "");
  const automatic = /\b(?:auto(?:matic)?|[ed]?cvt|dsg|dct|tiptronic|steptronic|s[- ]?tronic)\b/.test(gearbox);
  const text = stockValueKey(
    [
      car.title,
      car.make,
      car.model,
      car.variant,
      car.trim,
      car.fuel,
      gearbox,
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
      (word === "auto" || word === "automatic"
        ? automatic || /\bauto(?:matic)?\b/.test(text)
        : text.includes(word)) ||
      registrations.some(
        (registration) =>
          Boolean(word.replace(/[\s-]/g, "")) &&
          registration.includes(word.replace(/[\s-]/g, "")),
      ),
  );
}

export function stockVehicleIsUlez(car: StockFilterCar): boolean {
  const report = ulezReport(validatedCazooSourceReport(car)?.ulez);
  const emission = car.emissionClass?.trim().match(/^euro\s*([1-7])(?:\s*[a-e](?:-temp)?(?:-evap)?(?:\s+isc(?:-fcm)?)?)?$/i);
  const fuel = car.fuel?.trim().toLowerCase().replace(/\s+/g, ' ') ?? '';
  const petrol = /^(?:petrol|petrol (?:plug-in )?hybrid|petrol[\s/]electric|hybrid - petrol\/electric)$/.test(fuel);
  const diesel = /^(?:diesel|diesel (?:plug-in )?hybrid|diesel[\s/]electric|hybrid - diesel\/electric)$/.test(fuel);
  const meetsStandard = Boolean(emission && ((petrol && +emission[1] >= 4) || (diesel && +emission[1] >= 6)));
  // An explicit negative result takes priority over a generic emissions comparison.
  return report ? report.status === 'compliant' : meetsStandard;
}

export function createStockMatcher(input: Partial<StockFilters>) {
  const filters = normaliseStockFilters(input);
  const selections = Object.fromEntries(
    stockFacetKeys.map(key => [key, splitStockFacetValues(filters[key])]),
  ) as Record<StockFacetKey, string[]>;
  const searchAndUlez = new WeakMap<StockFilterCar, boolean>();
  const matches = (car: StockFilterCar, except?: StockFacetKey) => {
    let eligible = searchAndUlez.get(car);
    if (eligible === undefined) {
      eligible = matchesSearch(car, filters.search) && (!filters.ulez || stockVehicleIsUlez(car));
      searchAndUlez.set(car, eligible);
    }
    if (!eligible) return false;
    for (const key of stockFacetKeys)
      if (
        key !== except &&
        selections[key].length &&
        !selections[key].some((value) => matchFacet(car, key, value))
      )
        return false;
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
  return { filters, matches, selections };
}

export function normaliseStockAlertCriteria(input: Partial<StockFilters>) {
  const filters = normaliseStockFilters({ ...input, sort: '', page: 1 });
  for (const key of stockFacetKeys) {
    filters[key] = splitStockFacetValues(filters[key]).map(stockValueKey).sort().join(',');
  }
  filters.search = stockValueKey(filters.search);
  return filters;
}

export function hasStockAlertCriteria(filters: StockFilters) {
  return serializeStockFilters({ ...filters, sort: '', page: 1 }).size > 0;
}

const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2, minimumFractionDigits: 0 });
const number = new Intl.NumberFormat('en-GB');

export function stockAlertCriteriaLabel(filters: StockFilters, includeKeyword = true) {
  return [
    filters.make && `Make: ${filters.make.split(',').join(', ')}`,
    filters.model && `Model: ${filters.model.split(',').join(', ')}`,
    filters.transmission && `Gearbox: ${filters.transmission.split(',').join(', ')}`,
    filters.fuel && `Fuel: ${filters.fuel.split(',').join(', ')}`,
    filters.bodyType && `Body type: ${filters.bodyType.split(',').join(', ')}`,
    filters.colour && `Colour: ${filters.colour.split(',').join(', ')}`,
    filters.engine && `Engine: ${filters.engine.split(',').map(value => `${value}L`).join(', ')}`,
    filters.seats && `Seats: ${filters.seats.split(',').join(', ')}`,
    filters.minPrice && `From ${money.format(Number(filters.minPrice))}`,
    filters.maxPrice && `Up to ${money.format(Number(filters.maxPrice))}`,
    filters.mileage && `Up to ${number.format(Number(filters.mileage))} miles`,
    filters.ulez && 'ULEZ compliant',
    filters.search && (includeKeyword ? `Search: ${filters.search}` : 'Keyword search'),
  ].filter(Boolean).join(' · ');
}
