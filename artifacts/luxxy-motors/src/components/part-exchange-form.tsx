import { FeatureUnavailable } from './feature-unavailable';
import './part-exchange-form.css';
import { useDealerFeatures } from '@/lib/dealer-features';
import { useCreateEnquiry, type EnquiryInput } from '@workspace/api-client-react';
import { getVisitorId } from '@/lib/visitor';
import { enquiryDraftKey, readEnquiryDraft } from '@/lib/enquiry-draft';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, MessageSquare } from '@/components/icons';
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
import { partExchangeDraftKey, readPartExchangeDraft, savePartExchangeDraft, discardPartExchangeDraft } from '@/lib/part-exchange-draft';

const steps = ['Your car', 'Your next car', 'Contact & review'];
const labelClass = 'field-label';
const emptyDetails: PartExchangeDetails = {
  registration: '', makeModel: '', mileage: '', condition: '', conditionNotes: '',
  keys: '', v5: '', serviceHistory: '', name: '', phone: '', email: '',
};

export function PartExchangeForm({ vehicle, stockCars }: { vehicle?: Car; stockCars: Car[] }) {
  const { settings, isLoading: settingsLoading, isError: settingsError } = useDealerSettings();
  const features = useDealerFeatures();
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
  const draftKey = partExchangeDraftKey(vehicle?.id);
  const [draftRestored, setDraftRestored] = useState(false);
  const skipDraftSave = useRef(false);
  useEffect(() => {
    skipDraftSave.current = true;
    const draft = readPartExchangeDraft(draftKey);
    const enquiry = readEnquiryDraft(enquiryDraftKey(vehicle?.id, 'part_exchange')) ?? readEnquiryDraft(enquiryDraftKey(vehicle?.id, 'general'));
    setDetails(draft?.details ?? { ...emptyDetails, name: enquiry?.customerName ?? '', email: enquiry?.email ?? '', phone: enquiry?.phone ?? '',
      registration: enquiry?.hasPartExchange ? enquiry.exchange.registration : '',
      mileage: enquiry?.hasPartExchange ? enquiry.exchange.mileage : '',
      conditionNotes: enquiry?.hasPartExchange ? enquiry.exchange.notes : '',
    });
    setVehicleId(draft?.vehicleId ?? vehicle?.id ?? '');
    setDelivery(draft?.delivery ?? 'website');
    vehicleTouched.current = Boolean(draft);
    setDraftRestored(Boolean(draft));
    setReviewed(false);
    setStep(0);
    setFurthestStep(0);
  }, [draftKey]);
  useEffect(() => {
    if (skipDraftSave.current) { skipDraftSave.current = false; return; }
    if (mutation.isSuccess) { discardPartExchangeDraft(draftKey); return; }
    if (Object.values(details).some(value => value.trim())) savePartExchangeDraft(draftKey, { details, vehicleId, delivery });
    else discardPartExchangeDraft(draftKey);
  }, [draftKey, details, vehicleId, delivery, mutation.isSuccess]);
  const discardDraft = () => {
    discardPartExchangeDraft(draftKey);
    setDetails({ ...emptyDetails }); setVehicleId(vehicle?.id ?? ''); setDelivery('website');
    setDraftRestored(false); setReviewed(false); setStep(0); setFurthestStep(0);
    setOpened(false); setLaunchError(''); mutation.reset();
  };
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
  useEffect(() => {
    // A removed or invalid showroom number must not strand a restored draft on
    // an unavailable send method. The website enquiry remains available.
    if (!settingsLoading && !settingsError && !whatsAppHref && delivery === 'whatsapp') {
      setDelivery('website'); setReviewed(false); setOpened(false); setLaunchError('');
    }
  }, [settingsLoading, settingsError, whatsAppHref, delivery]);
  const ready = Boolean(selectedVehicle && /^[A-Z0-9 ]{2,12}$/i.test(details.registration.trim()) && details.mileage !== '' && Number.isInteger(Number(details.mileage)) && Number(details.mileage) >= 0 && Number(details.mileage) <= 1000000);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!features.enabled('partExchange')) return;
    if (step === 1 && !selectedVehicle) return;
    if (step < 2) {
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
      const condition = details.condition ? details.condition.split(' — ')[0].toLowerCase() as NonNullable<EnquiryInput['partExchange']>['condition'] : null;
      setLaunchError('');
      mutation.mutate({ data: {
        type: 'part_exchange', vehicleId: selectedVehicle!.id,
        customerName: details.name.trim(), email: details.email.trim() || null,
        phone: details.phone.replace(/[\s().\-/]/g, ''), preferredContact: whatsAppHref ? 'whatsapp' : 'phone',
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
      setLaunchError('WhatsApp couldn’t open. Please try again or call us.');
    }
  };

  if (mutation.isSuccess) {
    const photoHref = getWhatsAppHref(`Hello ${settings.identity.name}, here are the photos for my part-exchange enquiry. My car: ${details.registration.trim().toUpperCase()} ${details.makeModel.trim() ? `(${details.makeModel.trim()})` : ''}. Name: ${details.name.trim()}. Phone: ${details.phone.trim()}.`, settings);
    return <div className="space-y-5" data-testid="status-part-exchange-success">
      <p className="luxxy-kicker">Details received</p>
      <h2 ref={heading} tabIndex={-1} id="enquiry-form-heading" className="font-display text-2xl font-semibold outline-none">{photoHref ? 'Now add your car photos.' : 'We’ve received your part-exchange enquiry.'}</h2>
      <p className="text-sm leading-6 text-muted-foreground">We’ve received your part-exchange details.{photoHref && ' Your name, phone number and car registration will help us match your photos to your enquiry.'}</p>
      {photoHref ? <Button asChild><a href={photoHref} target="_blank" rel="noopener noreferrer" data-testid="link-part-exchange-photos">Send photos through WhatsApp<ArrowRight className="h-4 w-4" aria-hidden="true" /></a></Button> : <p>WhatsApp is unavailable. Please call us to arrange how to share your photos.</p>}
      {photoHref && <p className="text-sm leading-6 text-muted-foreground">Send the prefilled message, then use WhatsApp’s attachment button to add the front, rear, both sides, interior, mileage and any damage. Photos are not attached automatically.</p>}
      {phoneHref && <a href={phoneHref} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">Call Us</a>}
    </div>;
  }

  if (!features.enabled('partExchange')) return <FeatureUnavailable title="Online part-exchange requests are currently unavailable" loading={features.isLoading} error={features.isError} retry={() => void features.refetch()} />;

  return <form onSubmit={submit} className="part-exchange-form space-y-6" data-testid="form-part-exchange">
    {draftRestored && <div className="flex flex-wrap items-center justify-between gap-2 border-y border-border py-3 text-sm text-muted-foreground" role="status"><p>Your unfinished part-exchange enquiry was restored.</p><button type="button" className="min-h-11 text-link" onClick={discardDraft}>Discard draft</button></div>}
    <fieldset disabled={mutation.isPending} className="min-w-0 space-y-6">
    <legend className="sr-only">Part-exchange enquiry</legend>
    <nav className="grid grid-cols-3 gap-2" aria-label="Part-exchange steps">
      {steps.map((label, index) => <button key={label} type="button" disabled={index > furthestStep} aria-label={`0${index + 1} ${label}`} aria-current={step === index ? 'step' : undefined} onClick={event => { if (index <= step || event.currentTarget.form?.reportValidity()) setStep(index); }} className={`min-h-11 border-t-2 pt-2 text-left text-xs focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-45 ${index === step ? 'border-accent text-primary' : 'border-border text-muted-foreground'}`}>
        <span className="block">0{index + 1}</span><span className="mt-1 hidden sm:block">{label}</span>
      </button>)}
    </nav>
    <div>
      <p className="luxxy-kicker">Step {step + 1} of 3 · {steps[step]}</p>
      <h2 ref={heading} tabIndex={-1} id="enquiry-form-heading" className="mt-3 font-display text-2xl font-semibold tracking-tight outline-none">
        {['Tell us about your car.', 'Which of our cars caught your eye?', 'Review and send your enquiry.'][step]}
      </h2>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{[
        'Just your registration and approximate mileage to get started. Add any other details you know.',
        'Select a vehicle from our current stock so we can discuss the part-exchange difference.',
        'Check your details and choose how to send them. You can add photos afterwards.',
      ][step]}</p>
    </div>

    {step === 0 && <fieldset className="min-w-0 space-y-5">
      <legend className="sr-only">Your current car</legend>
      <div className="max-w-sm"><label className="block"><span className={labelClass}>Registration</span><UKNumberPlate value={details.registration} editable onChange={value => update('registration', value)} testId="visual-uk-number-plate" inputTestId="input-part-exchange-registration" /></label></div>
      <label className="block"><span className={labelClass}>Make and model (optional)</span><Input maxLength={100} value={details.makeModel} onChange={event => update('makeModel', event.target.value)} placeholder="e.g. Volkswagen Golf 1.4 TSI" data-testid="input-part-exchange-model" /></label>
      <label className="block max-w-sm"><span className={labelClass}>Current mileage (miles)</span><Input required type="number" min={0} max={1000000} step={1} inputMode="numeric" value={details.mileage} onChange={event => update('mileage', event.target.value)} placeholder="e.g. 45000" data-testid="input-part-exchange-mileage" /></label>
      <details className="border-t border-border pt-3"><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">Condition and paperwork (optional)</summary><fieldset className="min-w-0 space-y-5 pt-3">
      <legend className="sr-only">Condition and paperwork</legend>
      <label className="block"><span className={labelClass}>Overall condition</span><NativeSelect value={details.condition} onChange={event => update('condition', event.target.value)} data-testid="select-part-exchange-condition">
        <option value="">Choose the closest description</option><option>Excellent — very little wear</option><option>Good — normal wear for its age</option><option>Fair — marks or some work needed</option><option>Poor — significant work needed</option>
      </NativeSelect></label>
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block"><span className={labelClass}>How many keys do you have?</span><NativeSelect value={details.keys} onChange={event => update('keys', event.target.value)} data-testid="select-part-exchange-keys"><option value="">Select key count</option>{['0 keys', '1 key', '2 keys', '3 or more keys', 'Not sure'].map(value => <option key={value}>{value}</option>)}</NativeSelect></label>
        <label className="block"><span className={labelClass}>Do you have the V5C logbook?</span><NativeSelect value={details.v5} onChange={event => update('v5', event.target.value)} data-testid="select-part-exchange-v5"><option value="">Select an answer</option>{['Yes', 'No', 'Replacement requested', 'Not sure'].map(value => <option key={value}>{value}</option>)}</NativeSelect></label>
      </div>
      <label className="block"><span className={labelClass}>Service history</span><NativeSelect value={details.serviceHistory} onChange={event => update('serviceHistory', event.target.value)} data-testid="select-part-exchange-history"><option value="">Select an answer</option>{['Full history', 'Partial history', 'No service records', 'Not sure'].map(value => <option key={value}>{value}</option>)}</NativeSelect></label>
      <label className="block"><span className={labelClass}>Damage, faults or other details (optional)</span><Textarea rows={3} maxLength={700} value={details.conditionNotes} onChange={event => update('conditionNotes', event.target.value)} placeholder="Tell us about warning lights, scratches, dents, mechanical faults or outstanding finance." data-testid="input-part-exchange-notes" /></label>
      </fieldset></details>

    </fieldset>}


    {step === 1 && <fieldset className="min-w-0 space-y-5">
      <legend className="sr-only">Choose your next car</legend>
      <label className="block"><span className={labelClass}>Vehicle you are interested in</span><NativeSelect required value={vehicleId} disabled={!stockCars.length} onChange={event => { vehicleTouched.current = true; setVehicleId(event.target.value); setReviewed(false); }} data-testid="select-part-exchange-target-vehicle">
        <option value="">Choose from our current stock</option>{stockCars.map(car => <option key={car.id} value={car.id}>{[vehicleDisplayTitle(car), customerRegistrationDetails(car), car.price != null ? formatPrice(car.price, car.currency) : null].filter(Boolean).join(' · ')}</option>)}
      </NativeSelect></label>
      {selectedVehicle ? <div className="overflow-hidden border border-border" data-testid="card-part-exchange-target-vehicle">
        {getThumbnailUrl(selectedVehicle) && <img src={getThumbnailUrl(selectedVehicle)} alt={selectedVehicle.title || 'Selected stock vehicle'} referrerPolicy="no-referrer" className="aspect-[16/10] w-full object-cover" />}
        <div className="p-4"><p className="text-xs text-accent">Your next car</p><h3 className="mt-1 font-display text-xl font-semibold">{vehicleDisplayTitle(selectedVehicle)}</h3><p className="mt-2 text-lg font-semibold">{selectedVehicle.price != null ? formatPrice(selectedVehicle.price, selectedVehicle.currency) : 'Price on request'}</p><p className="mt-2 text-sm text-muted-foreground">{[customerRegistrationDetails(selectedVehicle), selectedVehicle.mileage != null ? `${selectedVehicle.mileage.toLocaleString('en-GB')} miles` : null, selectedVehicle.fuel, selectedVehicle.transmission].filter(Boolean).join(' · ')}</p></div>
      </div> : <p className="border-l-2 border-accent pl-4 text-sm leading-6 text-muted-foreground">{stockCars.length ? 'Choose a car to see its photograph and details here.' : 'There are no cars to choose from right now. Please contact us before continuing.'}</p>}
    </fieldset>}

    {step === 2 && <div className="space-y-5">
      {whatsAppHref ? <fieldset className="space-y-3"><legend className="mb-3 font-semibold">How would you like to send your details?</legend>
        {([
          ['website', 'Send details here, photos on WhatsApp', 'Send us your details here first. Then send your photos on WhatsApp with your name and car registration.'],
          ['whatsapp', 'Send everything on WhatsApp', 'Open a prefilled message, send it in the chat, then attach your photos. No enquiry is saved on this website.'],
        ] as const).map(([value, title, description]) => <label key={value} className={`flex cursor-pointer items-start gap-3 rounded-sm border p-4 ${delivery === value ? 'border-accent bg-accent/5' : 'border-border'}`}>
          <input type="radio" name="partExchangeDelivery" value={value} checked={delivery === value} onChange={() => { setDelivery(value); setReviewed(false); setOpened(false); setLaunchError(''); mutation.reset(); }} className="mt-1 h-5 w-5 shrink-0 accent-primary" />
          <span><span className="block text-sm font-semibold">{title}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span></span>
        </label>)}
      </fieldset> : <p className="text-sm leading-6 text-muted-foreground">Send your details here. We’ll contact you about your part exchange and arrange how to share photos.</p>}
      {!ready && <p role="alert" className="text-sm text-destructive">Some car details are missing or your selected vehicle is no longer available. Go back to check your answers before continuing.</p>}
      <fieldset className="grid min-w-0 gap-5 sm:grid-cols-2"><legend className="sr-only">Your contact details</legend>
        <label><span className={labelClass}>Your name</span><Input required minLength={2} maxLength={120} value={details.name} autoComplete="name" onChange={event => update('name', event.target.value)} data-testid="input-customer-name" /></label>
        <label><span className={labelClass}>Contact number</span><Input name="partExchangePhone" required type="tel" inputMode="tel" pattern="[+0-9 ()/.-]{7,25}" title="Enter a phone number with 7–15 digits, including the country code if outside the UK." maxLength={25} value={details.phone} autoComplete="tel" onChange={event => { event.target.setCustomValidity(''); update('phone', event.target.value); }} onBlur={event => event.target.setCustomValidity(/^\+?\d{7,15}$/.test(details.phone.replace(/[\s().\-/]/g, '')) ? '' : 'Enter a valid phone number with 7–15 digits.')} data-testid="input-customer-phone" /></label>
        <label className="sm:col-span-2"><span className={labelClass}>Email address (optional)</span><Input type="email" maxLength={254} value={details.email} autoComplete="email" onChange={event => update('email', event.target.value)} data-testid="input-customer-email" /></label>
      </fieldset>
      <div className="border-y border-border py-5"><h3 className="font-semibold">{delivery === 'website' ? 'Your enquiry details' : 'Your WhatsApp message'}</h3><p className="mt-2 text-xs leading-5 text-muted-foreground">This includes your contact details. Use the steps above to change any car details.</p><pre className="mt-4 whitespace-pre-wrap break-words font-sans text-sm leading-6 text-primary" data-testid="part-exchange-message-preview">{message}</pre></div>
      <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm leading-6"><input type="checkbox" required checked={reviewed} onChange={event => setReviewed(event.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-primary" />I’ve checked these details and want to share them with {settings.identity.name} {delivery === 'whatsapp' ? 'through WhatsApp' : 'through this enquiry form'}.</label>
      <p className="text-xs leading-5 text-muted-foreground">{whatsAppHref && 'Attach your car photos in the chat after sending. '}We’ll confirm your valuation after inspecting your car.</p>
      {opened && <p role="status" className="border-l-2 border-accent pl-4 text-sm leading-6">WhatsApp was requested. Your enquiry is not submitted on this website. If the chat opened, tap send there, then attach your photos. If it didn’t open, allow pop-ups and try again.</p>}
      {mutation.isError && <p role="alert" className="text-sm leading-6 text-destructive">We couldn’t confirm receipt. Your details are still here. Please contact us before sending again so we can check whether your enquiry arrived.</p>}
      {launchError && <p role="alert" className="text-sm text-destructive">{launchError}</p>}
    </div>}

    {!whatsAppHref && <p role="status" className="text-sm leading-6 text-muted-foreground">You can’t reach us on WhatsApp right now. {phoneHref ? <a className="underline underline-offset-4" href={phoneHref}>Call us to discuss your part exchange.</a> : 'Please contact us directly.'}</p>}
    <div className="part-exchange-actions flex items-center justify-between gap-3 border-t border-border pt-5">
      {step > 0 ? <Button type="button" variant="ghost" onClick={() => setStep(step - 1)}><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back</Button> : <span className="text-xs text-muted-foreground">Contact details at the end</span>}
      <Button type="submit" disabled={mutation.isPending || (step === 1 ? !selectedVehicle : step === 2 ? !ready || (delivery === 'whatsapp' && !whatsAppHref) : false)} data-testid="button-part-exchange-continue">{step === 2 ? <><MessageSquare className="h-4 w-4" aria-hidden="true" />{mutation.isPending ? 'Sending details…' : delivery === 'website' ? 'Send my details' : 'Open WhatsApp'}</> : <>Continue<ArrowRight className="h-4 w-4" aria-hidden="true" /></>}</Button>
    </div>
    <p className="flex items-center gap-2 text-xs text-muted-foreground"><Check className="h-3.5 w-3.5" aria-hidden="true" />Unsent answers are kept in this browser tab for 30 minutes. Nothing is sent until you choose.</p>
    </fieldset>
  </form>;
}
