import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useCreateEnquiry, type EnquiryInput } from '@workspace/api-client-react';
import { PartExchangeMotDetails, type PartExchangeMotDetailsResult } from './part-exchange-mot-details';
import { EnquiryCarPicker } from './enquiry-car-picker';
import { FeatureUnavailable } from './feature-unavailable';
import { useDealerFeatures } from '@/lib/dealer-features';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { getVisitorId } from '@/lib/visitor';
import { enquiryDraftKey, readEnquiryDraft } from '@/lib/enquiry-draft';
import { ArrowLeft, ArrowRight, Check, MessageSquare, Search } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { UKNumberPlate } from '@/components/uk-number-plate';
import { PrivacyNoticeLink } from '@/components/privacy-notice-link';
import { getPhoneHref, getWhatsAppHref } from '@/lib/cta-helpers';
import { formatPrice, getThumbnailUrl, vehicleDisplayTitle, isUKNumberPlate } from '@/lib/utils';
import { customerRegistrationDetails } from '@/lib/customer-vehicle-meta';
import type { Car } from '@/lib/stock-context';
import { buildPartExchangeMessage, partExchangeMotSummary, partExchangeWhatsAppMessage, type PartExchangeDetails } from '@/lib/part-exchange';
import { applyPartExchangeMotDetails, exchangeMileageIsEstimated, normaliseExchangeRegistration, updatePartExchangeAnswer, type PartExchangeAnswers } from '@/lib/part-exchange-autofill';
import { partExchangeDraftKey, readPartExchangeDraft, savePartExchangeDraft, discardPartExchangeDraft } from '@/lib/part-exchange-draft';
import { clearHomepagePartExchangeLookup, readHomepagePartExchangeLookup, readHomepagePartExchangeRegistration } from '@/lib/homepage-part-exchange';
import './part-exchange-form.css';

const steps = ['Your car', 'Your next car', 'Contact & review'];
const emptyDetails: PartExchangeDetails = { registration: '', makeModel: '', mileage: '', condition: '', conditionNotes: '', keys: '', v5: '', serviceHistory: '', name: '', phone: '', email: '' };
type Gate = { registration: string; mode: 'lookup'; result: PartExchangeMotDetailsResult } | { registration: string; mode: 'manual' };
type MessageDraft = { text: string; source: string; edited: boolean };
const emptyMessage: MessageDraft = { text: '', source: '', edited: false };
const phoneValid = (value: string) => /^\+?\d{7,15}$/.test(value.replace(/[\s().\-/]/g, ''));

