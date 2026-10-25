import { runningCostScale } from "@/lib/running-cost-scale";
import "./running-cost-scale.css";
import { VehicleFactIcon } from './vehicle-fact-icon';
import { VehicleTerm } from './customer-help';
import type { Car } from "@/lib/stock-context";
import { vehicleHistoryFacts, vehicleListingHighlights, vehicleRunningCosts, vehicleSpecificationGroups } from "@/lib/vehicle-extra-facts";

export function VehicleRunningCosts({ car, comparisonCars = [] }: { car: Car; comparisonCars?: Car[] }) {
  const costs = vehicleRunningCosts(car);
  if (!costs.length) return null;
  return <section aria-labelledby="vehicle-running-costs-heading" className="mt-8 border-t border-border pt-7">
    <h2 id="vehicle-running-costs-heading" className="section-heading">Running costs</h2>
    <p className="mt-2 text-sm text-muted-foreground">Supplied figures. Comparisons appear where enough compatible figures are available; your actual costs may vary.</p>
    <dl className="mt-4 grid grid-cols-2 gap-px overflow-hidden border border-border bg-border sm:grid-cols-3">
      {costs.map((fact) => <div key={fact.label} className="min-w-0 bg-card p-3 sm:p-4"><dt className="flex items-center gap-2 text-xs leading-5 text-muted-foreground"><VehicleTerm label={fact.label} value={fact.value}><VehicleFactIcon label={fact.label} value={fact.value} />{fact.label}</VehicleTerm></dt><dd className="mt-1 break-words text-base font-semibold text-primary">{fact.value}<RunningCostBar label={fact.label} value={fact.value} cars={comparisonCars} car={car} /></dd></div>)}
    </dl>
  </section>;
}

export function VehicleHistorySummary({ car }: { car: Car }) {
  const facts = vehicleHistoryFacts(car);
  if (!facts.length) return null;
  return <section aria-labelledby="vehicle-records-heading" className="mt-8 border-t border-border pt-7">
    <h2 id="vehicle-records-heading" className="section-heading">Ownership & service records</h2>
    <dl className="mt-4 grid gap-3 sm:grid-cols-3">{facts.map(fact => <div key={fact.label} className="border border-border bg-card p-4"><dt className="flex items-center gap-2 text-xs text-muted-foreground"><VehicleTerm label={fact.label} value={fact.value}><VehicleFactIcon label={fact.label} value={fact.value} />{fact.label}</VehicleTerm></dt><dd className="mt-1 font-semibold">{fact.value}</dd></div>)}</dl>
  </section>;
}

export function VehicleListingHighlights({ car }: { car: Car }) {
  const facts = vehicleListingHighlights(car);
  if (!facts.length) return null;
  return <section aria-labelledby="vehicle-listing-highlights" className="mt-8 border-t border-border pt-7">
    <h2 id="vehicle-listing-highlights" className="section-heading">How this car compares</h2>
    <dl className="mt-4 grid gap-3 sm:grid-cols-2">{facts.map(fact => <div key={fact.label} className="border border-border bg-secondary/30 p-4"><dt className="font-semibold">{fact.label}</dt><dd className="mt-2 text-sm leading-6 text-muted-foreground">{fact.value}</dd></div>)}</dl>
    <p className="mt-3 text-xs text-muted-foreground">These figures compare this car with similar vehicles.</p>
  </section>;
}

export function VehicleSpecificationDetails({ car }: { car: Car }) {
  const groups = vehicleSpecificationGroups(car);
  if (!groups.length) return null;
  return <div className="mt-5 divide-y divide-border">{groups.map(group => <details key={group.title} className="py-2"><summary className="flex min-h-12 cursor-pointer items-center text-sm font-semibold">{group.title} · {group.facts.length} {group.facts.length === 1 ? 'detail' : 'details'}</summary><dl className="grid gap-x-7 sm:grid-cols-2">{group.facts.map(fact => <div key={fact.label} className="flex justify-between gap-4 border-t border-border py-3 text-sm"><dt className="text-muted-foreground"><VehicleTerm label={fact.label} value={fact.value}>{fact.label}</VehicleTerm></dt><dd className="text-right font-medium">{fact.value}</dd></div>)}</dl></details>)}</div>;
}

function RunningCostBar({ label, value, cars, car }: { label: string; value: string; cars: Car[]; car: Car }) {
  const scale = runningCostScale(label, value, cars, car);
  if (!scale) return null;
  return <div className="running-cost-scale" role="img" aria-label={`${label}: ${value}. ${scale.rating}. ${scale.basis}. Green: ${scale.good}; red: ${scale.bad}.`}>
    <div className="running-cost-scale-track" aria-hidden="true">
      <span className="running-cost-scale-marker" style={{ left: `${scale.position}%` }} />
    </div>
    <div className="running-cost-scale-labels" aria-hidden="true"><span>{scale.good}</span><span>{scale.bad}</span></div>
    <p className="running-cost-scale-basis">{scale.rating} · {scale.basis}</p>
  </div>;
}
