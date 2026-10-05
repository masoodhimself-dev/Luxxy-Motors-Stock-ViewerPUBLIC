import type { Car } from "./stock-context";

type Fact = { label: string; value: string };
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : null;

export function vehicleRunningCosts(car: Car): Fact[] {
  const costs = record(car.sourceExtras?.runningCosts);
  if (!Array.isArray(costs?.items)) return [];
  return costs.items.flatMap(item => {
    const row = record(item);
    const label = text(row?.label);
    const value = text(row?.value);
    return label && value ? [{ label, value }] : [];
  });
}

export function vehicleHistoryFacts(car: Car): Fact[] {
  const history = record(car.sourceExtras?.historyExtras);
  const owners = record(history?.ownersData);
  const service = record(history?.serviceHistory);
  const rows = Array.isArray(history?.historyItems) ? history.historyItems : [];
  const byKey = (key: string) => rows.map(record).find(row => row?.key === key);
  const ownerValue = text(owners?.value) ?? text(byKey("OWNERS")?.value) ?? (car.owners != null ? String(car.owners) : null);
  const serviceValue = text(service?.description) ?? text(byKey("SERVICE_HISTORY")?.value) ?? text(car.sourceExtras?.serviceHistory);
  const keysRaw = text(byKey("KEYS")?.value);
  const keys = keysRaw && /^(contact seller|unknown|not supplied)$/i.test(keysRaw) ? null : keysRaw;
  return [ownerValue ? { label: "Previous keepers", value: ownerValue } : null, serviceValue ? { label: "Service history", value: serviceValue } : null, keys ? { label: "Keys supplied", value: keys } : null].filter((x): x is Fact => Boolean(x));
}

export function vehicleListingHighlights(car: Car): Fact[] {
  const highlights = car.sourceExtras?.vehicleHighlights;
  if (!Array.isArray(highlights)) return [];
  return highlights.flatMap(item => {
    const row = record(item);
    const title = text(row?.title);
    const descriptions = Array.isArray(row?.descriptionList) ? row.descriptionList.map(text).filter((x): x is string => Boolean(x)) : [];
    const description = (descriptions.join(" ") || text(row?.description))
      ?.replace(/\s{2,}/g, " ")
      .replace(/\bare in the is in\b/gi, "are in the")
      .trim();
    return title && description ? [{ label: title, value: description }] : [];
  }).slice(0, 4);
}

export function vehicleEconomySummary(car: Car): string[] {
  const costs = vehicleRunningCosts(car);
  const average = costs.find(x => x.label.toLowerCase() === "average");
  const tax = costs.find(x => /tax per year/i.test(x.label));
  return [average ? `${average.value} average` : null, tax ? `${tax.value} annual road tax` : null].filter((x): x is string => Boolean(x));
}

/** Read named specification rows, never dump arbitrary import metadata into the page. */
export function vehicleSpecificationGroups(car: Car): { title: string; facts: Fact[] }[] {
  const source = car.sourceExtras?.specCategories;
  if (!Array.isArray(source)) return [];
  return source.flatMap(item => {
    const group = record(item); const title = text(group?.category);
    if (!title || /finance|monthly|payment/i.test(title) || !Array.isArray(group?.items)) return [];
    const facts = group.items.flatMap(item => {
      const row = record(item); const label = text(row?.name ?? row?.label); const value = text(row?.value);
      return label && value && !/finance|monthly|payment/i.test(label) ? [{ label, value }] : [];
    });
    return facts.length ? [{ title, facts }] : [];
  });
}
export function vehicleBootSpace(car: Car): string | null {
  const row = vehicleSpecificationGroups(car).flatMap(group => group.facts).find(item => /^boot space \(seats up\)$/i.test(item.label));
  if (row) return row.value;
  const litres = car.specifications?.bootSpaceLitres ?? car.sourceExtras?.bootSpaceLitres;
  return typeof litres === 'number' && Number.isFinite(litres) && litres >= 0 ? `${litres} litres` : null;
}
