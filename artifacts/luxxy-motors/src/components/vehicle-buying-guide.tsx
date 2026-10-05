import { useState, type FormEvent } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowRight, Calendar } from 'lucide-react';
import type { Car } from '@/lib/stock-context';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { buyerInformation } from '@/lib/buyer-information';
import { dealershipLocation } from '@/lib/dealership-location';
import { dealershipPhotography } from '@/lib/dealership-photography';
import { getVehicleBookingHref, recordBookingIntent } from '@/lib/cta-helpers';
import { readVehicleExchange, saveVehicleExchange } from '@/lib/vehicle-exchange-draft';
import { DealershipPhotograph } from './dealership-photograph';
import { UKNumberPlate } from './uk-number-plate';
import { Button } from './ui/button';
import { Input } from './ui/input';

export function VehicleHighlights({ car, features }: { car: Car; features: string[] }) {
  const history = buyerInformation(car).find(item => item.label === 'Service history')?.value;
  const highlights = [
    features.length ? { title: 'Equipment', value: [...new Set(features)].slice(0, 3).join(' · ') } : null,
    car.seats || car.doors || car.bodyType ? { title: 'Space & practicality', value: [car.bodyType, car.seats ? `${car.seats} seats` : null, car.doors ? `${car.doors} doors` : null].filter(Boolean).join(' · ') } : null,
    history ? { title: 'Service record', value: history } : car.engineSize && car.fuel && car.transmission ? {title: 'Engine & gearbox', value: `${car.engineSize} · ${car.fuel} · ${car.transmission}`} : null,
  ].filter((item): item is {title: string; value: string} => Boolean(item));
  if (highlights.length < 2) return null;
  return <section aria-labelledby="vehicle-highlights-heading" className="border-t border-border py-7">
    <h2 id="vehicle-highlights-heading" className="section-heading">A closer look at this car</h2>
    <dl className="mt-4 divide-y divide-border">{highlights.map(item => <div key={item.title} className="py-4"><dt className="text-xs font-semibold text-accent">{item.title}</dt><dd className="mt-2 text-sm leading-6">{item.value}</dd></div>)}</dl>
    <p className="text-xs text-muted-foreground">From the supplied vehicle details. Confirm the equipment and records when you visit.</p>
  </section>;
}

export function VehiclePartExchange({ car }: { car: Car }) {
  const [, navigate] = useLocation();
  const [draft, setDraft] = useState(() => readVehicleExchange(car.id) ?? {registration:'', mileage:'', notes:''});
  const [error, setError] = useState('');
  function continueToEnquiry(event: FormEvent) {
    event.preventDefault();
    if (!/^[A-Z0-9 ]{2,10}$/.test(draft.registration.trim().toUpperCase()) || (!/^\d{1,7}$/.test(draft.mileage) || Number(draft.mileage) > 1000000)) { setError('Enter your registration and approximate mileage.'); return; }
    if (!saveVehicleExchange(car.id, {...draft, registration:draft.registration.trim().toUpperCase()})) {setError('Your browser could not carry these details across. Please use the enquiry form below.'); return;}
    navigate(`/enquire?type=general&vehicleId=${encodeURIComponent(car.id)}`);
  }
  return <section aria-labelledby="vehicle-exchange-heading" className="mt-8 border-y border-border bg-secondary/40 px-5 py-6 sm:px-6">
    <h2 id="vehicle-exchange-heading" className="section-heading">Have a car to part exchange?</h2>
    <p className="mt-3 text-sm leading-6 text-muted-foreground">Start with two details. We’ll discuss its condition and a valuation with you.</p>
    <form className="mt-5" onSubmit={continueToEnquiry}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label htmlFor="vehicle-exchange-registration" className="mb-2 block text-sm font-medium">Your registration</label><UKNumberPlate editable value={draft.registration} onChange={registration=>setDraft({...draft,registration})} inputId="vehicle-exchange-registration" testId="vehicle-exchange-plate" /></div>
        <div><label htmlFor="vehicle-exchange-mileage" className="mb-2 block text-sm font-medium">Approximate mileage</label><Input id="vehicle-exchange-mileage" required inputMode="numeric" pattern="[0-9]{1,7}" maxLength={7} value={draft.mileage} onChange={event=>setDraft({...draft,mileage:event.target.value})} placeholder="e.g. 45000" className="min-h-12" /></div>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error} <Link href={`/enquire?type=general&vehicleId=${encodeURIComponent(car.id)}`} className="underline">Open enquiry form</Link></p>}
      <Button type="submit" variant="outline" className="mt-4 min-h-12">Continue with my part exchange<ArrowRight className="h-4 w-4" /></Button>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">Details are saved in this browser tab, reused for up to 30 minutes and sent only when you submit your enquiry. This is not a valuation.</p>
    </form>
  </section>;
}

export function VehicleVisit({ car }: { car: Car }) {
  const {settings, isLoading, isError} = useDealerSettings();
  const location = dealershipLocation(settings.address);
  const photo = dealershipPhotography(settings).contact;
  const available = !car.inventoryStatus || car.inventoryStatus === 'available';
  return <section aria-labelledby="vehicle-visit-heading" className="mt-8 border-t border-border pt-7">
    <h2 id="vehicle-visit-heading" className="section-heading">See it for yourself.</h2>
    <p className="mt-3 text-sm leading-6 text-muted-foreground">Take a closer look, sit behind the wheel and ask the team your questions.</p>
    {!isLoading && !isError && <>
      {photo && <DealershipPhotograph photo={photo} className="mt-5" />}
      <p className="mt-5 font-semibold">{settings.identity.name}</p>
      {location.isSample ? <p className="mt-2 text-sm text-muted-foreground">Sample showroom details. Confirm the location with the team before travelling.</p> : <address className="mt-2 not-italic text-sm leading-6">{location.lines.join(', ') || 'Contact the team for the showroom address.'}</address>}
      {settings.presentation?.visitInstructions && <p className="mt-3 whitespace-pre-line text-sm leading-6 text-muted-foreground">{settings.presentation.visitInstructions}</p>}
      {settings.presentation?.parkingInstructions && <p className="mt-2 text-sm leading-6 text-muted-foreground">{settings.presentation.parkingInstructions}</p>}
    </>}
    <p className="mt-3 text-xs leading-5 text-muted-foreground">{available ? 'Please confirm your test drive before travelling.' : 'Contact the team to check this vehicle’s availability before travelling.'}</p>
    <div className="mt-4 flex flex-wrap gap-3">{available && <Button asChild><a href={getVehicleBookingHref(car)} onClick={()=>recordBookingIntent({source:'vehicle_visit',vehicleContext:true})}><Calendar className="h-4 w-4" />Choose a test-drive time</a></Button>}<Button asChild variant="outline"><Link href="/contact">Directions & opening hours<ArrowRight className="h-4 w-4" /></Link></Button></div>
  </section>;
}
