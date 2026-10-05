import type { Car } from './stock-context';
import { vehicleHistoryFacts, vehicleRunningCosts } from './vehicle-extra-facts';
import { formatMileage } from './utils';
export type SellingPoint = { label: string; text: string; note?: string };
/** Conservative, supplied-data-only highlights. Other facts remain in the normal specifications. */
export function vehicleSellingPoints(car: Car): SellingPoint[] {
 const points: SellingPoint[] = [];
 const facts = vehicleHistoryFacts(car);
 const owners = facts.find(fact => fact.label === 'Previous keepers')?.value;
 if (owners && /^[12]$/.test(owners.trim())) points.push({ label: 'Previous keepers', text: `${owners.trim()} previous ${owners.trim() === '1' ? 'keeper' : 'keepers'}` });
 const tax = vehicleRunningCosts(car).find(fact => /^tax per year$/i.test(fact.label));
 if (tax && /^£\s*\d+(?:\.\d{1,2})?$/.test(tax.value.trim())) {
  const amount = Number(tax.value.replace(/[£\s]/g, ''));
  if (amount >= 0 && amount <= 35) points.push({ label: 'Annual tax', text: `£${amount} annual tax`, note: 'Annual tax figure supplied in the listing; confirm the current amount with the showroom.' });
 }
 const highlights = car.sourceExtras?.vehicleHighlights;
 const lowerMileage = Array.isArray(highlights) && highlights.some(item => {
  if (!item || typeof item !== 'object') return false;
  const row = item as Record<string, unknown>;
  return row.key === 'MileageLow' && row.quantifier === 'LOW';
 });
 if (lowerMileage && typeof car.mileage === 'number' && car.mileage >= 0) points.push({ label: 'Mileage', text: `${formatMileage(car.mileage)} · below average`, note: 'Lower than comparable vehicles according to the supplied listing.' });
 const service = facts.find(fact => fact.label === 'Service history')?.value;
 if (service && /^full(?: service)? history$/i.test(service.trim())) points.push({ label: 'Service history', text: 'Full service history' });
 return points.slice(0, 3);
}
