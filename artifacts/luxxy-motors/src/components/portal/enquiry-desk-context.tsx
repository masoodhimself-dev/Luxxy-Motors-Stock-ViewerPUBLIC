import type { Enquiry, StaffOnlineReservation } from '@workspace/api-client-react';
import type { Car } from '@/lib/stock-context';
import { vehicleContent } from '@/lib/vehicle-content';
import { vehicleHistoryFacts, vehicleRunningCosts } from '@/lib/vehicle-extra-facts';
import { formatPrice, vehicleDisplayTitle, vehicleRegistrationLabel } from '@/lib/utils';
import { deskMatches } from '@/lib/enquiry-desk-model';
import { enquiryGroup, enquiryRootRecords } from '@/lib/enquiry-groups';
import { Button } from '@/components/ui/button';
import type { Contact } from './enquiry-workspace-tools';

export function VehicleDeskContext({ car }: { car: Car }) {
  const content = vehicleContent(car);
  const facts = [
    ['Colour', car.colour], ['Registration', vehicleRegistrationLabel(car)],
    ['Mileage', car.mileage != null ? `${car.mileage.toLocaleString('en-GB')} miles` : null],
    ['Fuel / gearbox', [car.fuel, car.transmission].filter(Boolean).join(' · ')],
  ].filter(([,value]) => value != null && value !== '');
  const additionalFacts = [...vehicleHistoryFacts(car), ...vehicleRunningCosts(car)];
  const factList = (rows: { label: string; value: string }[]) => <dl className="text-sm">{rows.map(({label,value}, i) => <div key={`${label}-${i}`} className="flex flex-wrap justify-between gap-2 border-b py-2"><dt className="text-muted-foreground">{label}</dt><dd className="font-medium">{value}</dd></div>)}</dl>;
  return <section className="enquiry-vehicle-context mt-4 space-y-3 border-t pt-3" aria-label="Vehicle facts beside call notes"><h3 className="font-semibold">At hand during the call</h3>{factList(facts.map(([label,value]) => ({label: String(label), value: String(value)})))}{additionalFacts.length > 0 && <details><summary className="cursor-pointer py-2 text-sm font-semibold">History & running costs</summary>{factList(additionalFacts)}</details>}{content.description && <details><summary className="cursor-pointer py-2 text-sm font-semibold">Description</summary><p className="whitespace-pre-wrap text-sm leading-6">{content.description}</p></details>}{content.features.length > 0 && <details><summary className="cursor-pointer py-2 text-sm font-semibold">Equipment · {content.features.length} features</summary><ul className="list-inside list-disc text-sm leading-6">{content.features.map(feature => <li key={feature}>{feature}</li>)}</ul></details>}</section>;
}

export function DeskSearchResults({ search, entries, allEntries = entries, reservations, cars, onEntry, onCar, onContact }: { search: string; entries: Enquiry[]; allEntries?: Enquiry[]; reservations: StaffOnlineReservation[]; cars: Car[]; onEntry: (entry: Enquiry) => void; onCar: (car: Car) => void; onContact: (contact: Contact) => void }) {
  const matchingEntries = enquiryRootRecords(allEntries).filter(e => enquiryGroup(e, allEntries).some(original => entries.some(item => item.id === original.id) && deskMatches(search, [original.customerName,original.phone,original.email,original.reference,original.vehicleTitle,original.vehicleRegistration])));
  const matchingCars = cars.filter(c => deskMatches(search, [c.title,c.make,c.model,c.plate,c.vrm,c.registration,vehicleRegistrationLabel(c),c.advertId]));
  const matchingReservations = reservations.filter(r => deskMatches(search, [r.reference,r.customerName,r.phone,r.email,r.vehicleTitle,r.vehicleRegistration]));
  return <section aria-label="Workspace search results" className="enquiry-search-results grid gap-4 lg:grid-cols-3">
    <div className="enquiry-search-group min-w-0 rounded border bg-white p-4"><h3 className="font-semibold">Enquiries & appointments ({matchingEntries.length})</h3><ul className="mt-3 max-h-96 space-y-3 overflow-auto">{matchingEntries.map(e => <li key={e.id} className="border-t pt-2 text-sm"><Button variant="link" className="h-auto whitespace-normal p-0 text-left" onClick={() => onEntry(e)}>{e.customerName} · {e.reference}</Button><p>{e.vehicleTitle || 'General enquiry'}</p>{e.vehicleRegistration && <p className="text-xs text-muted-foreground">{e.vehicleRegistration}</p>}<p className="text-xs text-muted-foreground">{e.phone} · {e.assignedToName || 'Unassigned'}</p></li>)}</ul>{!matchingEntries.length && <p className="mt-3 text-sm text-muted-foreground">No matching enquiries.</p>}</div>
    <div className="enquiry-search-group min-w-0 rounded border bg-white p-4"><h3 className="font-semibold">Cars ({matchingCars.length})</h3><ul className="mt-3 max-h-96 space-y-3 overflow-auto">{matchingCars.map(c => <li key={c.id} className="border-t pt-2 text-sm"><Button variant="link" className="h-auto whitespace-normal p-0 text-left" onClick={() => onCar(c)}>{vehicleDisplayTitle(c)}</Button><p>{c.price == null ? 'Price on request' : formatPrice(c.price)} · {String(c.inventoryStatus || 'Unconfirmed')}</p><p className="text-xs">{vehicleRegistrationLabel(c)}</p></li>)}</ul>{!matchingCars.length && <p className="mt-3 text-sm text-muted-foreground">No matching cars.</p>}</div>
    <div className="enquiry-search-group min-w-0 rounded border bg-white p-4"><h3 className="font-semibold">Reservations ({matchingReservations.length})</h3><ul className="mt-3 max-h-96 space-y-3 overflow-auto">{matchingReservations.map(r => <li key={r.id} className="border-t pt-2 text-sm"><Button variant="link" className="h-auto whitespace-normal p-0 text-left" onClick={() => onContact(r)}>{r.customerName} · {r.reference}</Button><p>{r.vehicleTitle}</p>{r.vehicleRegistration && <p className="text-xs text-muted-foreground">{r.vehicleRegistration}</p>}<p className="text-xs text-muted-foreground">{r.status} · {r.phone}</p></li>)}</ul>{!matchingReservations.length && <p className="mt-3 text-sm text-muted-foreground">No matching reservations.</p>}</div>
  </section>;
}
