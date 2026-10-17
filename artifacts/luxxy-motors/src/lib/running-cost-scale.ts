import type { Car } from "./stock-context";
import { vehicleRunningCosts, vehicleSpecificationGroups } from "./vehicle-extra-facts";

type Metric = "insurance" | "tax" | "co2" | "mpg";
function metric(label: string): Metric | null {
  label = label.replace(/\s*\(?\b(?:WLTP|NEDC)\b\)?\s*/gi, ' ').trim();
  if (/^insurance group$/i.test(label)) return "insurance";
  if (/^(?:tax per year|annual (?:road )?tax)$/i.test(label)) return "tax";
  if (/^(?:co₂|co2) emissions?$/i.test(label)) return "co2";
  if (/^(?:average|urban|extra urban|combined|fuel economy)$/i.test(label)) return "mpg";
  return null;
}
function number(value: string, kind: Metric): number | null {
  const patterns = {
    insurance: /^(?:group\s*)?([1-9]|[1-4]\d|50)\s*[ADEGPU]?$/i,
    tax: /^£\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)(?:\s*(?:per year|\/year))?\s*\*?$/i,
    co2: /^(\d+(?:\.\d+)?)\s*g\/km$/i,
    mpg: /^(\d+(?:\.\d+)?)\s*mpg$/i,
  };
  const match = value.trim().match(patterns[kind]);
  if (!match) return null;
  const result = Number(match[1].replaceAll(",", ""));
  return Number.isFinite(result) && result >= 0 && (kind !== "mpg" || result > 0) ? result : null;
}
function measurementCycle(car: Car, label: string): string | null {
  const costs = car.sourceExtras?.runningCosts;
  const title = costs && typeof costs === 'object' && !Array.isArray(costs) ? (costs as Record<string, unknown>).title : '';
  const text = [label, typeof title === 'string' ? title : '', ...vehicleSpecificationGroups(car).flatMap(group => [group.title, ...group.facts.map(fact => `${fact.label} ${fact.value}`)])].join(' ');
  const cycles = [...new Set(text.toUpperCase().match(/\b(?:WLTP|NEDC)\b/g) ?? [])];
  // A label tied to this figure takes precedence. Otherwise ambiguous/missing
  // test-cycle information cannot support a fair consumption comparison.
  return label.toUpperCase().match(/\b(?:WLTP|NEDC)\b/)?.[0] ?? (cycles.length === 1 ? cycles[0] : null);
}

export function runningCostScale(label: string, value: string, cars: Car[], currentCar?: Car) {
  const kind = metric(label);
  if (!kind) return null;
  const current = number(value, kind);
  if (current === null) return null;
  const needsCompatibleTest = kind === 'mpg' || kind === 'co2';
  const fuel = currentCar?.fuel?.trim().toLowerCase();
  const cycle = currentCar ? measurementCycle(currentCar, label) : null;
  if (needsCompatibleTest && (!fuel || !cycle)) return null;
  const seen = new Set<string>();
  const values = kind === "insurance" ? [1, 50] : cars.flatMap(car => {
    if (car.id && seen.has(car.id)) return [];
    if (car.id) seen.add(car.id);
    if (car.inventoryStatus && !['available', 'reserved'].includes(String(car.inventoryStatus))) return [];
    if (needsCompatibleTest && (car.fuel?.trim().toLowerCase() !== fuel || measurementCycle(car, label) !== cycle)) return [];
    if (kind === 'tax' && car.currency && car.currency.toUpperCase() !== 'GBP') return [];
    const facts = vehicleRunningCosts(car).filter(fact => fact.label.toLowerCase() === label.toLowerCase());
    const parsed = facts.map(fact => number(fact.value, kind)).filter((n): n is number => n !== null);
    return new Set(parsed).size === 1 ? [parsed[0]] : [];
  });
  if (kind !== 'insurance' && values.length < 3) return null;
  const min = Math.min(...values), max = Math.max(...values);
  if (max === min) return null;
  const relative = Math.max(0, Math.min(1, (current - min) / (max - min)));
  const position = (kind === "mpg" ? 1 - relative : relative) * 100;
  const rating = position <= 33.333 ? (kind === "mpg" ? "Better economy" : "Lower") : position <= 66.667 ? "Middle of scale" : (kind === "mpg" ? "Lower economy" : "Higher");
  return {
    position, rating,
    good: kind === "mpg" ? "Better economy" : "Lower",
    bad: kind === "mpg" ? "Lower economy" : "Higher",
    basis: kind === "insurance" ? "Insurance groups 1–50" : `${needsCompatibleTest ? `${currentCar!.fuel} · ${cycle}: ` : 'Our stock: '}${min}–${max}${kind === "tax" ? " £/year" : kind === "co2" ? " g/km" : " mpg"} · ${values.length} cars with figures`,
  };
}
