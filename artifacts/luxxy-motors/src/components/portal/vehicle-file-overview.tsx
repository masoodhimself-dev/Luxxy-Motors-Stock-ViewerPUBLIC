import { useState, type ReactNode } from "react";
import { Camera, CarFront, ChevronRight } from "@/components/icons";
import { formatMileage, formatPrice, getSafeImageUrl, vehicleDisplayTitle } from "@/lib/utils";
import { orderVehiclePhotos } from "@/lib/vehicle-photography";
import { workspaceStatus } from "./cars-workspace-model";
import type { StaffCar } from "./staff-cars-query";

const londonDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
});
const dayLabel = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric",
});
const timestampLabel = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
function timestamp(when: string | null | undefined, format = dayLabel) {
  if (!when || !Number.isFinite(Date.parse(when))) return null;
  return <time dateTime={when}>{format.format(new Date(when))}</time>;
}

export function vehicleFileStockAge(firstSeen: string, now = new Date()) {
  const first = new Date(firstSeen);
  if (!Number.isFinite(first.getTime()) || first.getTime() > now.getTime()) return null;
  const days = Math.round((Date.parse(londonDay.format(now)) - Date.parse(londonDay.format(first))) / 86_400_000);
  return !days ? "Added today" : `${days.toLocaleString("en-GB")} ${days === 1 ? "day" : "days"}`;
}

export function VehicleFilePhoto({ car, onPhotos }: { car: StaffCar; onPhotos: () => void }) {
  const [failed, setFailed] = useState<Set<string>>(() => new Set());
  const [preview, setPreview] = useState<string>();
  const urls = orderVehiclePhotos(car.images, car.heroImage).map(getSafeImageUrl);
  const available = urls.filter((url) => !failed.has(url));
  const photo = preview && available.includes(preview) ? preview : available[0];
  const photoCount = urls.length;
  return (
    <section className="vehicle-file-sheet vehicle-file-photo">
      <div className="vehicle-file-sheet-heading">
        <h3>Vehicle photos</h3>
        {photoCount > 0 && (
          <button className="vehicle-file-link" type="button" onClick={onPhotos}>
            <Camera size={16} aria-hidden="true" /> All photos ({photoCount})
          </button>
        )}
      </div>
      {photo ? (
        <button className="vehicle-file-photo-frame" type="button" onClick={onPhotos}
          aria-label={`Open photos of ${vehicleDisplayTitle(car)}`}>
          <img src={photo} alt={vehicleDisplayTitle(car)} fetchPriority="high"
            onError={() => setFailed((last) => new Set([...last, photo]))} />
        </button>
      ) : (
        <div className="vehicle-file-photo-frame vehicle-file-photo-empty">
          <CarFront size={34} aria-hidden="true" />
          <span>{photoCount ? "Photo unavailable" : "No photos on file"}</span>
        </div>
      )}
      {available.length > 1 && (
        <div className="vehicle-file-photo-previews" role="group" aria-label="Photo previews">
          {available.slice(0, 3).map((url) => (
            <button type="button" key={url} aria-label={`Preview photo ${urls.indexOf(url) + 1}`}
              aria-pressed={photo === url} onClick={() => setPreview(url)}>
              <img src={url} alt="" loading="lazy" onError={() => setFailed((last) => new Set([...last, url]))} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function FactsList({ entries }: { entries: [string, ReactNode][] }) {
  return (
    <dl className="vehicle-file-data">
      {entries.map(([label, value]) => (
        <div key={label}><dt>{label}</dt><dd>{value || <span className="vehicle-file-unavailable">Not recorded</span>}</dd></div>
      ))}
    </dl>
  );
}

export function VehicleFileFacts({ car, mot, tax, onChecks }: {
  car: StaffCar; mot: ReactNode; tax: ReactNode; onChecks: () => void;
}) {
  const inStock = ["available", "reserved"].includes(workspaceStatus(car));
  const age = inStock ? vehicleFileStockAge(car.staff.firstSeenAt) : null;
  return (
    <>
      <div className="vehicle-file-sheet-heading"><h3>Vehicle details</h3></div>
      <FactsList entries={[
        ["MOT (DVSA)", mot],
        ["Tax (DVLA)", tax],
        ["Mileage", car.mileage != null ? formatMileage(car.mileage) : car.mileageText],
        ["Year", car.year],
        ["Fuel", car.fuel],
        ["Gearbox", car.transmission],
        [inStock ? "Time in stock" : "First seen in stock", inStock
          ? (age ? <>{age}<small>Since {timestamp(car.staff.firstSeenAt)}</small></> : null)
          : timestamp(car.staff.firstSeenAt)],
        ["Details last updated", car.staff.lastRecordedChange
          ? <>{timestamp(car.staff.lastRecordedChange.at, timestampLabel)}<small>{car.staff.lastRecordedChange.label}</small></>
          : null],
      ]} />
      <button className="vehicle-file-link vehicle-file-check-link" type="button" onClick={onChecks}>
        View DVLA &amp; MOT <ChevronRight size={16} aria-hidden="true" />
      </button>
    </>
  );
}

export function VehicleFileStock({ car, detailed = false }: { car: StaffCar; detailed?: boolean }) {
  const changes = car.staff.changes;
  const change = car.staff.lastRecordedChange;
  return (
    <>
      <FactsList entries={[
        ["Stock source", car.staff.source === "cazoo" ? "Cazoo" : "Auto Trader"],
        ["First seen in stock", timestamp(car.staff.firstSeenAt)],
        ["Last seen in feed", timestamp(car.staff.lastSeenAt, timestampLabel)],
        ...(detailed ? [["Details last updated", change ? <>{timestamp(change.at, timestampLabel)}<small>{change.label}</small></> : null] as [string, ReactNode]] : []),
      ]} />
      {workspaceStatus(car) === "missing" && (
        <p className="vehicle-file-stock-issue">Missing from the latest feed. This does not confirm a sale.</p>
      )}
      {detailed && (
        <div className="vehicle-file-changes">
          <h4>Recently recorded changes</h4>
          {changes.length ? (
            <ul>
              {changes.map((row, index) => (
                <li key={`${row.kind}-${row.at}-${index}`}>
                  <span>
                    {row.label}
                    {row.kind === "price" && row.before != null && row.after != null && (
                      <small>{formatPrice(row.before, car.currency)} → {formatPrice(row.after, car.currency)}</small>
                    )}
                  </span>
                  {timestamp(row.at)}
                </li>
              ))}
            </ul>
          ) : <p className="portal-car-muted">No recent stock changes recorded.</p>}
        </div>
      )}
    </>
  );
}
