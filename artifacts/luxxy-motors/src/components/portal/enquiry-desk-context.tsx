import type { Enquiry } from "@workspace/api-client-react";
import type { Car } from "@/lib/stock-context";
import { vehicleContent } from "@/lib/vehicle-content";
import {
  vehicleHistoryFacts,
  vehicleRunningCosts,
} from "@/lib/vehicle-extra-facts";
import {
  formatPrice,
  vehicleDisplayTitle,
  vehicleRegistrationLabel,
} from "@/lib/utils";
import { deskMatches } from "@/lib/enquiry-desk-model";
import { enquiryGroup, enquiryRootRecords } from "@/lib/enquiry-groups";
import { Button } from "@/components/ui/button";
import "./enquiry-history.css";

export function VehicleDeskContext({ car }: { car: Car }) {
  const content = vehicleContent(car);
  const facts = [
    ["Colour", car.colour],
    ["Registration", vehicleRegistrationLabel(car)],
    [
      "Mileage",
      car.mileage != null
        ? `${car.mileage.toLocaleString("en-GB")} miles`
        : null,
    ],
    ["Fuel", car.fuel],
    ["Gearbox", car.transmission],
  ].filter(([, value]) => value != null && value !== "");
  const history = vehicleHistoryFacts(car);
  if (car.writeOffCategory)
    history.push({ label: "Write-off category", value: car.writeOffCategory });
  const costs = vehicleRunningCosts(car);
  const factList = (rows: { label: string; value: string }[]) => (
    <dl className="enquiry-history-facts">
      {rows.map(({ label, value }, i) => (
        <div key={`${label}-${i}`}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
  return (
    <section
      className="enquiry-vehicle-context enquiry-history-vehicle"
      aria-label="Vehicle facts beside call notes"
    >
      <h3>Car details</h3>
      {factList(
        facts.map(([label, value]) => ({
          label: String(label),
          value: String(value),
        })),
      )}
      <section
        className="enquiry-history-vehicle-group"
        aria-label="Vehicle history"
      >
        <h4>Vehicle history</h4>
        {history.length ? (
          factList(history)
        ) : (
          <p className="enquiry-history-empty">
            Service history and previous keepers haven’t been recorded.
          </p>
        )}
      </section>
      {costs.length > 0 && (
        <details className="enquiry-history-vehicle-group">
          <summary>Running costs</summary>
          <div
            className="enquiry-vehicle-reference"
            tabIndex={0}
            role="region"
            aria-label="Vehicle running costs"
          >
            {factList(costs)}
          </div>
        </details>
      )}
      {content.description && (
        <details className="enquiry-history-vehicle-group">
          <summary>About this car</summary>
          <div
            className="enquiry-vehicle-reference"
            tabIndex={0}
            role="region"
            aria-label="Vehicle description"
          >
            <p className="enquiry-history-copy">{content.description}</p>
          </div>
        </details>
      )}
      {content.features.length > 0 && (
        <details className="enquiry-history-vehicle-group">
          <summary>
            Equipment <span>{content.features.length} features</span>
          </summary>
          <div
            className="enquiry-vehicle-reference"
            tabIndex={0}
            role="region"
            aria-label="Vehicle equipment"
          >
            <ul className="enquiry-history-equipment">
              {content.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          </div>
        </details>
      )}
    </section>
  );
}

export function DeskSearchResults({
  search,
  entries,
  allEntries = entries,
  cars,
  onEntry,
  onCar,
}: {
  search: string;
  entries: Enquiry[];
  allEntries?: Enquiry[];
  cars: Car[];
  onEntry: (entry: Enquiry) => void;
  onCar: (car: Car) => void;
}) {
  const matchingEntries = enquiryRootRecords(allEntries).filter((e) =>
    enquiryGroup(e, allEntries).some(
      (original) =>
        entries.some((item) => item.id === original.id) &&
        deskMatches(search, [
          original.customerName,
          original.phone,
          original.email,
          original.reference,
          original.vehicleTitle,
          original.vehicleRegistration,
        ]),
    ),
  );
  const matchingCars = cars.filter((c) =>
    deskMatches(search, [
      c.title,
      c.make,
      c.model,
      c.plate,
      c.vrm,
      c.registration,
      vehicleRegistrationLabel(c),
      c.advertId,
    ]),
  );
  return (
    <section
      aria-label="Workspace search results"
      className="enquiry-search-results grid gap-4 lg:grid-cols-2"
    >
      <div className="enquiry-search-group min-w-0 rounded border bg-white p-4">
        <h3 className="font-semibold">
          Enquiries & appointments ({matchingEntries.length})
        </h3>
        <ul className="mt-3 max-h-96 space-y-3 overflow-auto">
          {matchingEntries.map((e) => (
            <li key={e.id} className="border-t pt-2 text-sm">
              <Button
                variant="link"
                className="h-auto whitespace-normal p-0 text-left"
                onClick={() => onEntry(e)}
              >
                {e.customerName}
              </Button>
              <p>{e.vehicleTitle || "General enquiry"}</p>
              {e.vehicleRegistration && (
                <p className="text-xs text-muted-foreground">
                  {e.vehicleRegistration}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {e.phone} · {e.assignedToName || "Unassigned"}
              </p>
            </li>
          ))}
        </ul>
        {!matchingEntries.length && (
          <p className="mt-3 text-sm text-muted-foreground">
            No matching enquiries.
          </p>
        )}
      </div>
      <div className="enquiry-search-group min-w-0 rounded border bg-white p-4">
        <h3 className="font-semibold">Cars ({matchingCars.length})</h3>
        <ul className="mt-3 max-h-96 space-y-3 overflow-auto">
          {matchingCars.map((c) => (
            <li key={c.id} className="border-t pt-2 text-sm">
              <Button
                variant="link"
                className="h-auto whitespace-normal p-0 text-left"
                onClick={() => onCar(c)}
              >
                {vehicleDisplayTitle(c)}
              </Button>
              <p>
                {c.price == null ? "Price on request" : formatPrice(c.price)} ·{" "}
                {String(c.inventoryStatus || "Unconfirmed")}
              </p>
              <p className="text-xs">{vehicleRegistrationLabel(c)}</p>
            </li>
          ))}
        </ul>
        {!matchingCars.length && (
          <p className="mt-3 text-sm text-muted-foreground">
            No matching cars.
          </p>
        )}
      </div>
    </section>
  );
}
