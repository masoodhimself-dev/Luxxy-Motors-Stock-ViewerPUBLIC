import { useCreateEnquiry, type EnquiryInput } from '@workspace/api-client-react';
import { getVisitorId } from '@/lib/visitor';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Camera, Check, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { UKNumberPlate } from '@/components/uk-number-plate';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { getPhoneHref, getWhatsAppHref } from '@/lib/cta-helpers';
import { formatPrice, getThumbnailUrl, vehicleDisplayTitle } from '@/lib/utils';
import { customerRegistrationDetails } from '@/lib/customer-vehicle-meta';
import type { Car } from '@/lib/stock-context';
import { buildPartExchangeMessage, type PartExchangeDetails } from '@/lib/part-exchange';

const steps = ['Your car', 'Condition & photos', 'Your next car', 'Contact & review'];
const labelClass = 'field-label';
const emptyDetails: PartExchangeDetails = {
  registration: '', makeModel: '', mileage: '', condition: '', conditionNotes: '',
  keys: '', v5: '', serviceHistory: '', name: '', phone: '', email: '',
};

export function PartExchangeForm({ vehicle, stockCars }: { vehicle?: Car; stockCars: Car[] }) {
  const { settings } = useDealerSettings();
  const mutation = useCreateEnquiry();
  const [delivery, setDelivery] = useState<'website' | 'whatsapp'>('website');
  const [details, setDetails] = useState(emptyDetails);
  const [step, setStep] = useState(0);
  const [furthestStep, setFurthestStep] = useState(0);
  const [vehicleId, setVehicleId] = useState(vehicle?.id ?? '');
  const [reviewed, setReviewed] = useState(false);
  const [opened, setOpened] = useState(false);
  const [launchError, setLaunchError] = useState('');
  const vehicleTouched = useRef(false);
  useEffect(() => {
    if (!vehicleTouched.current && vehicle?.id) setVehicleId(vehicle.id);
  }, [vehicle?.id]);
  const heading = useRef<HTMLHeadingElement>(null);
  const hasMounted = useRef(false);
  const selectedVehicle = stockCars.find(car => car.id === vehicleId);
  const update = (key: keyof PartExchangeDetails, value: string) => {
    setDetails(current => ({ ...current, [key]: value }));
    setReviewed(false);
  };
  useEffect(() => {
    if (hasMounted.current) heading.current?.focus();
    hasMounted.current = true;
  }, [step, mutation.isSuccess]);
  const message = selectedVehicle ? buildPartExchangeMessage(details, selectedVehicle, settings.identity.name) : '';
  const whatsAppHref = getWhatsAppHref(message, settings);
  const phoneHref = getPhoneHref(settings);
  const ready = Boolean(selectedVehicle && details.registration.trim() && details.makeModel.trim() && details.mileage !== '' && details.condition && details.keys && details.v5 && details.serviceHistory);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (step === 2 && !selectedVehicle) return;
    if (step < 3) {
      setStep(step + 1);
      setFurthestStep(current => Math.max(current, step + 1));
      return;
    }
    const phoneInput = event.currentTarget.elements.namedItem('partExchangePhone') as HTMLInputElement;
    if (!/^\+?\d{7,15}$/.test(details.phone.replace(/[\s().\-/]/g, ''))) {
      phoneInput.setCustomValidity('Enter a valid phone number with 7–15 digits.');
      phoneInput.reportValidity();
      return;
    }
    if (!ready || !reviewed || mutation.isPending) return;
    if (delivery === 'website') {
      if (message.length > 2000) { setLaunchError('Please shorten your condition notes before sending (maximum total summary: 2,000 characters).'); return; }
      const condition = details.condition.split(' — ')[0].toLowerCase() as NonNullable<EnquiryInput['partExchange']>['condition'];
      setLaunchError('');
      mutation.mutate({ data: {
        type: 'part_exchange', vehicleId: selectedVehicle!.id,
        customerName: details.name.trim(), email: details.email.trim(),
        phone: details.phone.replace(/[\s().\-/]/g, ''), preferredContact: 'whatsapp',
        message, appointmentAt: null, visitorId: getVisitorId(),
        partExchange: { registration: details.registration.trim().toUpperCase(), mileage: Number(details.mileage), condition },
      } });
      return;
    }
    if (!whatsAppHref) return;
    try {
      window.open(whatsAppHref, '_blank', 'noopener,noreferrer');
      setOpened(true);
      setLaunchError('');
    } catch {
      setLaunchError('WhatsApp could not open. Please try again or call the showroom.');
    }
  };

  if (mutation.isSuccess) {
    const photoHref = getWhatsAppHref(`Hello ${settings.identity.name}, here are the photos for my part-exchange enquiry ${mutation.data.reference}. My car: ${details.registration.trim().toUpperCase()} (${details.makeModel.trim()}). Name: ${details.name.trim()}.`, settings);
    return <div className="space-y-5" data-testid="status-part-exchange-success">
      <p className="luxxy-kicker">Details received</p>
      <h2 ref={heading} tabIndex={-1} id="enquiry-form-heading" className="font-display text-2xl font-semibold outline-none">Now add your car photos.</h2>
      <p className="text-sm leading-6 text-muted-foreground">Your part-exchange details have been saved for the team. Keep this reference so we can match your photos to the enquiry.</p>
      <p className="border-y border-border py-4 font-mono text-xl font-semibold" data-testid="part-exchange-reference">{mutation.data.reference}</p>
      {photoHref ? <Button asChild><a href={photoHref} target="_blank" rel="noopener noreferrer" data-testid="link-part-exchange-photos">Send photos through WhatsApp<ArrowRight className="h-4 w-4" aria-hidden="true" /></a></Button> : <p>WhatsApp is unavailable. Please call the showroom to arrange how to share your photos.</p>}
      <p className="text-sm leading-6 text-muted-foreground">Send the prefilled reference message, then use WhatsApp’s attachment button to add the front, rear, both sides, interior, mileage and any damage. Photos are not attached automatically.</p>
      {phoneHref && <a href={phoneHref} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">Call the showroom</a>}
    </div>;
  }

  return <form onSubmit={submit} className="space-y-6" data-testid="form-part-exchange">
    <fieldset disabled={mutation.isPending} className="min-w-0 space-y-6">
    <legend className="sr-only">Part-exchange enquiry</legend>
    <nav className="grid grid-cols-4 gap-2" aria-label="Part-exchange steps">
      {steps.map((label, index) => <button key={label} type="button" disabled={index > furthestStep} aria-label={`0${index + 1} ${label}`} aria-current={step === index ? 'step' : undefined} onClick={event => { if (index <= step || event.currentTarget.form?.reportValidity()) setStep(index); }} className={`min-h-11 border-t-2 pt-2 text-left text-xs focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-45 ${index === step ? 'border-accent text-primary' : 'border-border text-muted-foreground'}`}>
        <span className="block">0{index + 1}</span><span className="mt-1 hidden sm:block">{label}</span>
      </button>)}
    </nav>
    <div>
      <p className="luxxy-kicker">Step {step + 1} of 4 · {steps[step]}</p>
      <h2 ref={heading} tabIndex={-1} id="enquiry-form-heading" className="mt-3 font-display text-2xl font-semibold tracking-tight outline-none">
        {['Tell us about your car.', 'A clear picture of its condition.', 'Which of our cars caught your eye?', 'Review it, then start a conversation.'][step]}
      </h2>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{[
        'Start with the registration and mileage. No registration lookup is performed.',
        'An honest description helps the team discuss a realistic valuation.',
        'Select a vehicle from our current stock so we can discuss the part-exchange difference.',
        'Choose how to send your details. In either case, you’ll attach your photos in WhatsApp.',
      ][step]}</p>
    </div>

    {step === 0 && <fieldset className="min-w-0 space-y-5">
      <legend className="sr-only">Your current car</legend>
      <div className="max-w-sm"><label className="block"><span className={labelClass}>Registration</span><UKNumberPlate value={details.registration} editable onChange={value => update('registration', value)} testId="visual-uk-number-plate" inputTestId="input-part-exchange-registration" /></label></div>
      <label className="block"><span className={labelClass}>Make and model</span><Input required maxLength={100} value={details.makeModel} onChange={event => update('makeModel', event.target.value)} placeholder="e.g. Volkswagen Golf 1.4 TSI" data-testid="input-part-exchange-model" /></label>
      <label className="block max-w-sm"><span className={labelClass}>Current mileage (miles)</span><Input required type="number" min={0} max={2000000} step={1} inputMode="numeric" value={details.mileage} onChange={event => update('mileage', event.target.value)} placeholder="e.g. 45000" data-testid="input-part-exchange-mileage" /></label>
    </fieldset>}

    {step === 1 && <fieldset className="min-w-0 space-y-5">
      <legend className="sr-only">Condition, documents and photographs</legend>
      <label className="block"><span className={labelClass}>Overall condition</span><NativeSelect required value={details.condition} onChange={event => update('condition', event.target.value)} data-testid="select-part-exchange-condition">
        <option value="">Choose the closest description</option><option>Excellent — very little wear</option><option>Good — normal wear for its age</option><option>Fair — marks or some work needed</option><option>Poor — significant work needed</option>
      </NativeSelect></label>
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block"><span className={labelClass}>How many keys do you have?</span><NativeSelect required value={details.keys} onChange={event => update('keys', event.target.value)} data-testid="select-part-exchange-keys"><option value="">Select key count</option>{['0 keys', '1 key', '2 keys', '3 or more keys', 'Not sure'].map(value => <option key={value}>{value}</option>)}</NativeSelect></label>
        <label className="block"><span className={labelClass}>Do you have the V5C logbook?</span><NativeSelect required value={details.v5} onChange={event => update('v5', event.target.value)} data-testid="select-part-exchange-v5"><option value="">Select an answer</option>{['Yes', 'No', 'Replacement requested', 'Not sure'].map(value => <option key={value}>{value}</option>)}</NativeSelect></label>
      </div>
      <label className="block"><span className={labelClass}>Service history</span><NativeSelect required value={details.serviceHistory} onChange={event => update('serviceHistory', event.target.value)} data-testid="select-part-exchange-history"><option value="">Select an answer</option>{['Full history', 'Partial history', 'No service records', 'Not sure'].map(value => <option key={value}>{value}</option>)}</NativeSelect></label>
      <label className="block"><span className={labelClass}>Damage, faults or other details (optional)</span><Textarea rows={3} maxLength={700} value={details.conditionNotes} onChange={event => update('conditionNotes', event.target.value)} placeholder="Tell us about warning lights, scratches, dents, mechanical faults or outstanding finance." data-testid="input-part-exchange-notes" /></label>
      <div className="border-y border-border py-5" data-testid="part-exchange-photo-guide">
        <h3 className="flex items-center gap-2 font-semibold"><Camera className="h-4 w-4 text-accent" aria-hidden="true" />Add photos in WhatsApp</h3>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">After sending your message, use the attachment button in WhatsApp to add clear photos taken in daylight.</p>
        <ul className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3 text-sm">{['Front and rear', 'Both sides', 'Seats and interior', 'Dashboard and mileage', 'Wheels and tyres', 'Any damage or faults'].map(item => <li key={item} className="border-l-2 border-border pl-3">{item}</li>)}</ul>
        <p className="mt-4 text-xs leading-5 text-muted-foreground">Photos are not uploaded on this website or attached automatically. Please don’t photograph your V5C reference number, address or other personal documents.</p>
      </div>
    </fieldset>}

    {step === 2 && <fieldset className="min-w-0 space-y-5">
      <legend className="sr-only">Choose your next car</legend>
      <label className="block"><span className={labelClass}>Vehicle you are interested in</span><NativeSelect required value={vehicleId} disabled={!stockCars.length} onChange={event => { vehicleTouched.current = true; setVehicleId(event.target.value); setReviewed(false); }} data-testid="select-part-exchange-target-vehicle">
        <option value="">Choose from our current stock</option>{stockCars.map(car => <option key={car.id} value={car.id}>{[vehicleDisplayTitle(car), customerRegistrationDetails(car), car.price != null ? formatPrice(car.price, car.currency) : null].filter(Boolean).join(' · ')}</option>)}
      </NativeSelect></label>
      {selectedVehicle ? <div className="overflow-hidden border border-border" data-testid="card-part-exchange-target-vehicle">
        {getThumbnailUrl(selectedVehicle) && <img src={getThumbnailUrl(selectedVehicle)} alt={selectedVehicle.title || 'Selected stock vehicle'} referrerPolicy="no-referrer" className="aspect-[16/10] w-full object-cover" />}
        <div className="p-4"><p className="text-xs text-accent">Your next car</p><h3 className="mt-1 font-display text-xl font-semibold">{vehicleDisplayTitle(selectedVehicle)}</h3><p className="mt-2 text-lg font-semibold">{selectedVehicle.price != null ? formatPrice(selectedVehicle.price, selectedVehicle.currency) : 'Price on request'}</p><p className="mt-2 text-sm text-muted-foreground">{[customerRegistrationDetails(selectedVehicle), selectedVehicle.mileage != null ? `${selectedVehicle.mileage.toLocaleString('en-GB')} miles` : null, selectedVehicle.fuel, selectedVehicle.transmission].filter(Boolean).join(' · ')}</p></div>
      </div> : <p className="border-l-2 border-accent pl-4 text-sm leading-6 text-muted-foreground">{stockCars.length ? 'Choose a car to see its photograph and details here.' : 'No stock is available to select at the moment. Please contact the showroom before continuing.'}</p>}
    </fieldset>}

    {step === 3 && <div className="space-y-5">
      <fieldset className="space-y-3"><legend className="mb-3 font-semibold">How would you like to send your details?</legend>
        {([
          ['website', 'Send details here, photos on WhatsApp', 'Save your enquiry with the dealership first. Then send photos on WhatsApp with your enquiry reference.'],
          ['whatsapp', 'Send everything on WhatsApp', 'Open a prefilled message, send it in the chat, then attach your photos. No enquiry is saved on this website.'],
        ] as const).map(([value, title, description]) => <label key={value} className={`flex cursor-pointer items-start gap-3 rounded-sm border p-4 ${delivery === value ? 'border-accent bg-accent/5' : 'border-border'}`}>
          <input type="radio" name="partExchangeDelivery" value={value} checked={delivery === value} onChange={() => { setDelivery(value); setReviewed(false); setOpened(false); setLaunchError(''); mutation.reset(); }} className="mt-1 h-5 w-5 shrink-0 accent-primary" />
          <span><span className="block text-sm font-semibold">{title}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span></span>
        </label>)}
      </fieldset>
      {!ready && <p role="alert" className="text-sm text-destructive">Some car details are missing or your selected vehicle is no longer available. Go back to check your answers before continuing.</p>}
      <fieldset className="grid min-w-0 gap-5 sm:grid-cols-2"><legend className="sr-only">Your contact details</legend>
        <label><span className={labelClass}>Your name</span><Input required minLength={2} maxLength={120} value={details.name} autoComplete="name" onChange={event => update('name', event.target.value)} data-testid="input-customer-name" /></label>
        <label><span className={labelClass}>Contact number</span><Input name="partExchangePhone" required type="tel" inputMode="tel" pattern="[+0-9 ()/.-]{7,25}" title="Enter a phone number with 7–15 digits, including the country code if outside the UK." maxLength={25} value={details.phone} autoComplete="tel" onChange={event => { event.target.setCustomValidity(''); update('phone', event.target.value); }} onBlur={event => event.target.setCustomValidity(/^\+?\d{7,15}$/.test(details.phone.replace(/[\s().\-/]/g, '')) ? '' : 'Enter a valid phone number with 7–15 digits.')} data-testid="input-customer-phone" /></label>
        <label className="sm:col-span-2"><span className={labelClass}>Email address{delivery === 'whatsapp' ? ' (optional)' : ' (for confirmation)'}</span><Input required={delivery === 'website'} type="email" maxLength={254} value={details.email} autoComplete="email" onChange={event => update('email', event.target.value)} data-testid="input-customer-email" /></label>
      </fieldset>
      <div className="border-y border-border py-5"><h3 className="font-semibold">{delivery === 'website' ? 'Your enquiry details' : 'Your WhatsApp message'}</h3><p className="mt-2 text-xs leading-5 text-muted-foreground">This includes your contact details. Use the steps above to change any car details.</p><pre className="mt-4 whitespace-pre-wrap break-words font-sans text-sm leading-6 text-primary" data-testid="part-exchange-message-preview">{message}</pre></div>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm leading-6"><input type="checkbox" required checked={reviewed} onChange={event => setReviewed(event.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-primary" />I’ve checked these details and want to share them with {settings.identity.name} {delivery === 'whatsapp' ? 'through WhatsApp' : 'through this enquiry form'}.</label>
      <p className="text-xs leading-5 text-muted-foreground">Attach your car photos in the chat after sending. Any valuation is subject to inspection and confirmation by the dealership.</p>
      {opened && <p role="status" className="border-l-2 border-accent pl-4 text-sm leading-6">WhatsApp was requested. Your enquiry is not submitted on this website. If the chat opened, tap send there, then attach your photos. If it didn’t open, allow pop-ups and try again.</p>}
      {mutation.isError && <p role="alert" className="text-sm leading-6 text-destructive">We couldn’t confirm your enquiry was saved. Your details are still here. Please try again, or choose “Send everything on WhatsApp”.</p>}
      {launchError && <p role="alert" className="text-sm text-destructive">{launchError}</p>}
    </div>}

    {!whatsAppHref && <p role="status" className="text-sm leading-6 text-muted-foreground">WhatsApp is not available for this dealership. {phoneHref ? <a className="underline underline-offset-4" href={phoneHref}>Call the showroom to discuss your part exchange.</a> : 'Please contact the dealership directly.'}</p>}
    <div className="flex items-center justify-between gap-3 border-t border-border pt-5">
      {step > 0 ? <Button type="button" variant="ghost" onClick={() => setStep(step - 1)}><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back</Button> : <span className="text-xs text-muted-foreground">Contact details at the end</span>}
      <Button type="submit" disabled={mutation.isPending || (step === 2 ? !selectedVehicle : step === 3 ? !ready || (delivery === 'whatsapp' && !whatsAppHref) : false)} data-testid="button-part-exchange-continue">{step === 3 ? <><MessageSquare className="h-4 w-4" aria-hidden="true" />{mutation.isPending ? 'Sending details…' : delivery === 'website' ? 'Send my details' : 'Open WhatsApp'}</> : <>Continue<ArrowRight className="h-4 w-4" aria-hidden="true" /></>}</Button>
    </div>
    <p className="flex items-center gap-2 text-xs text-muted-foreground"><Check className="h-3.5 w-3.5" aria-hidden="true" />Your answers stay on this page until you choose to send them.</p>
    </fieldset>
  </form>;
}
