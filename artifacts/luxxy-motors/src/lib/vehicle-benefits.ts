import type { Car } from "./stock-context";
import { formatMileage } from "./utils";

export const ULEZ_CHECK_URL =
  "https://tfl.gov.uk/modes/driving/ultra-low-emission-zone/ulez-vrm-checker";
export const VEHICLE_BENEFIT_LIMITS = {
  mileage: 30_000,
  annualTax: 35,
  insuranceGroup: 15,
} as const;

export type VehicleBenefit = {
  id: "ulez" | "low-mileage" | "low-tax" | "low-insurance";
  label: string;
  text: string;
  note: string;
  href?: string;
};

export type VehicleBenefits = {
  ulez: VehicleBenefit | null;
  lowMileage: VehicleBenefit | null;
  lowAnnualTax: VehicleBenefit | null;
  lowInsuranceGroup: VehicleBenefit | null;
};

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";
const fieldKey = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]/g, "");
const annualTaxFields = new Set(["annualtax", "taxperyear", "annualroadtax"]);

function namedFields(car: Car, names: Set<string>): unknown[] {
  return [car, record(car.specifications), record(car.sourceExtras)].flatMap(
    (source) =>
      source
        ? Object.entries(source)
            .filter(([key]) => names.has(fieldKey(key)))
            .map(([, value]) => value)
        : [],
  );
}

function runningCostValues(car: Car, label: RegExp): unknown[] {
  const costs = record(car.sourceExtras?.runningCosts);
  return Array.isArray(costs?.items)
    ? costs.items.flatMap((item) => {
        const row = record(item);
        return row && label.test(text(row.label)) ? [row.value] : [];
      })
    : [];
}

/** Only explicitly annual figures qualify; CO₂, monthly payments and ambiguous road-tax fields do not. */
function annualTaxValue(car: Car): number | null {
  const supplied = [
    ...runningCostValues(
      car,
      /^(?:tax per year|annual (?:road )?tax|vehicle tax per year)$/i,
    ),
    ...namedFields(car, annualTaxFields),
  ];
  const amounts = supplied.flatMap((raw) => {
    if (typeof raw === "number")
      return Number.isFinite(raw) && raw >= 0 && Number(raw.toFixed(2)) === raw
        ? [raw]
        : [];
    const match = text(raw).match(
      /^(?:£\s*)?(\d+(?:\.\d{1,2})?)(?:\s*(?:\/\s*(?:year|yr)|per\s+(?:year|annum)|p\.?a\.?))?$/i,
    );
    return match ? [Number(match[1])] : [];
  });
  const distinct = [...new Set(amounts)];
  // A cheap figure must never win over a conflicting, higher supplied annual figure.
  return distinct.length === 1 ? distinct[0] : null;
}

function insuranceGroupValue(
  car: Car,
): { group: number; display: string } | null {
  const supplied = [
    ...runningCostValues(car, /^insurance group$/i),
    ...namedFields(car, new Set(["insurancegroup"])),
  ];
  const parsed = supplied.flatMap((raw) => {
    const value =
      typeof raw === "number" && Number.isFinite(raw) ? String(raw) : text(raw);
    // Preserve recognised security suffixes rather than inventing or dropping their meaning.
    const match = value.match(
      /^(?:group\s*)?([1-9]|[1-4]\d|50)\s*([ADEGPU])?(?:\s*(?:\/|of)\s*50)?$/i,
    );
    return match
      ? [{ group: Number(match[1]), suffix: (match[2] || "").toUpperCase() }]
      : [];
  });
  if (!parsed.length || new Set(parsed.map((item) => item.group)).size !== 1)
    return null;
  const suffixes = [
    ...new Set(parsed.map((item) => item.suffix).filter(Boolean)),
  ];
  if (suffixes.length > 1) return null;
  return {
    group: parsed[0].group,
    display: `${parsed[0].group}${suffixes[0] || ""}`,
  };
}

function ulezBenefit(car: Car): VehicleBenefit | null {
  // This is an emissions-standard comparison, never a registration or TfL lookup.
  // No date, model-name or variant-string inference is used.
  const emission = text(car.emissionClass).match(
    /^euro\s*([1-7])(?:\s*[a-e](?:-temp)?(?:-evap)?(?:\s+isc(?:-fcm)?)?)?$/i,
  );
  const fuel = text(car.fuel).toLowerCase().replace(/\s+/g, " ");
  const petrol =
    /^(?:petrol|petrol (?:plug-in )?hybrid|petrol[\s/]electric)$/.test(fuel);
  const diesel =
    /^(?:diesel|diesel (?:plug-in )?hybrid|diesel[\s/]electric)$/.test(fuel);
  if (!emission || (!petrol && !diesel)) return null;
  const euro = Number(emission[1]);
  if ((petrol && euro < 4) || (diesel && euro < 6)) return null;
  const stated = `${text(car.emissionClass)} ${diesel ? "diesel" : "petrol"}`;
  return {
    id: "ulez",
    label: "ULEZ",
    text: "ULEZ emissions standard met",
    note: `Meets the stated ULEZ emissions standard based on the supplied ${stated} facts. Confirm this vehicle with TfL before driving in the zone.`,
    href: ULEZ_CHECK_URL,
  };
}

/** Reusable, supplied-data-only decisions shared by vehicle highlights and stock filters. */
export function vehicleBenefits(car: Car): VehicleBenefits {
  const mileage = car.mileage;
  const tax = annualTaxValue(car);
  const insurance = insuranceGroupValue(car);
  return {
    ulez: ulezBenefit(car),
    lowMileage:
      typeof mileage === "number" &&
      Number.isInteger(mileage) &&
      mileage >= 0 &&
      mileage <= VEHICLE_BENEFIT_LIMITS.mileage
        ? {
            id: "low-mileage",
            label: "Mileage",
            text: `${formatMileage(mileage)} · low mileage`,
            note: "Supplied odometer reading of 30,000 miles or less; this is separate from ULEZ eligibility.",
          }
        : null,
    lowAnnualTax:
      tax !== null && tax <= VEHICLE_BENEFIT_LIMITS.annualTax
        ? {
            id: "low-tax",
            label: "Annual tax",
            text: `£${tax} annual tax · advertised`,
            note: "Annual tax figure supplied in the listing. Vehicle tax rules and rates can change; confirm the current amount before buying.",
          }
        : null,
    lowInsuranceGroup:
      insurance && insurance.group <= VEHICLE_BENEFIT_LIMITS.insuranceGroup
        ? {
            id: "low-insurance",
            label: "Insurance group",
            text: `Insurance group ${insurance.display}`,
            note: "Supplied group in the 1–15 range of the 1–50 scale. Lower groups may cost less to insure, but your premium depends on your circumstances and insurer; obtain a quote.",
          }
        : null,
  };
}
