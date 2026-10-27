import type { Car } from './stock-context';
import { vehicleHistoryFacts } from './vehicle-extra-facts';
import { vehicleBenefits } from './vehicle-benefits';
export type SellingPoint = { id?: string; label: string; text: string; note?: string; href?: string };
/** Factual highlights only; no insurance affordability or mileage comparisons. */
export function vehicleSellingPoints(car: Car): SellingPoint[] {
  const ulez = vehicleBenefits(car).ulez;
  const points: SellingPoint[] = ulez ? [ulez] : [];
  const facts = vehicleHistoryFacts(car);
  const ownerFact = facts.find(fact => ['Owners','Previous keepers'].includes(fact.label));
  const owners = ownerFact?.value.trim();
  if (owners && /^\d+$/.test(owners)) points.push({ label: ownerFact!.label, text: ownerFact!.label === 'Previous keepers' ? `${owners} previous ${owners === '1' ? 'keeper' : 'keepers'}` : `${owners} ${owners === '1' ? 'owner' : 'owners'}` });
  const service = facts.find(fact => fact.label === 'Service history')?.value;
  if (service && /^full(?: (?:dealership|dealer))?(?: service)?(?: history)?$/i.test(service.trim())) points.push({ label: 'Service history', text: 'Full service history' });
  return points;
}
