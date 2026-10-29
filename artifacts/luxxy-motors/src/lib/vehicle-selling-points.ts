import type { Car } from './stock-context';
import { vehicleHistoryFacts } from './vehicle-extra-facts';
import { vehicleBenefits } from './vehicle-benefits';
export type SellingPoint = { id?: string; label: string; text: string; note?: string; href?: string };
/** Factual highlights only; no insurance affordability or mileage comparisons. */
export function vehicleSellingPoints(car: Car): SellingPoint[] {
  const ulez = vehicleBenefits(car).ulez;
  const points: SellingPoint[] = ulez ? [ulez] : [];
  const engine = smallEnginePoint(car);
  if (engine) points.push(engine);
  const facts = vehicleHistoryFacts(car);
  const ownerFact = facts.find(fact => ['Owners','Previous keepers'].includes(fact.label));
  const owners = ownerFact?.value.trim();
  if (owners && /^\d+$/.test(owners)) points.push({ label: ownerFact!.label, text: ownerFact!.label === 'Previous keepers' ? `${owners} previous ${owners === '1' ? 'keeper' : 'keepers'}` : `${owners} ${owners === '1' ? 'owner' : 'owners'}` });
  const service = facts.find(fact => fact.label === 'Service history')?.value;
  if (service && /^full(?: (?:dealership|dealer))?(?: service)?(?: history)?$/i.test(service.trim())) points.push({ label: 'Service history', text: 'Full service history' });
  return points;
}

/** Exact supplied capacity takes priority over a rounded litre description. */
export function smallEnginePoint(car: Car): SellingPoint | null {
  if (/^(?:electric|battery electric|bev)$/i.test(car.fuel?.trim() || '')) return null;
  if (car.engineCC != null) {
    const cc = Number(car.engineCC);
    return Number.isInteger(cc) && cc > 0 && cc <= 1000
      ? { id: 'engine', label: 'Engine', text: `${cc}cc engine`, note: `Engine capacity: ${cc}cc.` }
      : null;
  }
  const size = car.engineSize?.trim() || '';
  const ccMatch = size.match(/^(\d{3,4})\s*cc$/i);
  if (ccMatch) return smallEnginePoint({ ...car, engineCC: Number(ccMatch[1]) });
  const litres = size.match(/^(\d+(?:\.\d+)?)\s*(?:l|litres?|liters?)$/i);
  const capacity = litres ? Number(litres[1]) : NaN;
  return capacity > 0 && capacity <= 1
    ? { id: 'engine', label: 'Engine', text: `${capacity.toFixed(1)}L engine`, note: `Supplied engine size: ${size}.` }
    : null;
}
