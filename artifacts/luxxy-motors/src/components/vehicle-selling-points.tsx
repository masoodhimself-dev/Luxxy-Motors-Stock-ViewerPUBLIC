import type { Car } from "@/lib/stock-context";
import {
  vehicleSellingPoints,
  type SellingPoint,
} from "@/lib/vehicle-selling-points";
import { TermHelp, VehicleTerm } from "./customer-help";
import "./vehicle-benefits.css";

/** The exact source-backed explanation is available on hover, focus and tap. */
export function VehicleSellingPoint({ point }: { point: SellingPoint }) {
  return point.note ? (
    <TermHelp text={point.note} ariaLabel={point.text}>
      {point.text}
    </TermHelp>
  ) : (
    <VehicleTerm label={point.label} value={point.text}>
      {point.text}
    </VehicleTerm>
  );
}

export function VehicleSellingPoints({
  car,
  compact = false,
}: {
  car: Car;
  compact?: boolean;
}) {
  const allPoints = vehicleSellingPoints(car);
  const points = compact ? allPoints.slice(0, 4) : allPoints;
  if (!points.length) return null;
  const ulez = points.find((point) => point.id === "ulez");
  return (
    <div
      className={`vehicle-benefit-summary ${compact ? "vehicle-benefit-summary-compact" : ""}`}
    >
      <ul aria-label="Vehicle highlights" className="vehicle-selling-points">
        {points.map((point) => (
          <li
            key={point.id ?? point.label}
            data-benefit={point.id ?? "history"}
          >
            <VehicleSellingPoint point={point} />
          </li>
        ))}
      </ul>
      {!compact && ulez?.href && (
        <p className="vehicle-benefit-check">
          Check this car’s registration before driving in the zone.{" "}
          <a href={ulez.href} target="_blank" rel="noopener noreferrer">
            Check with TfL
          </a>
        </p>
      )}
    </div>
  );
}
