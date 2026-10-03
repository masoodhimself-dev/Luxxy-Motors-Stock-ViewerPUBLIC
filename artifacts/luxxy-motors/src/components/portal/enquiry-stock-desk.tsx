import { useState } from "react";
import { useStock, type Car } from "@/lib/stock-context";
import { vehicleDisplayTitle, formatPrice } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { vehicleEconomySummary } from "@/lib/vehicle-extra-facts";

export function EnquiryStockDesk({ onDetails, onChoose }: { onDetails: (car: Car) => void; onChoose: (car: Car, booking: boolean) => void }) {
  const { stock, isLoading, error } = useStock();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("name");
  const cars = (stock?.cars ?? []).filter(car =>
    [car.title, car.make, car.model, car.plate, car.vrm, car.registration, car.advertId].join(" ").toLowerCase().includes(search.trim().toLowerCase()) &&
    (status === "all" || car.inventoryStatus === status || (status === "unconfirmed" && !["available", "reserved"].includes(String(car.inventoryStatus))))
  ).sort((a, b) => sort === "name" ? vehicleDisplayTitle(a).localeCompare(vehicleDisplayTitle(b)) : sort === "price" ? (a.price ?? Infinity) - (b.price ?? Infinity) : (a.mileage ?? Infinity) - (b.mileage ?? Infinity));
  return <section className="space-y-4">
    <div className="grid gap-3 rounded-sm border border-slate-200 bg-white p-4 md:grid-cols-[2fr_1fr_1fr]">
      <label className="grid gap-1.5 text-sm font-medium">Search all cars<Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Make, model, registration or advert reference" /></label>
      <label className="grid gap-1.5 text-sm font-medium">Availability<NativeSelect aria-label="Stock availability" value={status} onChange={e => setStatus(e.target.value)}><option value="all">All statuses</option><option value="available">Available</option><option value="reserved">Reserved</option><option value="unconfirmed">Unconfirmed / other</option></NativeSelect></label>
      <label className="grid gap-1.5 text-sm font-medium">Sort cars<NativeSelect aria-label="Sort cars" value={sort} onChange={e => setSort(e.target.value)}><option value="name">Make and model</option><option value="price">Lowest price</option><option value="mileage">Lowest mileage</option></NativeSelect></label>
    </div>
    <div className="flex items-center justify-between gap-3 text-sm"><p role="status">{isLoading ? "Loading stock…" : `${cars.length} of ${stock?.cars.length ?? 0} cars`}</p><Button variant="ghost" size="sm" onClick={() => { setSearch(""); setStatus("all"); setSort("name"); }}>Reset filters</Button></div>
    {error && <p role="alert">Stock could not be loaded. Use Refresh to try again.</p>}
    <ul className="space-y-3">{cars.map(car => <li key={car.id} className="grid gap-4 border border-slate-200 bg-white p-4 shadow-sm xl:grid-cols-[1fr_auto]">
      <div className="flex min-w-0 gap-4">
        {car.heroImage && <img src={car.heroImage} alt="" loading="lazy" className="h-24 w-28 shrink-0 rounded-sm bg-slate-100 object-cover sm:w-36" onError={e => { e.currentTarget.style.display = "none"; }} />}
        <div className="min-w-0"><h3 className="font-semibold">{vehicleDisplayTitle(car)}</h3><p className="mt-1 text-sm text-muted-foreground">{[car.year, car.plate || car.vrm || car.registration, car.transmission, car.fuel, car.mileage != null ? `${car.mileage.toLocaleString("en-GB")} miles` : null].filter(Boolean).join(" · ")}</p><p className="mt-2 font-semibold">{car.price == null ? "Price on request" : formatPrice(car.price)}</p>{vehicleEconomySummary(car).length > 0 && <p className="mt-1 text-xs text-muted-foreground">{vehicleEconomySummary(car).join(" · ")}</p>}<p className="mt-1 text-xs text-muted-foreground">Advert {car.advertId} · {car.inventoryStatus === "available" ? "Available" : car.inventoryStatus === "reserved" ? "Reserved" : "Availability unconfirmed"}</p></div>
      </div>
      <div className="flex flex-wrap items-center gap-2 xl:max-w-72"><Button size="sm" variant="outline" onClick={() => onDetails(car)}>Vehicle information</Button><Button size="sm" variant="outline" onClick={() => onChoose(car, false)}>Log enquiry</Button><Button size="sm" disabled={car.inventoryStatus !== "available"} onClick={() => onChoose(car, true)}>Book test drive</Button></div>
    </li>)}</ul>
    {!isLoading && !error && !cars.length && <p className="border bg-white p-8 text-center text-muted-foreground">No cars match these filters.</p>}
    <p className="text-xs text-muted-foreground">Current inventory supplied by the stock system. Ad hoc enquiry vehicles are kept in enquiry history. Booking availability is checked again before saving.</p>
  </section>;
}
