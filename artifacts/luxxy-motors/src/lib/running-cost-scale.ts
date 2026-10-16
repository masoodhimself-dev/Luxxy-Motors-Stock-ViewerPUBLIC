import type { Car } from "./stock-context";
import { vehicleRunningCosts } from "./vehicle-extra-facts";

type Metric = "insurance" | "tax" | "co2" | "mpg";
function metric(label: string): Metric | null {
  if (/^insurance group$/i.test(label)) return "insurance";
  if (/^(?:tax per year|annual (?:road )?tax)$/i.test(label)) return "tax";
  if (/^(?:co₂|co2) emissions?$/i.test(label)) return "co2";
  if (/^(?:average|urban|extra urban|combined|fuel economy)$/i.test(label)) return "mpg";
  return null;
}
function number(value: string, kind: Metric): number | null {
  const patterns = {
    insurance: /^(?:group\s*)?([1-9]|[1-4]\d|50)\s*[ADEGPU]?$/i,
    tax: /^£\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)(?:\s*(?:per year|\/year))?$/i,
    co2: /^(\d+(?:\.\d+)?)\s*g\/km$/i,
    mpg: /^(\d+(?:\.\d+)?)\s*mpg$/i,
  };
  const match = value.trim().match(patterns[kind]);
  if (!match) return null;
  const result = Number(match[1].replaceAll(",", ""));
  return Number.isFinite(result) && result >= 0 && (kind !== "mpg" || result > 0) ? result : null;
}
export function runningCostScale(label: string, value: string, cars: Car[]) {
  const kind = metric(label);
  if (!kind) return null;
  const current = number(value, kind);
  if (current === null) return null;
  const values = kind === "insurance" ? [1, 50] : cars.flatMap(car => {
    const facts = vehicleRunningCosts(car).filter(fact => fact.label.toLowerCase() === label.toLowerCase());
    const parsed = facts.map(fact => number(fact.value, kind)).filter((n): n is number => n !== null);
    return new Set(parsed).size === 1 ? [parsed[0]] : [];
  });
  if (values.length < 2) return null;
  const min = Math.min(...values), max = Math.max(...values);
  if (max === min) return null;
  const relative = Math.max(0, Math.min(1, (current - min) / (max - min)));
  const position = (kind === "mpg" ? 1 - relative : relative) * 100;
  const rating = position <= 33.333 ? (kind === "mpg" ? "Better economy" : "Lower") : position <= 66.667 ? "Middle of scale" : (kind === "mpg" ? "Lower economy" : "Higher");
  return {
    position, rating,
    good: kind === "mpg" ? "Better economy" : "Lower",
    bad: kind === "mpg" ? "Lower economy" : "Higher",
    basis: kind === "insurance" ? "Insurance groups 1–50" : `Our stock: ${min}–${max}${kind === "tax" ? " £/year" : kind === "co2" ? " g/km" : " mpg"} · ${values.length} cars with figures`,
  };
}
