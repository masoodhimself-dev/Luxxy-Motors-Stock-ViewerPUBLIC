import { VehicleFactIcon } from "./vehicle-fact-icon";
import type { Car } from "@/lib/stock-context";
import {
  vehicleSellingPoints,
  type SellingPoint,
} from "@/lib/vehicle-selling-points";
import { TermHelp, VehicleTerm } from "./customer-help";
import "./vehicle-benefits.css";

/** The exact source-backed explanation is available on hover, focus and tap. */
export function VehicleSellingPoint({ point }: { point: SellingPoint }) {
  const content = <><VehicleFactIcon label={point.id === "ulez" ? "Emissions" : point.label} className="vehicle-highlight-icon" /><span>{point.text}</span></>;
  return point.note ? (
    <TermHelp text={point.note} ariaLabel={point.text}>
      {content}
    </TermHelp>
  ) : (
    <VehicleTerm label={point.label} value={point.text}>
      {content}
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

    </div>
  );
}
