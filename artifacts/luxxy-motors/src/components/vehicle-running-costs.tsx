import type { Car } from "@/lib/stock-context";
import { vehicleHistoryFacts, vehicleListingHighlights, vehicleRunningCosts } from "@/lib/vehicle-extra-facts";

export function VehicleRunningCosts({ car }: { car: Car }) {
  const costs = vehicleRunningCosts(car);
  if (!costs.length) return null;
  return <section aria-labelledby="vehicle-running-costs-heading" className="mt-8 border-t border-border pt-7">
    <h2 id="vehicle-running-costs-heading" className="section-heading">Running costs</h2>
    <p className="mt-2 text-sm text-muted-foreground">Figures supplied with this vehicle listing. Actual fuel use and tax may vary.</p>
    <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden border border-border bg-border sm:grid-cols-3">
      {costs.map((fact) => <div key={fact.label} className="min-w-0 bg-card p-3 sm:p-4"><dt className="text-xs leading-5 text-muted-foreground">{fact.label}</dt><dd className="mt-1 break-words text-base font-semibold text-primary">{fact.value}</dd></div>)}
    </dl>
  </section>;
}

export function VehicleHistorySummary({ car }: { car: Car }) {
  const facts = vehicleHistoryFacts(car);
  if (!facts.length) return null;
  return <section aria-labelledby="vehicle-records-heading" className="mt-8 border-t border-border pt-7">
    <h2 id="vehicle-records-heading" className="section-heading">Ownership & service records</h2>
    <dl className="mt-4 grid gap-3 sm:grid-cols-3">{facts.map(fact => <div key={fact.label} className="border border-border bg-card p-4"><dt className="text-xs text-muted-foreground">{fact.label}</dt><dd className="mt-1 font-semibold">{fact.value}</dd></div>)}</dl>
    <p className="mt-3 text-xs text-muted-foreground">Information supplied with the listing. Please confirm records and included keys with the team.</p>
  </section>;
}

export function VehicleListingHighlights({ car }: { car: Car }) {
  const facts = vehicleListingHighlights(car);
  if (!facts.length) return null;
  return <section aria-labelledby="vehicle-listing-highlights" className="mt-8 border-t border-border pt-7">
    <h2 id="vehicle-listing-highlights" className="section-heading">Listing highlights</h2>
    <dl className="mt-4 grid gap-3 sm:grid-cols-2">{facts.map(fact => <div key={fact.label} className="border border-border bg-secondary/30 p-4"><dt className="font-semibold">{fact.label}</dt><dd className="mt-2 text-sm leading-6 text-muted-foreground">{fact.value}</dd></div>)}</dl>
    <p className="mt-3 text-xs text-muted-foreground">Comparisons are taken from the supplied listing and refer to similar vehicles.</p>
  </section>;
}
