import type { ReactNode } from "react";
import type { Car } from "@/lib/stock-context";
import { vehicleContent } from "@/lib/vehicle-content";
import { buyerInformation } from "@/lib/buyer-information";
import { vehicleDisplayTitle, formatPrice } from "@/lib/utils";
import { Gallery } from "@/components/gallery";
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
}: {
  car: Car;
  onClose: () => void;
}) {
  const { description, features } = vehicleContent(car);
  const facts: [string, unknown][] = [
    ["Price", car.price == null ? null : formatPrice(car.price)],
    ["Year", car.year],
    ["Registration / plate", car.plate || car.vrm || car.registration],
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
    ["Colour", car.colour],
    ["Doors", car.doors],
    ["Seats", car.seats],
    ["Owners", car.owners],
    ["Emission class", car.emissionClass],
    ["Drivetrain", car.drivetrain],
    ["Advert reference", car.advertId],
  ];
  const extra = car.sourceExtras ?? {};
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-5xl">
        <DialogHeader>
          <DialogTitle className="pr-10">
            {vehicleDisplayTitle(car)}
          </DialogTitle>
          <DialogDescription>
            {car.variant || "Vehicle information for showroom staff"} ·{" "}
            {car.inventoryStatus === "available"
              ? "Available"
              : car.inventoryStatus === "reserved"
                ? "Reserved"
                : "Availability unconfirmed"}
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-w-0 gap-6 md:grid-cols-2">
          <div className="min-w-0">
            <Gallery
              images={car.images}
              heroImage={car.heroImage}
              vehicleLabel={vehicleDisplayTitle(car)}
            />
          </div>
          <section>
            <h3 className="mb-3 font-semibold">At a glance</h3>
            <dl className="divide-y divide-border text-sm">
              {facts
                .filter(
                  ([, value]) =>
                    value !== null && value !== undefined && value !== "",
                )
                .map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-4 py-2">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="text-right font-medium">{String(value)}</dd>
                  </div>
                ))}
            </dl>
          </section>
        </div>
        <section className="border-t border-border pt-4">
          <h3 className="mb-3 font-semibold">
            History, condition & preparation
          </h3>
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            {buyerInformation(car).map((item) => (
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
              Source history check: {extra.writeOffCheck}
            </p>
          )}
        </section>
        {description && (
          <section className="border-t border-border pt-4">
            <h3 className="mb-2 font-semibold">Advert description</h3>
            <p className="whitespace-pre-wrap break-words text-sm leading-6">
              {description}
            </p>
          </section>
        )}
        {features.length > 0 && (
          <section className="border-t border-border pt-4">
            <h3 className="mb-3 font-semibold">
              Features & equipment ({features.length})
            </h3>
            <ul className="grid list-inside list-disc gap-2 text-sm sm:grid-cols-2">
              {features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          </section>
        )}
        {(
          [
            [
              "Technical specifications",
              extra.specCategories ?? car.specifications,
            ],
            ["Running costs", extra.runningCosts],
            ["Insurance group", extra.insuranceGroup],
            ["Additional history", extra.historyExtras],
            ["Vehicle highlights", extra.vehicleHighlights],
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
      </DialogContent>
    </Dialog>
  );
}