export function PartExchangeForm({ vehicle, stockCars }: { vehicle?: Car; stockCars: Car[] }) {
  const { settings, isLoading: settingsLoading, isError: settingsError } = useDealerSettings();
  const features = useDealerFeatures();
  const mutation = useCreateEnquiry();
  const submitting = useRef(false);
  const [answers, setAnswers] = useState<PartExchangeAnswers>({ details: { ...emptyDetails } });
  const { details, autofill } = answers;
  const [gate, setGate] = useState<Gate | null>(null);
  const [lookupNotice, setLookupNotice] = useState('');
  const [delivery, setDelivery] = useState<'website' | 'whatsapp'>('website');
  const [step, setStep] = useState(0), [furthestStep, setFurthestStep] = useState(0);
  // A null ID is an explicit choice to enquire without a stock car.
  const [vehicleId, setVehicleId] = useState<string | null>(vehicle?.id ?? '');
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerTrigger = useRef<HTMLButtonElement>(null);
  const [messageDraft, setMessageDraft] = useState<MessageDraft>(emptyMessage);
  const [reviewed, setReviewed] = useState(false), [opened, setOpened] = useState(false);
  const [launchError, setLaunchError] = useState(''), [draftRestored, setDraftRestored] = useState(false);
  const lookupButton = useRef<HTMLButtonElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const activePlate = useRef(''), vehicleTouched = useRef(false), skipDraftSave = useRef(false), hasMounted = useRef(false);
  const draftKey = partExchangeDraftKey(vehicle?.id);
  const homepageSeed = useRef<{ key: string; registration: string; result: PartExchangeMotDetailsResult | null } | null>(null);
  const registration = normaliseExchangeRegistration(details.registration);
  activePlate.current = registration;
  const hasCurrentCar = Boolean(gate && gate.registration === registration && isUKNumberPlate(registration));
  const currentCars = stockCars.filter(car => !['sold', 'archived', 'hidden'].includes(String(car.inventoryStatus)));
  const selectedVehicle = currentCars.find(car => car.id === vehicleId);
  const noCarChosen = vehicleId === null;
  const targetReady = Boolean(selectedVehicle) || noCarChosen;
  const mileageValid = details.mileage !== '' && Number.isInteger(Number(details.mileage)) && Number(details.mileage) >= 0 && Number(details.mileage) <= 1000000;
  const carDetailsReady = hasCurrentCar && Boolean(details.makeModel.trim()) && mileageValid;
  const lookupMot = hasCurrentCar && gate?.mode === 'lookup' ? gate.result.mot : null;
  const generatedMessage = targetReady ? buildPartExchangeMessage(details, selectedVehicle, settings.identity.name, { mileageEstimated: exchangeMileageIsEstimated(answers), mot: lookupMot }) : '';
  const message = messageDraft.edited ? messageDraft.text : generatedMessage;
  const messageNeedsRefresh = messageDraft.edited && messageDraft.source !== generatedMessage;
  const whatsAppHref = getWhatsAppHref(partExchangeWhatsAppMessage(message, details), settings);
  const phoneHref = getPhoneHref(settings);
  const ready = carDetailsReady && targetReady && Boolean(message.trim()) && message.length <= 2000 && !messageNeedsRefresh;

  useEffect(() => {
    skipDraftSave.current = true; submitting.current = false; mutation.reset();
    const draft = readPartExchangeDraft(draftKey);
    const enquiry = readEnquiryDraft(enquiryDraftKey(vehicle?.id, 'part_exchange')) ?? readEnquiryDraft(enquiryDraftKey(vehicle?.id, 'general'));
    let restored: PartExchangeAnswers = { details: draft?.details ?? { ...emptyDetails, name: enquiry?.customerName ?? '', email: enquiry?.email ?? '', phone: enquiry?.phone ?? '', registration: enquiry?.hasPartExchange ? enquiry.exchange.registration : '', mileage: enquiry?.hasPartExchange ? enquiry.exchange.mileage : '', conditionNotes: enquiry?.hasPartExchange ? enquiry.exchange.notes : '' }, autofill: draft?.autofill };
    if (homepageSeed.current?.key !== draftKey) homepageSeed.current = null;
    let seed = !vehicle?.id && homepageSeed.current?.key === draftKey ? homepageSeed.current : null;
    if (!vehicle?.id && !seed) {
      const carried = readHomepagePartExchangeRegistration();
      if (carried && isUKNumberPlate(carried)) {
        seed = { key: draftKey, registration: carried, result: readHomepagePartExchangeLookup(carried) };
        homepageSeed.current = seed;
        clearHomepagePartExchangeLookup();
      }
    }
    if (seed) restored = updatePartExchangeAnswer(restored, 'registration', seed.registration);
    if (seed?.result) restored = applyPartExchangeMotDetails(restored, seed.result);
    setAnswers(restored);
    const restoredPlate = normaliseExchangeRegistration(restored.details.registration);
    const manual = new URLSearchParams(window.location.search).get('manual') === 'true' && isUKNumberPlate(restoredPlate);
    setGate(seed?.result ? { registration: restoredPlate, mode: 'lookup', result: seed.result } : manual ? { registration: restoredPlate, mode: 'manual' } : null);
    setVehicleId(draft ? draft.vehicleId : vehicle?.id ?? ''); setDelivery(draft?.delivery ?? 'website');
    setMessageDraft(draft?.message ?? emptyMessage); setLookupNotice('');
    vehicleTouched.current = Boolean(draft); setDraftRestored(Boolean(draft) && !seed);
    setReviewed(false); setStep(0); setFurthestStep(0); setOpened(false); setLaunchError('');
  }, [draftKey]);
  useEffect(() => {
    if (skipDraftSave.current) { skipDraftSave.current = false; return; }
    if (mutation.isSuccess) { discardPartExchangeDraft(draftKey); return; }
    if (Object.values(details).some(value => value.trim())) savePartExchangeDraft(draftKey, { details, vehicleId, delivery, autofill, message: { ...messageDraft, text: message } });
    else discardPartExchangeDraft(draftKey);
  }, [draftKey, details, vehicleId, delivery, autofill, messageDraft, message, mutation.isSuccess]);
  useEffect(() => { if (!vehicleTouched.current && vehicle?.id) setVehicleId(vehicle.id); }, [vehicle?.id]);
  useEffect(() => { if (hasMounted.current) heading.current?.focus(); hasMounted.current = true; }, [step, mutation.isSuccess]);
  useEffect(() => { setReviewed(false); }, [generatedMessage]);
  useEffect(() => {
    if (!settingsLoading && !settingsError && !whatsAppHref && delivery === 'whatsapp') { setDelivery('website'); setReviewed(false); setOpened(false); }
  }, [settingsLoading, settingsError, whatsAppHref, delivery]);

  const update = (key: keyof PartExchangeDetails, value: string) => {
    if (key === 'registration' && normaliseExchangeRegistration(value) !== registration) { homepageSeed.current = null; setGate(null); setStep(0); setFurthestStep(0); setLookupNotice(''); }
    setAnswers(current => updatePartExchangeAnswer(current, key, value)); setReviewed(false); setLaunchError('');
  };
  const discardDraft = () => {
    homepageSeed.current = null; clearHomepagePartExchangeLookup();
    discardPartExchangeDraft(draftKey); setAnswers({ details: { ...emptyDetails } }); setGate(null); setVehicleId(vehicle?.id ?? ''); setDelivery('website'); setMessageDraft(emptyMessage);
    setDraftRestored(false); setReviewed(false); setStep(0); setFurthestStep(0); setOpened(false); setLaunchError(''); setLookupNotice(''); mutation.reset();
  };
  const foundCar = (result: PartExchangeMotDetailsResult) => {
    if (activePlate.current !== result.registration) return;
    setAnswers(current => applyPartExchangeMotDetails(current, result));
    setGate({ registration: result.registration, mode: 'lookup', result }); setLookupNotice(''); setReviewed(false);
  };
  const manualEntry = () => {
    if (!isUKNumberPlate(registration)) { setLookupNotice('Enter your complete UK registration before continuing manually.'); return; }
    setGate({ registration, mode: 'manual' }); setLookupNotice(''); setReviewed(false);
  };
  const canVisitStep = (index: number) => index === 0 || (index <= furthestStep && carDetailsReady && (index === 1 || targetReady));

  function chooseTarget(nextVehicleId: string | null) {
    vehicleTouched.current = true;
    setVehicleId(nextVehicleId);
    setPickerOpen(false);
    setReviewed(false);
    setOpened(false);
    setLaunchError('');
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings.partExchange?.enabled || !features.enabled('partExchange') || mutation.isPending || submitting.current) return;
    if (!hasCurrentCar) { if (!isUKNumberPlate(registration)) setLookupNotice('Enter your complete UK registration to find your car.'); else lookupButton.current?.click(); return; }
    if (!carDetailsReady) return;
    if (step < 2) { if (step === 1 && !targetReady) return; setStep(step + 1); setFurthestStep(value => Math.max(value, step + 1)); return; }
    const phoneInput = event.currentTarget.elements.namedItem('partExchangePhone') as HTMLInputElement;
    if (!phoneValid(details.phone)) { phoneInput.setCustomValidity('Enter a valid phone number with 7–15 digits.'); phoneInput.reportValidity(); return; }
    if (!ready || !reviewed || details.name.trim().length < 2) return;
    if (delivery === 'website') {
      const condition = details.condition ? details.condition.split(' — ')[0].toLowerCase() as NonNullable<EnquiryInput['partExchange']>['condition'] : null;
      submitting.current = true; setLaunchError('');
      mutation.mutate({ data: { type: 'part_exchange', vehicleId: selectedVehicle?.id ?? null, customerName: details.name.trim(), email: details.email.trim() || null, phone: details.phone.replace(/[\s().\-/]/g, ''), preferredContact: whatsAppHref ? 'whatsapp' : 'phone', message: message.trim(), appointmentAt: null, visitorId: getVisitorId(), partExchange: { registration: details.registration.trim().toUpperCase(), mileage: Number(details.mileage), condition } } }, { onSettled: () => { submitting.current = false; } });
      return;
    }
    if (!whatsAppHref) return;
    try { window.open(whatsAppHref, '_blank', 'noopener,noreferrer'); setOpened(true); setLaunchError(''); }
    catch { setLaunchError('WhatsApp couldn’t open. Please try again or call us.'); }
  }

  if (mutation.isSuccess) {
    const photoHref = getWhatsAppHref(`Hello ${settings.identity.name}, here are the photos for my part-exchange enquiry. My car: ${details.registration.trim().toUpperCase()} ${details.makeModel.trim() ? `(${details.makeModel.trim()})` : ''}. Name: ${details.name.trim()}. Phone: ${details.phone.trim()}.`, settings);
    return <div className="space-y-5" data-testid="status-part-exchange-success"><h2 ref={heading} tabIndex={-1} id="enquiry-form-heading" className="font-display text-2xl font-semibold outline-none">We’ve received your part-exchange enquiry.</h2><p>The team will contact you during opening hours.</p>{photoHref ? <><a href={photoHref} target="_blank" rel="noopener noreferrer" className="text-link min-h-11" data-testid="link-part-exchange-photos">Send photos through WhatsApp</a><p className="text-sm text-muted-foreground">Send the prefilled message, then attach your car photos in WhatsApp. Photos are not attached automatically.</p></> : <p>Please call us to arrange how to share photos.</p>}{phoneHref && <a href={phoneHref} className="text-link min-h-11">Call us</a>}</div>;
  }
  if (!settings.partExchange?.enabled || !features.enabled('partExchange')) return <FeatureUnavailable title="Online part-exchange requests are currently unavailable" loading={features.isLoading} error={features.isError} retry={() => void features.refetch()} />;

  return <form onSubmit={submit} className="part-exchange-form space-y-6" data-testid="form-part-exchange">
    {draftRestored && <div className="part-exchange-draft-notice" role="status"><p>{hasCurrentCar ? 'Your unfinished part-exchange answers were restored.' : 'Your unfinished part-exchange enquiry was restored. Find your car again to check its details, or choose manual entry.'}</p><button type="button" className="text-link min-h-11" onClick={discardDraft}>Discard draft</button></div>}
    <fieldset disabled={mutation.isPending} className="min-w-0 space-y-6"><legend className="sr-only">Part-exchange enquiry</legend>
      {hasCurrentCar && <nav className="part-exchange-steps" aria-label="Part-exchange steps">{steps.map((label, index) => <button key={label} type="button" disabled={!canVisitStep(index)} aria-current={step === index ? 'step' : undefined} onClick={event => { if (index <= step || event.currentTarget.form?.reportValidity()) setStep(index); }}><span>{index + 1}</span>{label}</button>)}</nav>}
      <div><h2 ref={heading} tabIndex={-1} id="enquiry-form-heading" className="font-display text-2xl font-semibold outline-none">{!hasCurrentCar ? 'Enter your registration' : steps[step]}</h2>{hasCurrentCar && <p className="mt-2 text-sm leading-6 text-muted-foreground">{['Confirm your car’s mileage.', 'Add a car from our stock, if you have one in mind.', 'Check your message and choose how to send it.'][step]}</p>}</div>
      {step === 0 && <div className="part-exchange-current-car space-y-5">
        <div className="part-exchange-registration"><label className="block"><span className={hasCurrentCar ? 'field-label' : 'sr-only'}>Your registration</span><UKNumberPlate value={details.registration} editable onChange={value => update('registration', value)} testId="visual-uk-number-plate" inputTestId="input-part-exchange-registration" /></label></div>
        <PartExchangeMotDetails registration={details.registration} mileage={details.mileage} mileageEstimated={exchangeMileageIsEstimated(answers)} lookupButtonRef={lookupButton} initialResult={hasCurrentCar && gate?.mode === 'lookup' ? gate.result : undefined} onDetails={foundCar} onManualEntry={manualEntry} />
        {lookupNotice && <p role="alert" className="text-sm">{lookupNotice}</p>}
        {hasCurrentCar && <div className="part-exchange-car-answers space-y-5">
          {gate?.mode === 'manual' && <p className="text-sm text-muted-foreground">Enter your car’s details below. You can still ask for a valuation without an MOT lookup.</p>}
          <label className="block"><span className="field-label">Make and model</span><Input required maxLength={100} value={details.makeModel} onChange={event => update('makeModel', event.target.value)} placeholder="e.g. Ford Focus" data-testid="input-part-exchange-model" /></label>
          <label className="block"><span className="field-label">Current mileage (miles)</span><Input required type="number" min={0} max={1000000} step={1} inputMode="numeric" value={details.mileage} onChange={event => update('mileage', event.target.value)} data-testid="input-part-exchange-mileage" /></label>
          <details className="part-exchange-optional"><summary>Condition and paperwork (optional)</summary><div className="space-y-4">
            <label className="block"><span className="field-label">Overall condition</span><NativeSelect value={details.condition} onChange={event => update('condition', event.target.value)}><option value="">Choose the closest description</option><option>Excellent — very little wear</option><option>Good — normal wear for its age</option><option>Fair — marks or some work needed</option><option>Poor — significant work needed</option></NativeSelect></label>
            <label className="block"><span className="field-label">How many keys do you have?</span><NativeSelect value={details.keys} onChange={event => update('keys', event.target.value)}><option value="">Select key count</option>{['0 keys', '1 key', '2 keys', '3 or more keys', 'Not sure'].map(value => <option key={value}>{value}</option>)}</NativeSelect></label>
            <label className="block"><span className="field-label">Do you have the V5C logbook?</span><NativeSelect value={details.v5} onChange={event => update('v5', event.target.value)}><option value="">Select an answer</option>{['Yes', 'No', 'Replacement requested', 'Not sure'].map(value => <option key={value}>{value}</option>)}</NativeSelect></label>
            <label className="block"><span className="field-label">Service history</span><NativeSelect value={details.serviceHistory} onChange={event => update('serviceHistory', event.target.value)}><option value="">Select an answer</option>{['Full history', 'Partial history', 'No service records', 'Not sure'].map(value => <option key={value}>{value}</option>)}</NativeSelect></label>
            <label className="block"><span className="field-label">Anything else about your car? (optional)</span><Textarea rows={3} maxLength={700} value={details.conditionNotes} onChange={event => update('conditionNotes', event.target.value)} placeholder="Condition, damage, faults or outstanding finance." /></label>
          </div></details>
        </div>}
      </div>}
      {hasCurrentCar && step === 1 && <div className="space-y-5">
        {selectedVehicle && <div className="part-exchange-selected-car" data-testid="card-part-exchange-target-vehicle">
          {getThumbnailUrl(selectedVehicle) && <img src={getThumbnailUrl(selectedVehicle)} alt="" referrerPolicy="no-referrer" />}
          <div><h3 className="font-display text-xl font-semibold">{vehicleDisplayTitle(selectedVehicle)}</h3>
            {customerRegistrationDetails(selectedVehicle) && <p className="mt-1 text-sm text-muted-foreground">{customerRegistrationDetails(selectedVehicle)}</p>}
            {selectedVehicle.price != null && <p className="mt-1 font-semibold">{formatPrice(selectedVehicle.price, selectedVehicle.currency)}</p>}
          </div>
        </div>}
        {!currentCars.length && <p className="text-sm text-muted-foreground">There are no cars to choose from right now. You can still ask about part exchange.</p>}
        <div className="part-exchange-target-options">
          {currentCars.length > 0 && <Button ref={pickerTrigger} type="button" variant="outline" aria-haspopup="dialog" onClick={() => setPickerOpen(true)}>
            <Search aria-hidden="true" />{selectedVehicle ? 'Change car' : 'Search our cars'}
          </Button>}
          <Button type="button" variant="outline" aria-pressed={noCarChosen} onClick={() => chooseTarget(null)}>
            {noCarChosen && <Check aria-hidden="true" />}I haven’t chosen a car yet
          </Button>
        </div>
        <EnquiryCarPicker open={pickerOpen} onOpenChange={setPickerOpen} cars={currentCars} currentId={selectedVehicle?.id} onSelect={car => chooseTarget(car.id)} purpose="part-exchange" returnFocus={pickerTrigger} />
      </div>}
      {hasCurrentCar && step === 2 && <div className="space-y-5">
        <div className="part-exchange-review-car"><strong>{details.makeModel} ({details.registration.toUpperCase()})</strong><p>{exchangeMileageIsEstimated(answers) ? 'Estimated mileage' : 'Current mileage'}: {Number(details.mileage).toLocaleString('en-GB')} miles</p>{partExchangeMotSummary(lookupMot) && <p>{partExchangeMotSummary(lookupMot)}</p>}{selectedVehicle && <p>Interested in: {vehicleDisplayTitle(selectedVehicle)}</p>}{noCarChosen && <p>You haven’t chosen your next car yet.</p>}</div>
        {!targetReady && <p role="alert">Your selected car is no longer available. Go back to choose another car or continue without one.</p>}
        <fieldset className="part-exchange-contact"><legend className="sr-only">Your contact details</legend>
          <label className="block"><span className="field-label">Your name</span><Input required minLength={2} maxLength={120} value={details.name} autoComplete="name" onChange={event => update('name', event.target.value)} data-testid="input-customer-name" /></label>
          <label className="block"><span className="field-label">Contact number</span><Input name="partExchangePhone" required type="tel" inputMode="tel" maxLength={25} value={details.phone} autoComplete="tel" onChange={event => { event.target.setCustomValidity(''); update('phone', event.target.value); }} data-testid="input-customer-phone" /></label>
          <label className="block"><span className="field-label">Email address (optional)</span><Input type="email" maxLength={254} value={details.email} autoComplete="email" onChange={event => update('email', event.target.value)} data-testid="input-customer-email" /></label>
        </fieldset>
        <PrivacyNoticeLink url={settings.legal?.privacyUrl} />
        <label className="block"><span className="field-label">Your message</span><Textarea required rows={7} maxLength={2000} value={message} onChange={event => { setMessageDraft({ text: event.target.value, source: generatedMessage, edited: true }); setReviewed(false); }} data-testid="part-exchange-message-preview" /></label>
        {messageNeedsRefresh && <div className="part-exchange-message-update" role="status"><p>Your car details or selected vehicle changed. Your edited message has been kept. Update it with the latest details, or confirm you want to keep your wording before sending.</p><button type="button" onClick={() => { setMessageDraft(emptyMessage); setReviewed(false); }}>Update message with latest details</button><button type="button" onClick={() => { setMessageDraft(current => ({ ...current, source: generatedMessage })); setReviewed(false); }}>Keep my wording</button></div>}
        {message.length > 2000 && <p role="alert">Shorten your message by {message.length - 2000} characters before sending.</p>}
        {whatsAppHref ? <fieldset className="part-exchange-send-method"><legend>How would you like to send it?</legend><label><input type="radio" name="partExchangeDelivery" checked={delivery === 'website'} onChange={() => { setDelivery('website'); setReviewed(false); setOpened(false); }} />Send details here. You can add photos on WhatsApp later.</label><label><input type="radio" name="partExchangeDelivery" checked={delivery === 'whatsapp'} onChange={() => { setDelivery('whatsapp'); setReviewed(false); setOpened(false); }} />Send everything on WhatsApp</label></fieldset> : <p className="text-sm text-muted-foreground">Send your details here. We’ll contact you about your part exchange and arrange how to share photos.</p>}
        {delivery === 'whatsapp' && <div className="text-sm"><p>Your contact details will also be included in WhatsApp:</p><p>Name: {details.name || 'Not entered'}</p><p>Phone: {details.phone || 'Not entered'}</p>{details.email && <p>Email: {details.email}</p>}</div>}
        <label className="part-exchange-review-confirm"><input type="checkbox" required checked={reviewed} onChange={event => setReviewed(event.target.checked)} />I’ve checked the details and message and want to share them with {settings.identity.name}.</label>
        <p className="text-xs text-muted-foreground">We’ll talk you through your options. Any part-exchange offer depends on inspecting your car.</p>
        {opened && <p role="status">Tap Send in WhatsApp, then attach any photos. No enquiry was saved on this website.</p>}
        {mutation.isError && <p role="alert">We couldn’t confirm receipt. Your answers are still here. Please contact the showroom before sending again so we can check whether your enquiry arrived.</p>}
        {launchError && <p role="alert">{launchError}</p>}
      </div>}
      {hasCurrentCar && <div className="part-exchange-actions">{step > 0 && <Button type="button" variant="ghost" onClick={() => setStep(step - 1)}><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back</Button>}<Button type="submit" disabled={mutation.isPending || !carDetailsReady || (step === 1 && !targetReady) || (step === 2 && !ready)} data-testid="button-part-exchange-continue">{step === 2 ? <><MessageSquare className="h-4 w-4" aria-hidden="true" />{mutation.isPending ? 'Sending details…' : delivery === 'website' ? 'Send my details' : 'Open WhatsApp'}</> : <>Continue<ArrowRight className="h-4 w-4" aria-hidden="true" /></>}</Button></div>}
    </fieldset>
    {hasCurrentCar && <p className="part-exchange-draft-help">Unsent answers are kept in this browser tab for 30 minutes.</p>}
  </form>;
}
