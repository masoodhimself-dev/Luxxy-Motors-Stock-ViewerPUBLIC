import type { ReactNode } from "react";
import { VehicleBadgeIcon } from "./vehicle-badge-icon";
import type { Car } from "@/lib/stock-context";
import {
  vehicleSellingPoints,
  type SellingPoint,
} from "@/lib/vehicle-selling-points";
import { TermHelp, VehicleTerm } from "./customer-help";
import "./vehicle-benefits.css";

/** The exact source-backed explanation is available on hover, focus and tap. */
export function VehicleSellingPoint({ point }: { point: SellingPoint }) {
  const content = <><VehicleBadgeIcon kind={point.id === "ulez" ? "ulez" : point.id === "engine" ? "engine" : /owner|keeper/i.test(point.label) ? "owners" : "service"} /><span>{point.text}</span></>;
  return point.note ? (
    <TermHelp text={point.note} ariaLabel={point.text} className="vehicle-badge">
      {content}
    </TermHelp>
  ) : (
    <VehicleTerm label={point.label} value={point.text} className="vehicle-badge">
      {content}
    </VehicleTerm>
  );
}

export function VehicleSellingPoints({
  car,
  compact = false,
  omitMileage = false,
  motBadge,
}: {
  car: Car;
  compact?: boolean;
  omitMileage?: boolean;
  motBadge?: ReactNode;
}) {
  const allPoints = vehicleSellingPoints(car).filter(point => !omitMileage || point.label !== "Mileage");
  const points = compact ? allPoints.slice(0, 3) : allPoints;
  if (!points.length && !motBadge) return null;
  return (
    <div
      className={`vehicle-benefit-summary ${compact ? "vehicle-benefit-summary-compact" : ""}`}
    >
      <ul aria-label="Vehicle highlights" className="vehicle-selling-points">
        {motBadge && <li data-benefit="mot">{motBadge}</li>}
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
