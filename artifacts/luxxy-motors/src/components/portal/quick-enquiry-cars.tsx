import { useState } from "react";
import type { Car } from "@/lib/stock-context";
import { formatPrice, formatMileage, getSafeImageUrl, vehicleDisplayTitle, vehicleRegistrationLabel } from "@/lib/utils";
import { Search, CarFront, Check } from "lucide-react";

const words = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
const alias = (word: string) => ({ auto: "automatic", grey: "gray", gasoline: "petrol" }[word] || word);
export function matchesEnquiryCar(car: Car, query: string) {
  const fields = [car.title, car.make, car.model, car.variant, car.trim, car.year, car.colour, car.fuel, car.transmission, car.bodyType, car.engineSize, car.plate, car.vrm, car.registration, car.price, car.mileage];
  const haystack = words(fields.filter(value => value != null).join(" ")).map(alias);
  const plates = [car.plate, car.vrm].filter(Boolean).map(value => String(value).toLowerCase().replace(/[^a-z0-9]/g, ""));
  return words(query).every(word => haystack.some(value => value.startsWith(alias(word))) || plates.some(plate => plate.includes(word)));
}
function photo(car: Car) {
  const image = car.heroImage || car.images?.[0];
  return image ? getSafeImageUrl(image) : null;
}
function facts(car: Car) {
  return [car.year, car.colour, car.fuel, car.transmission, car.mileage != null ? formatMileage(car.mileage) : car.mileageText].filter(Boolean).join(" · ");
}
export function QuickEnquiryCars({ cars, value, onChange, disabled, loading, failed }: { cars: Car[]; value: string; onChange: (id: string) => void; disabled: boolean; loading: boolean; failed: boolean }) {
  const [query, setQuery] = useState("");
  const selected = cars.find(car => car.id === value);
  const matches = cars.filter(car => matchesEnquiryCar(car, query));
  return <section className="quick-car-search" aria-label="Find a car">
    <label htmlFor="quick-car-search"><strong>Which car are they calling about?</strong><span>Search in any order: make, model, colour, gearbox or number plate.</span></label>
    <div className="quick-car-search-input"><Search size={19} aria-hidden="true" /><input id="quick-car-search" type="search" autoFocus value={query} disabled={disabled} placeholder="Try Toyota black automatic or MG HS auto red" onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); if (!loading && !failed && matches.length === 1) { onChange(matches[0].id); setQuery(""); } } }} /></div>
    {(query || !selected) && <>
      <p role="status" className="quick-car-count">{loading ? "Loading stock…" : failed ? "Stock could not load. You can still take a general enquiry." : `${matches.length} ${matches.length === 1 ? "car" : "cars"} found`}</p>
      {!loading && !failed && <div className="quick-car-results" aria-label="Matching stock cars">{matches.map(car => <button type="button" key={car.id} disabled={disabled} aria-pressed={value === car.id} onClick={() => { onChange(car.id); setQuery(""); }}>
        {photo(car) ? <img src={photo(car)!} alt="" loading="lazy" /> : <CarFront aria-hidden="true" />}
        <span><strong>{vehicleDisplayTitle(car)}</strong><small>{facts(car)}</small><small>{[vehicleRegistrationLabel(car), car.price != null ? formatPrice(car.price, car.currency) : "Price not supplied", car.inventoryStatus].filter(Boolean).join(" · ")}</small></span>{value === car.id && <Check size={18} aria-hidden="true" />}
      </button>)}{matches.length === 0 && <p>No matching cars. Try fewer words or another spelling.</p>}</div>}
    </>}
    {selected && <article className="quick-car-selected" aria-label="Selected car">
      {photo(selected) && <img src={photo(selected)!} alt={vehicleDisplayTitle(selected)} />}
      <div><small>Selected car</small><h3>{vehicleDisplayTitle(selected)}</h3><p>{selected.variant || selected.trim}</p><p>{facts(selected)}</p><p>{[vehicleRegistrationLabel(selected), selected.engineSize, selected.bodyType].filter(Boolean).join(" · ")}</p><strong>{selected.price != null ? formatPrice(selected.price, selected.currency) : "Price not supplied"}</strong><p>{typeof selected.inventoryStatus === "string" ? selected.inventoryStatus : "Status not supplied"}</p></div>
    </article>}
    <button type="button" className="quick-car-general" disabled={disabled} onClick={() => { onChange(""); setQuery(""); }}>No specific car / general enquiry</button>
  </section>;
}
