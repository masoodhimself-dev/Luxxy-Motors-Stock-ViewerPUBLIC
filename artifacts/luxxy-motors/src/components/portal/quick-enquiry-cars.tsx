import { useState } from "react";
import type { Car } from "@/lib/stock-context";
import { formatPrice, formatMileage, getSafeImageUrl, vehicleDisplayTitle, vehicleRegistrationLabel } from "@/lib/utils";
import { Search, CarFront, Check } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { vehicleContent, prioritiseVehicleFeatures, vehicleDescriptionParagraphs } from "@/lib/vehicle-content";
import { vehicleHistoryFacts, vehicleRunningCosts, vehicleSpecificationGroups, vehicleListingHighlights } from "@/lib/vehicle-extra-facts";

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
  const [details, setDetails] = useState(false);
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
      <div><small>Selected car</small><h3>{vehicleDisplayTitle(selected)}</h3><p>{selected.variant || selected.trim}</p><p>{facts(selected)}</p><p>{[vehicleRegistrationLabel(selected), selected.engineSize, selected.bodyType].filter(Boolean).join(" · ")}</p><strong>{selected.price != null ? formatPrice(selected.price, selected.currency) : "Price not supplied"}</strong><p>{typeof selected.inventoryStatus === "string" ? selected.inventoryStatus : "Status not supplied"}</p><Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setDetails(true)}>See car details</Button></div>
    </article>}
    <button type="button" className="quick-car-general" disabled={disabled} onClick={() => { onChange(""); setQuery(""); }}>No specific car / general enquiry</button>
    {selected && <Dialog open={details} onOpenChange={setDetails}><DialogContent className="portal-action-dialog quick-car-details-dialog"><DialogHeader><DialogTitle>{vehicleDisplayTitle(selected)}</DialogTitle><DialogDescription>Check the car while you’re on the call. Your enquiry stays open.</DialogDescription></DialogHeader><QuickCarDetails key={selected.id} car={selected} /><Button type="button" onClick={() => setDetails(false)}>Back to enquiry</Button></DialogContent></Dialog>}
  </section>;
}

function QuickCarDetails({ car }: { car: Car }) {
  const content = vehicleContent(car);
  const photos = (car.images?.length ? car.images : car.heroImage ? [car.heroImage] : []).map(getSafeImageUrl).filter(Boolean);
  const [selected, setSelected] = useState(0);
  const details = [
    ["Price", car.price != null ? formatPrice(car.price, car.currency) : "Price not supplied"],
    ["Registration", vehicleRegistrationLabel(car)], ["Year", car.year], ["Mileage", car.mileage != null ? formatMileage(car.mileage) : car.mileageText],
    ["Variant", car.variant], ["Trim", car.trim], ["Gearbox", car.transmission], ["Fuel", car.fuel], ["Colour", car.colour], ["Body", car.bodyType], ["Engine", car.engineSize], ["Engine capacity", car.engineCC != null ? `${car.engineCC} cc` : null], ["Drivetrain", car.drivetrain], ["Doors", car.doors], ["Seats", car.seats], ["Owners", car.owners], ["Emissions", car.emissionClass], ["Availability", typeof car.inventoryStatus === "string" ? car.inventoryStatus : ""],
  ].filter(([, value]) => value != null && value !== "");
  const factGroups = [
    { title: "Recorded history", facts: vehicleHistoryFacts(car) },
    { title: "Running costs", facts: vehicleRunningCosts(car) },
    { title: "Listing highlights", facts: vehicleListingHighlights(car) },
    ...vehicleSpecificationGroups(car),
  ].filter(group => group.facts.length > 0);
  return <div className="quick-car-details-content">
    {photos.length > 0 && <div className="quick-car-detail-gallery"><img className="quick-car-detail-main" src={photos[selected]!} alt={`${vehicleDisplayTitle(car)} · photo ${selected + 1}`} />{photos.length > 1 && <div className="quick-car-detail-thumbs" aria-label="Car photos">{photos.map((url, index) => <button type="button" key={`${url}-${index}`} aria-label={`View car photo ${index + 1}`} aria-pressed={selected === index} onClick={() => setSelected(index)}><img src={url!} alt="" loading="lazy" /></button>)}</div>}</div>}
    {car.writeOffCategory && <p className="quick-car-disclosure">Recorded write-off category: <strong>{car.writeOffCategory}</strong>. Check the recorded history and disclosures before advising the customer.</p>}
    <dl className="quick-car-details-facts">{details.map(([label, value]) => <div key={String(label)}><dt>{label}</dt><dd>{String(value)}</dd></div>)}</dl>
    {factGroups.map((group, index) => <details className="quick-car-fact-group" key={`${group.title}-${index}`}><summary>{group.title}<span>{group.facts.length} {group.facts.length === 1 ? "detail" : "details"}</span></summary><dl className="quick-car-details-facts">{group.facts.map((fact, index) => <div key={`${fact.label}-${index}`}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl></details>)}
    {content.description && <section><h3>About this car</h3>{vehicleDescriptionParagraphs(content.description).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</section>}
    <section><h3>Equipment</h3>{content.features.length ? <ul className="quick-car-detail-features">{prioritiseVehicleFeatures(content.features).map(feature => <li key={feature}>{feature}</li>)}</ul> : <p>No equipment list is recorded for this car.</p>}</section>
  </div>;
}
