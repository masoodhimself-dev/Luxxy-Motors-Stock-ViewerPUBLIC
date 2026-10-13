import type { Car } from "./stock-context";
import { vehicleHistoryFacts } from "./vehicle-extra-facts";
import { vehicleBenefits } from "./vehicle-benefits";
import { formatCompactMileage } from "./utils";
export type SellingPoint = {
  id?: string;
  label: string;
  text: string;
  note?: string;
  href?: string;
};
/** Conservative, supplied-data-only highlights. Other facts remain in the normal specifications. */
export function vehicleSellingPoints(car: Car): SellingPoint[] {
  const benefits = vehicleBenefits(car);
  const points: SellingPoint[] = [
    benefits.ulez,
    benefits.lowMileage,
    benefits.lowAnnualTax,
    benefits.lowInsuranceGroup,
  ].filter((point): point is NonNullable<typeof point> => point !== null);
  const facts = vehicleHistoryFacts(car);
  const owners = facts.find((fact) => fact.label === "Previous keepers")?.value;
  if (owners && /^[12]$/.test(owners.trim()))
    points.push({
      label: "Previous keepers",
      text: `${owners.trim()} previous ${owners.trim() === "1" ? "keeper" : "keepers"}`,
    });
  const highlights = car.sourceExtras?.vehicleHighlights;
  const lowerMileage =
    Array.isArray(highlights) &&
    highlights.some((item) => {
      if (!item || typeof item !== "object") return false;
      const row = item as Record<string, unknown>;
      return row.key === "MileageLow" && row.quantifier === "LOW";
    });
  if (
    !benefits.lowMileage &&
    lowerMileage &&
    typeof car.mileage === "number" &&
    Number.isInteger(car.mileage) &&
    car.mileage >= 0
  )
    points.push({
      label: "Mileage",
      text: `${formatCompactMileage(car.mileage)} · below average`,
      note: "This car has covered fewer miles than comparable vehicles.",
    });
  const service = facts.find((fact) => fact.label === "Service history")?.value;
  if (
    service &&
    /^full(?: (?:dealership|dealer))?(?: service)?(?: history)?$/i.test(
      service.trim(),
    )
  )
    points.push({ label: "Service history", text: "Full service history" });
  return points;
}
