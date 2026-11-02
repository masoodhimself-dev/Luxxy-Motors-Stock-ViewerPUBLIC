import { useState, useRef, useId, type RefObject } from "react";
import type { Car } from "@/lib/stock-context";
import {
  formatPrice,
  getSafeImageUrl,
  vehicleDisplayTitle,
  vehicleRegistrationLabel,
} from "@/lib/utils";
import { Search, CarFront, Check, ChevronDown } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { EnquiryVehicleInformation } from "./enquiry-vehicle-information";
import "./quick-enquiry-cars.css";

const words = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
const alias = (word: string) =>
  ({ auto: "automatic", grey: "gray", gasoline: "petrol" })[word] || word;
export function matchesEnquiryCar(car: Car, query: string) {
  const fields = [
    car.title,
    car.make,
    car.model,
    car.variant,
    car.trim,
    car.year,
    car.colour,
    car.fuel,
    car.transmission,
    car.bodyType,
    car.engineSize,
    car.plate,
    car.vrm,
    car.registration,
    car.price,
    car.mileage,
  ];
  const haystack = words(fields.filter((value) => value != null).join(" ")).map(
    alias,
  );
  const plates = [car.plate, car.vrm, car.registration]
    .filter(Boolean)
    .map((value) =>
      String(value)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, ""),
    );
  return words(query).every(
    (word) =>
      haystack.some((value) => value.startsWith(alias(word))) ||
      plates.some((plate) => plate.includes(word)),
  );
}
function photo(car: Car) {
  const image = car.heroImage || car.images?.[0];
  return image ? getSafeImageUrl(image) : null;
}
function CarIdentity({ car }: { car: Car }) {
  const image = photo(car);
  return <>
    {image ? <img src={image} alt="" loading="lazy" /> : <span className="quick-car-picker-placeholder"><CarFront size={22} aria-hidden="true" /></span>}
    <span className="quick-car-picker-identity">
      <strong>{vehicleDisplayTitle(car)}</strong>
      <span>{[vehicleRegistrationLabel(car), car.price != null ? formatPrice(car.price, car.currency) : "Price not supplied"].filter(Boolean).join(" · ")}</span>
    </span>
  </>;
}
export function QuickEnquiryCars({
  cars, value, onChange, disabled, loading, failed, inputRef, error,
}: {
  cars: Car[];
  value: string;
  onChange: (id: string) => void;
  disabled: boolean;
  loading: boolean;
  failed: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  error?: string;
}) {
  const id = useId();
  const searchId = `quick-car-picker-${id}`;
  const listId = `${searchId}-results`;
  const statusId = `${searchId}-status`;
  const errorId = `${searchId}-error`;
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [browse, setBrowse] = useState(false);
  const [limit, setLimit] = useState(5);
  const [active, setActive] = useState(-1);
  const [details, setDetails] = useState(false);
  const searchInput = useRef<HTMLInputElement | null>(null);
  const composing = useRef(false);
  const detailsTrigger = useRef<HTMLButtonElement>(null);
  const changeTrigger = useRef<HTMLButtonElement>(null);
  const selected = cars.find(car => car.id === value);
  const searching = !selected || editing || Boolean(error);
  const requested = open && (Boolean(query.trim()) || browse);
  const matches = cars.filter(car => matchesEnquiryCar(car, query));
  const visible = matches.slice(0, limit);
  const showResults = searching && requested && !loading && !failed;
  const hasOptions = showResults && visible.length > 0;
  const activeId = showResults && active >= 0 && active < visible.length ? `${listId}-${active}` : undefined;
  const optionLabel = (car: Car) => [vehicleDisplayTitle(car), vehicleRegistrationLabel(car), car.price != null ? formatPrice(car.price, car.currency) : "Price not supplied"].filter(Boolean).join(" · ");
  const focusSearch = () => requestAnimationFrame(() => searchInput.current?.focus());
  function choose(car: Car) {
    if (disabled) return;
    onChange(car.id);
    setQuery(""); setEditing(false); setOpen(false); setBrowse(false); setActive(-1); setLimit(5);
    requestAnimationFrame(() => changeTrigger.current?.focus());
  }
  function clear() {
    if (disabled) return;
    onChange(""); setQuery(""); setEditing(false); setOpen(false); setBrowse(false); setActive(-1); setLimit(5);
  }
  function dismiss() {
    setOpen(false); setActive(-1);
    if (selected) {
      setEditing(false); setQuery(""); setBrowse(false);
      requestAnimationFrame(() => changeTrigger.current?.focus());
    }
  }
  function move(direction: number) {
    if (disabled) return;
    setOpen(true);
    if (!query.trim()) setBrowse(true);
    if (loading || failed || visible.length === 0) return;
    const index = active < 0 ? (direction > 0 ? 0 : visible.length - 1) : (active + direction + visible.length) % visible.length;
    setActive(index);
    requestAnimationFrame(() => document.getElementById(`${listId}-${index}`)?.scrollIntoView?.({ block: "nearest" }));
  }
  const status = loading ? "Loading cars…" : failed ? "Cars could not load. You can still take a general enquiry." : matches.length === 0 ? "No matching cars. Try a make, model or registration." : `${matches.length} ${matches.length === 1 ? "car" : "cars"} found`;
  return (
    <section className="quick-car-picker" aria-label="Find a car" onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setActive(-1); }
    }}>
      {selected && !searching ? <>
        <article className="quick-car-picker-selected" aria-label="Selected car" aria-describedby={error ? errorId : undefined}>
          <CarIdentity car={selected} />
        </article>
        <div className="quick-car-picker-actions">
          <button type="button" ref={changeTrigger} disabled={disabled} onClick={() => { setEditing(true); setOpen(false); setActive(-1); focusSearch(); }}>Change car</button>
          <button type="button" ref={detailsTrigger} disabled={disabled} onClick={() => setDetails(true)}>Car details</button>
          <button type="button" disabled={disabled} onClick={clear}>No specific car</button>
        </div>
      </> : <>
        <label htmlFor={searchId}>Car <span>(optional)</span></label>
        {selected && <p className="quick-car-picker-current">Currently: {vehicleDisplayTitle(selected)} · {vehicleRegistrationLabel(selected)}</p>}
        {value && !selected && <p className="quick-car-picker-notice" role="status">{loading ? "Loading the selected car…" : failed ? "The selected car could not be loaded. Its selection has been kept." : "The selected car is no longer in this stock list. Choose another car or continue without a specific car."}</p>}
        <div className="quick-car-picker-input">
          <Search size={18} aria-hidden="true" />
          <input
            id={searchId}
            ref={node => { searchInput.current = node; if (inputRef) inputRef.current = node; }}
            role="combobox"
            type="text"
            autoComplete="off"
            aria-autocomplete="list"
            aria-expanded={hasOptions}
            aria-controls={hasOptions ? listId : undefined}
            aria-activedescendant={activeId}
            aria-invalid={error ? true : undefined}
            aria-describedby={[error ? errorId : "", requested || failed ? statusId : ""].filter(Boolean).join(" ") || undefined}
            value={query}
            disabled={disabled}
            placeholder="Make, model or reg"
            onChange={event => { setQuery(event.target.value); setOpen(Boolean(event.target.value.trim())); setBrowse(false); setActive(-1); setLimit(5); }}
            onFocus={() => { if (query.trim() || browse) setOpen(true); }}
            onCompositionStart={() => { composing.current = true; }}
            onCompositionEnd={() => { composing.current = false; }}
            onKeyDown={event => {
              if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault(); move(event.key === "ArrowDown" ? 1 : -1);
              } else if (event.key === "Enter") {
                event.preventDefault();
                if (showResults && !disabled) {
                  const choice = active >= 0 ? visible[active] : matches.length === 1 ? matches[0] : undefined;
                  if (choice) choose(choice);
                }
              } else if (event.key === "Escape" && (open || editing)) {
                event.preventDefault(); event.stopPropagation(); dismiss();
              }
            }}
          />
          <button type="button" className="quick-car-picker-browse" aria-label="Browse cars" title="Browse cars" disabled={disabled} onClick={() => { setBrowse(true); setOpen(true); setActive(-1); setLimit(5); focusSearch(); }}><ChevronDown size={18} aria-hidden="true" /></button>
        </div>
        {(requested || failed) && <p role="status" id={statusId} className="quick-car-picker-status">{status}</p>}
        {showResults && matches.length > 0 && <>
          <div id={listId} role="listbox" aria-label="Matching stock cars" className="quick-car-picker-results">
            {visible.map((car, index) => <button
              type="button" key={car.id} id={`${listId}-${index}`} role="option" tabIndex={-1}
              aria-label={optionLabel(car)} aria-selected={value === car.id}
              data-active={active === index} disabled={disabled}
              onMouseDown={event => event.preventDefault()}
              onMouseMove={() => setActive(index)}
              onClick={() => choose(car)}
            ><CarIdentity car={car} />{value === car.id && <Check size={16} aria-hidden="true" />}</button>)}
          </div>
          {matches.length > limit && <button type="button" className="quick-car-picker-more" disabled={disabled} onClick={() => setLimit(count => count + 5)}>Show more cars</button>}
        </>}
        {(selected || value || query.trim() || requested) && <div className="quick-car-picker-actions">
          {selected && <button type="button" disabled={disabled} onClick={dismiss}>Keep selected car</button>}
          {(value || query.trim() || requested) && <button type="button" disabled={disabled} onClick={clear}>No specific car</button>}
        </div>}
      </>}
      {error && <p id={errorId} role="alert" className="quick-car-picker-error">{error}</p>}
      {selected && details && <EnquiryVehicleInformation
        car={selected} returnFocusRef={detailsTrigger} onClose={() => setDetails(false)}
        actions={<Button type="button" onClick={() => setDetails(false)}>Back to enquiry</Button>}
      />}
    </section>
  );
}
