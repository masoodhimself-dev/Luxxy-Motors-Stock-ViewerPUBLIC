import { MotHistoryPanel } from "../mot-history";
import { useRef, type ReactNode, type RefObject } from "react";
import type { Car } from "@/lib/stock-context";
import { vehicleContent } from "@/lib/vehicle-content";
import { buyerInformation } from "@/lib/buyer-information";
import {
  vehicleDisplayTitle,
  vehicleRegistrationLabel,
  formatPrice,
} from "@/lib/utils";
import { Gallery } from "@/components/gallery";
import { HistoryLinks } from "./history-links";
import {
  vehicleHistoryFacts,
  vehicleRunningCosts,
  vehicleSpecificationGroups,
} from "@/lib/vehicle-extra-facts";
import "./staff-vehicle-information.css";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

// Read supplied structured facts, without exposing import bookkeeping or finance quotations.
function SuppliedFacts({
  value,
  depth = 0,
}: {
  value: unknown;
  depth?: number;
}): ReactNode {
  if (value == null || value === "" || depth > 6) return null;
  if (typeof value === "string" || typeof value === "number")
    return <span className="whitespace-pre-wrap break-words">{value}</span>;
  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>;
  if (Array.isArray(value))
    return (
      <ul className="space-y-2">
        {value.map((item, i) => (
          <li key={i}>
            <SuppliedFacts value={item} depth={depth + 1} />
          </li>
        ))}
      </ul>
    );
  if (typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.name === "string" && "value" in record)
    return (
      <div className="flex flex-wrap justify-between gap-x-5 border-b border-border py-1">
        <span>{record.name}</span>
        <SuppliedFacts value={record.value} depth={depth + 1} />
      </div>
    );
  if (typeof record.category === "string" && Array.isArray(record.items))
    return (
      <section className="my-3">
        <h4 className="mb-2 font-semibold">{record.category}</h4>
        <SuppliedFacts value={record.items} depth={depth + 1} />
      </section>
    );
  return (
    <dl className="space-y-2">
      {Object.entries(record)
        .filter(
          ([key, val]) =>
            val != null &&
            val !== "" &&
            !/finance|monthly|source|url|count/i.test(key),
        )
        .map(([key, val]) => (
          <div key={key}>
            <dt className="font-medium">
              {key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ")}
            </dt>
            <dd className="text-muted-foreground">
              <SuppliedFacts value={val} depth={depth + 1} />
            </dd>
          </div>
        ))}
    </dl>
  );
}

export function EnquiryVehicleInformation({
  car,
  onClose,
  presentation = "dialog",
  actions,
  canManage = true,
  returnFocusRef,
}: {
  car: Car;
  onClose: () => void;
  presentation?: "dialog" | "panel";
  actions?: ReactNode;
  canManage?: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const { description, features } = vehicleContent(car);
  const facts: [string, unknown][] = [
    [
      "Price",
      car.price == null ? "Not supplied" : formatPrice(car.price, car.currency),
    ],
    ["Year", car.year],
    [
      "Registration / plate",
      vehicleRegistrationLabel(car) || "Registration not supplied",
    ],
    ["Variant", car.variant],
    ["Trim", car.trim],
    [
      "Mileage",
      car.mileage == null
        ? car.mileageText
        : `${car.mileage.toLocaleString("en-GB")} miles`,
    ],
    ["Fuel", car.fuel],
    ["Transmission", car.transmission],
    ["Body", car.bodyType],
    ["Engine", car.engineSize || (car.engineCC ? `${car.engineCC} cc` : null)],
    ["Engine capacity", car.engineCC ? `${car.engineCC} cc` : null],
    ["Colour", car.colour],
    ["Doors", car.doors],
    ["Seats", car.seats],
    ["Owners", car.owners],
    ["Emission class", car.emissionClass],
    ["Drivetrain", car.drivetrain],
  ];
  const extra = car.sourceExtras ?? {};
  const runningCosts = vehicleRunningCosts(car);
  const recordFacts = vehicleHistoryFacts(car);
  const specificationGroups = vehicleSpecificationGroups(car);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className={`portal-action-dialog portal-action-dialog-wide enquiry-vehicle-dialog staff-vehicle-dialog${presentation === "panel" ? " staff-vehicle-panel" : ""}`}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          opener.current = returnFocusRef?.current ?? (
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null);
          heading.current?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (opener.current?.isConnected)
            opener.current.focus({ preventScroll: true });
        }}
      >
        <DialogHeader className="staff-vehicle-heading">
          <DialogTitle ref={heading} tabIndex={-1} className="pr-10">
            {vehicleDisplayTitle(car)}
          </DialogTitle>
          <DialogDescription>
            {car.variant || "Vehicle information for showroom staff"} ·{" "}
            {car.inventoryStatus === "available"
              ? "Available"
              : car.inventoryStatus === "reserved"
                ? "Reserved"
                : car.inventoryStatus === "sold"
                  ? "Sold"
                  : "Availability unconfirmed"}
          </DialogDescription>
        </DialogHeader>
        <div className="staff-vehicle-body">
          <HistoryLinks vehicleId={car.id} />
          {car.writeOffCategory && (
            <p className="staff-vehicle-disclosure">
              Recorded write-off category:{" "}
              <strong>{car.writeOffCategory}</strong>. Check the recorded
              history and disclosures before advising the customer.
            </p>
          )}
          <div className="enquiry-vehicle-overview grid min-w-0 gap-6 md:grid-cols-2">
            <div className="min-w-0">
              <Gallery
                images={car.images}
                heroImage={car.heroImage}
                vehicleLabel={vehicleDisplayTitle(car)}
              />
            </div>
            <section>
              <h3 className="mb-3 font-semibold">At a glance</h3>
              <dl className="enquiry-vehicle-facts divide-y divide-border text-sm">
                {facts
                  .filter(
                    ([, value]) =>
                      value !== null && value !== undefined && value !== "",
                  )
                  .map(([label, value]) => (
                    <div
                      key={label}
                      className="flex min-w-0 justify-between gap-4 py-2"
                    >
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="text-right font-medium">
                        {String(value)}
                      </dd>
                    </div>
                  ))}
              </dl>
            </section>
          </div>
          <details className="staff-vehicle-fact-group">
            <summary>History & condition</summary>
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              {buyerInformation(car)
                .filter(
                  (item) =>
                    ![
                      "Owners",
                      "Previous keepers",
                      "Service history",
                      "Keys",
                    ].includes(item.label),
                )
                .map((item) => (
                  <div key={item.label}>
                    <dt className="font-medium">{item.label}</dt>
                    <dd className="mt-1 text-muted-foreground">
                      {item.value || "Not supplied — check before confirming"}
                    </dd>
                  </div>
                ))}
            </dl>
            {typeof extra.writeOffCheck === "string" && (
              <p className="mt-3 text-sm">
                History check: {extra.writeOffCheck}
              </p>
            )}
          </details>
          {canManage && (
            <details className="staff-vehicle-fact-group">
              <summary>MOT history</summary>
              <MotHistoryPanel vehicleId={car.id} staff />
            </details>
          )}
          {description && (
            <section className="border-t border-border pt-4">
              <h3 className="mb-2 font-semibold">
                {car.sourceExtras?.descriptionOrigin === "generated-facts"
                  ? "Vehicle description · Generated from supplied facts"
                  : "Advert description"}
              </h3>
              <p className="whitespace-pre-wrap break-words text-sm leading-6">
                {description}
              </p>
            </section>
          )}
          {features.length > 0 && (
            <details className="staff-vehicle-fact-group">
              <summary>Features & equipment ({features.length})</summary>
              <ul className="grid list-inside list-disc gap-2 text-sm sm:grid-cols-2">
                {features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            </details>
          )}
          {runningCosts.length > 0 && (
            <details className="staff-vehicle-fact-group">
              <summary>Running costs</summary>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {runningCosts.map((fact) => (
                  <div
                    key={fact.label}
                    className="border border-border bg-muted/30 p-3"
                  >
                    <dt className="text-xs text-muted-foreground">
                      {fact.label}
                    </dt>
                    <dd className="mt-1 font-semibold">{fact.value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-xs text-muted-foreground">
                Figures supplied with the listing; actual fuel use and tax may
                vary.
              </p>
            </details>
          )}
          {recordFacts.length > 0 && (
            <details className="staff-vehicle-fact-group">
              <summary>Recorded history</summary>
              <dl className="grid gap-3 sm:grid-cols-3">
                {recordFacts.map((fact) => (
                  <div key={fact.label}>
                    <dt className="text-xs text-muted-foreground">
                      {fact.label}
                    </dt>
                    <dd className="mt-1 text-sm font-medium">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
          {specificationGroups.map((group, index) => (
            <details
              className="staff-vehicle-fact-group"
              key={`${group.title}-${index}`}
            >
              <summary>{group.title}</summary>
              <dl className="enquiry-vehicle-facts divide-y divide-border text-sm">
                {group.facts.map((fact, i) => (
                  <div
                    className="flex min-w-0 justify-between gap-4 py-2"
                    key={`${fact.label}-${i}`}
                  >
                    <dt className="text-muted-foreground">{fact.label}</dt>
                    <dd className="text-right font-medium">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            </details>
          ))}

          {(
            [
              [
                "Technical specifications",
                specificationGroups.length
                  ? null
                  : (extra.specCategories ?? car.specifications),
              ],
              ["Insurance group", extra.insuranceGroup],
            ] as [string, unknown][]
          )
            .filter(
              ([, value]) =>
                value != null && (!Array.isArray(value) || value.length),
            )
            .map(([label, value]) => (
              <details
                key={label}
                className="border-t border-border pt-2 text-sm"
              >
                <summary className="min-h-11 cursor-pointer py-3 font-semibold">
                  {label}
                </summary>
                <SuppliedFacts value={value} />
              </details>
            ))}
          <a
            href={`/vehicle/${encodeURIComponent(car.id)}`}
            target="_blank"
            rel="noreferrer"
            className="w-fit py-3 text-sm font-medium underline underline-offset-4"
          >
            Open customer vehicle page in a new tab
          </a>
        </div>
        {actions && <div className="staff-vehicle-actions">{actions}</div>}
      </DialogContent>
    </Dialog>
  );
}
