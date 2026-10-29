import { useId, useRef, useState } from "react";
import type { Car } from "@/lib/stock-context";
import {
  formatMileage,
  formatPrice,
  getThumbnailUrl,
  vehicleDisplayTitle,
  vehicleRegistrationLabel,
} from "@/lib/utils";
import { matchesEnquiryCar } from "@/components/portal/quick-enquiry-cars";
import { CarFront, Check, Search } from "@/components/icons";
import { Input } from "@/components/ui/input";
import "./vehicle-chooser.css";

interface VehicleChooserProps {
  cars: Car[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  loading?: boolean;
  failed?: boolean;
  savedLabel?: string;
  lockedReason?: string;
}

function VehicleThumbnail({ car }: { car: Car }) {
  const src = getThumbnailUrl(car);
  const [failed, setFailed] = useState("");
  return src && failed !== src ? (
    <img src={src} alt="" loading="lazy" onError={() => setFailed(src)} />
  ) : (
    <span className="vehicle-chooser-placeholder">
      <CarFront aria-hidden="true" size={24} />
    </span>
  );
}

/** Chooses from stock already loaded by the caller; searching never changes a sale. */
export function VehicleChooser({
  cars,
  value,
  onChange,
  disabled = false,
  loading = false,
  failed = false,
  savedLabel,
  lockedReason,
}: VehicleChooserProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const selected = cars.find((car) => car.id === value);
  const matches = cars.filter((car) => matchesEnquiryCar(car, query));
  const showResults = !value || browsing || Boolean(query.trim());
  const choose = (car: Car) => {
    if (disabled || loading || failed) return;
    if (car.id !== value) onChange(car.id);
    setQuery("");
    setBrowsing(false);
    input.current?.focus();
  };

  return (
    <section className="vehicle-chooser" aria-label="Vehicle selection">
      <label htmlFor={id}>Which car is the customer buying?</label>
      <div className="vehicle-chooser-search">
        <Search size={19} aria-hidden="true" />
        <Input
          ref={input}
          id={id}
          type="search"
          aria-label="Search stock vehicles"
          aria-describedby={`${id}-hint`}
          value={query}
          disabled={disabled}
          placeholder="Search make, model, colour or registration"
          onChange={(event) => {
            setQuery(event.target.value);
            setBrowsing(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (matches.length === 1) choose(matches[0]);
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setQuery("");
              setBrowsing(false);
            }
          }}
        />
      </div>
      <p id={`${id}-hint`} className="vehicle-chooser-hint">
        Search in any order. Select a car to fill its registration and
        advertised price.
      </p>
      {value && (
        <div className="vehicle-chooser-selection">
          <p role="status">
            <Check size={16} aria-hidden="true" />
            <span>
              <strong>
                {selected
                  ? vehicleDisplayTitle(selected)
                  : savedLabel || "Saved vehicle"}
              </strong>{" "}
              selected{!selected && " · saved vehicle details kept"}
            </span>
          </p>
          <button
            type="button"
            disabled={disabled || loading || failed}
            onClick={() => {
              setQuery("");
              setBrowsing((current) => !current);
              input.current?.focus();
            }}
          >
            {browsing ? "Keep selected vehicle" : "Change vehicle"}
          </button>
        </div>
      )}
      {lockedReason && <p className="vehicle-chooser-hint">{lockedReason}</p>}
      {showResults && (
        <>
          <p className="vehicle-chooser-count" role="status">
            {loading
              ? "Loading stock…"
              : failed
                ? "Current stock could not load. Existing vehicle details are kept."
                : `${matches.length} ${matches.length === 1 ? "car" : "cars"} found`}
          </p>
          {!loading && !failed && (
            <div
              className="vehicle-chooser-results"
              aria-label="Matching stock vehicles"
            >
              {matches.map((car) => {
                const title = vehicleDisplayTitle(car);
                const facts = [
                  car.year,
                  car.variant || car.trim,
                  car.colour,
                  car.fuel,
                  car.transmission,
                  typeof car.mileage === "number"
                    ? formatMileage(car.mileage)
                    : car.mileageText,
                ]
                  .filter(Boolean)
                  .join(" · ");
                const identification = [
                  vehicleRegistrationLabel(car),
                  typeof car.price === "number"
                    ? formatPrice(car.price, car.currency)
                    : "Price not supplied",
                  car.inventoryStatus === "reserved" ? "Reserved" : null,
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <button
                    type="button"
                    key={car.id}
                    data-vehicle-id={car.id}
                    aria-label={`Choose ${title}${vehicleRegistrationLabel(car) ? ` · ${vehicleRegistrationLabel(car)}` : ""}`}
                    aria-pressed={value === car.id}
                    disabled={disabled}
                    onClick={() => choose(car)}
                  >
                    <VehicleThumbnail car={car} />
                    <span className="vehicle-chooser-summary">
                      <strong>{title}</strong>
                      <small>{facts}</small>
                      <small>{identification}</small>
                    </span>
                    {value === car.id && <Check size={18} aria-hidden="true" />}
                  </button>
                );
              })}
              {matches.length === 0 && (
                <p>
                  {cars.length
                    ? "No matching cars. Try fewer words or another registration."
                    : "No stock vehicles are available to select."}
                </p>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
