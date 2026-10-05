import { showroomHours } from '@/lib/showroom-hours';
import { MobileActionDisclosure } from '@/components/mobile-action-disclosure';
import { enquiryDraftKey, readEnquiryDraft, saveEnquiryDraft, discardEnquiryDraft } from '@/lib/enquiry-draft';
import { readVehicleExchange } from '@/lib/vehicle-exchange-draft';
import { responsiveVehicleImage, retryOriginalImage } from '@/lib/responsive-vehicle-image';
import { ReserveCar } from '@/components/reserve-car';
import { UKNumberPlate } from '@/components/uk-number-plate';
import { PartExchangeForm } from '@/components/part-exchange-form';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Redirect, useLocation } from 'wouter';
import { useCreateEnquiry, type EnquiryInput } from '@workspace/api-client-react';
import { ArrowRight, CheckCircle2, CircleAlert, Mail, MessageSquare, Phone, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { Car } from '@/lib/stock-context';
import { formatPrice, getThumbnailUrl, vehicleDisplayTitle } from '@/lib/utils';
import { customerRegistrationDetails } from '@/lib/customer-vehicle-meta';
import { getPhoneHref, getWhatsAppHref, type EnquiryType } from '@/lib/cta-helpers';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { getVisitorId } from '@/lib/visitor';
import { trackEvent } from '@/lib/analytics';

const typeLabels: Record<EnquiryType, string> = {
  viewing: 'Book a test drive',
  general: 'General enquiry',
  delivery: 'Delivery enquiry',
  warranty: 'Warranty enquiry',
  part_exchange: 'Part exchange valuation',
};

const labelClass = 'field-label flex items-center gap-2';
type PreferredContact = 'email' | 'phone' | 'whatsapp';

const contactOptions: Array<{ value: PreferredContact; label: string; hint: string }> = [
  { value: 'email', label: 'Email', hint: 'Written confirmation' },
  { value: 'phone', label: 'Phone call', hint: 'Talk to the team' },
  { value: 'whatsapp', label: 'WhatsApp', hint: 'Photos and questions' },
];

function normalisePhone(value: string) {
  const compact = value.trim().replace(/[\s().\-/]/g, '');
  return /^\+?\d{7,15}$/.test(compact) ? compact : null;
}

function apiErrorMessage(error: unknown) {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: { error?: string } }).data;
    if (data?.error) return data.error;
  }
  return 'We could not send your enquiry. Please try again or call us directly.';
}

export function EnquiryForm({
  initialType = 'general',
  embedded = false,
  vehicle,
  stockCars = [],
  initialMessage = '',
  onTypeChange,
  onChangeCar,
}: {
  initialType?: EnquiryType;
  embedded?: boolean;
  initialMessage?: string;
  vehicle?: Car;
  stockCars?: Car[];
  onTypeChange?: (type: EnquiryType) => void;
  onChangeCar?: () => void;
}) {
  const { settings: dealerConfig } = useDealerSettings();
  const [, navigate] = useLocation();
  const testDrivePath = `/enquire?type=viewing${vehicle ? `&vehicleId=${encodeURIComponent(vehicle.id)}` : ''}`;
  const [type, setType] = useState<EnquiryType>(initialType);
  const [unavailableVehiclePhoto, setUnavailableVehiclePhoto] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);
  const successHeadingRef = useRef<HTMLHeadingElement>(null);
  const [hasPartExchange, setHasPartExchange] = useState(() => Boolean(readVehicleExchange(vehicle?.id)));
  const [exchange, setExchange] = useState(() => readVehicleExchange(vehicle?.id) ?? { registration: '', mileage: '', notes: '' });
  useEffect(() => {
    const draft = readVehicleExchange(vehicle?.id);
    if (draft) { setExchange(draft); setHasPartExchange(true); }
  }, [vehicle?.id]);
  const exchangeSummary = !embedded && hasPartExchange && vehicle ? [
    'Part exchange', `Registration: ${exchange.registration.trim().toUpperCase()}`,
    `Mileage: ${exchange.mileage} miles`, `Other details: ${exchange.notes.trim() || 'None supplied'}`,
  ].join('\n') : '';
  const messageLimit = 2000 - (exchangeSummary ? exchangeSummary.length + 2 : 0);
  const [customerName, setCustomerName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [nameError,setNameError] = useState('');
  const [emailError,setEmailError] = useState('');
  const [draftSaved,setDraftSaved] = useState(false);
  const skipDraftSave = useRef(false);
  const draftKey = enquiryDraftKey(vehicle?.id, initialType);
  const [preferredContact, setPreferredContact] = useState<PreferredContact>('email');
  const [message, setMessage] = useState(initialMessage);
  const messageTouched = useRef(false);
  useEffect(() => {
    if (!messageTouched.current && initialMessage) setMessage(initialMessage);
  }, [initialMessage]);
  const mutation = useCreateEnquiry();
  useEffect(() => {
    setType(initialType);
    mutation.reset();
  }, [initialType, mutation.reset]);
  useEffect(() => {
    skipDraftSave.current = true;
    const draft=readEnquiryDraft(draftKey);
    if (draft) {
      setCustomerName(draft.customerName);setEmail(draft.email);setPhone(draft.phone);
      setMessage(draft.message); messageTouched.current=Boolean(draft.message);
      setPreferredContact(embedded && draft.preferredContact === 'whatsapp' ? 'phone' : draft.preferredContact);setHasPartExchange(draft.hasPartExchange);setExchange(draft.exchange);
      setDraftSaved(true);
    } else setDraftSaved(false);
  }, [draftKey]);
  useEffect(() => {
    if(skipDraftSave.current) {skipDraftSave.current=false;return;}
    if(mutation.data) return;
    if(customerName || email || phone || message || exchange.registration) {
      setDraftSaved(saveEnquiryDraft(draftKey,{customerName,email,phone,message,preferredContact,hasPartExchange,exchange}));
    } else {discardEnquiryDraft(draftKey);setDraftSaved(false);}
  }, [draftKey,customerName,email,phone,message,preferredContact,hasPartExchange,exchange,mutation.data]);
  useEffect(() => {
    if(mutation.isError) document.querySelector<HTMLElement>('[data-testid="status-enquiry-error"]')?.focus();
  }, [mutation.isError]);
  useEffect(() => {
    if (mutation.isSuccess) successHeadingRef.current?.focus();
  }, [mutation.isSuccess]);
  const discardDraft = () => {
    discardEnquiryDraft(draftKey);setDraftSaved(false);
    setCustomerName('');setEmail('');setPhone('');setMessage('');messageTouched.current=true;
    setHasPartExchange(false);setExchange({registration:'',mileage:'',notes:''});
    setPhoneError('');setNameError('');setEmailError('');
  };
  const focusPhone = () => document.querySelector<HTMLInputElement>('[data-testid="input-customer-phone"]')?.focus();
  const isPartExchange = type === 'part_exchange';
  const selectedVehicle = vehicle;
  const selectedVehiclePhoto = getThumbnailUrl(selectedVehicle);
  const vehicleLabel = selectedVehicle?.title || [selectedVehicle?.make, selectedVehicle?.model].filter(Boolean).join(' ') || 'selected vehicle';
  const phoneRequired = preferredContact !== 'email';
  const phoneHref = getPhoneHref(dealerConfig);
  const whatsAppHref = getWhatsAppHref(undefined, dealerConfig);

  const changeType = (nextType: EnquiryType) => {
    if (nextType === 'viewing') {
      if (customerName || email || phone || message || exchange.registration) {
        saveEnquiryDraft(draftKey, { customerName, email, phone, message, preferredContact, hasPartExchange, exchange });
      }
      navigate(testDrivePath);
      return;
    }
    setType(nextType);
    onTypeChange?.(nextType);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (message.trim().length > messageLimit) return;
    const contactPhone = embedded && preferredContact === 'email' ? '' : phone;
    const normalizedPhone = normalisePhone(contactPhone);
    if (contactPhone.trim() && !normalizedPhone) {
      setPhoneError('Enter a valid UK or international phone number, including at least 7 digits.');
      focusPhone();
      return;
    }
    if (!normalizedPhone && phoneRequired) {
      setPhoneError(preferredContact === 'whatsapp' ? 'Enter a mobile number so we can WhatsApp you.' : 'Enter a phone number so we can reach you.');
      focusPhone();
      return;
    }
    const data: EnquiryInput = {
      vehicleId: vehicle?.id ?? null,
      type,
      customerName: customerName.trim(),
      email: embedded && preferredContact !== 'email' ? null : email.trim() || null,
      phone: embedded && preferredContact === 'email' ? null : normalizedPhone,
      preferredContact,
      message: [message.trim(), embedded ? '' : exchangeSummary].filter(Boolean).join('\n\n'),
      appointmentAt: null,
      partExchange: !embedded && hasPartExchange && vehicle ? {
        registration: exchange.registration.trim().toUpperCase(),
        mileage: Number(exchange.mileage),
        condition: null,
      } : null,
      visitorId: getVisitorId(),
    };
    trackEvent('enquiry_submitted', {
      enquiry_type: type,
      vehicle_context: Boolean(data.vehicleId),
      preferred_contact: preferredContact,
    });
    mutation.mutate(
      { data },
      {
        onSuccess: () => {
          discardEnquiryDraft(draftKey);setDraftSaved(false);
          trackEvent('enquiry_completed', {
            enquiry_type: type,
            vehicle_context: Boolean(data.vehicleId),
            preferred_contact: preferredContact,
          });
        },
      },
    );
  };

  if (type === 'viewing') return <Redirect to={testDrivePath} />;
  if (isPartExchange) return <PartExchangeForm vehicle={vehicle} stockCars={stockCars} />;

  if (mutation.isSuccess) {
    return (
      <div className="luxxy-reveal py-4 text-center" data-testid="status-enquiry-success">
        <span className="mx-auto grid h-14 w-14 place-items-center border border-border bg-secondary/50 text-accent">
          <CheckCircle2 className="h-6 w-6" />
        </span>
        <p className="luxxy-label mt-7 text-accent">Message received</p>
        <h2 ref={successHeadingRef} tabIndex={-1} className="mt-4 font-display text-[2.1rem] font-semibold leading-[1.04] tracking-[-.035em] text-primary outline-none sm:text-[2.5rem]">
          We will be in touch.
        </h2>
        <p className="mx-auto mt-5 max-w-md text-sm leading-7 text-primary/70">
          {`Thank you, ${customerName.trim()}. The ${dealerConfig.identity.name} team has your request and will be in touch.`}
        </p>
        <div className="mx-auto mt-6 max-w-sm border border-primary/20 bg-primary/5 px-5 py-4 text-left">
          <p className="luxxy-label text-accent">Your reference</p>
          <p className="mt-2 font-mono text-xl font-bold tracking-normal text-primary" data-testid="text-enquiry-reference">{mutation.data.reference}</p>
          <p className="mt-2 text-xs leading-5 text-primary/70">Keep this reference handy if you call the showroom.</p>
        </div>
        {selectedVehicle && (
          <p className="mx-auto mt-5 inline-block border border-border bg-secondary/40 px-4 py-2.5 text-sm font-bold text-primary" data-testid="text-confirmed-vehicle">
            {vehicleLabel}
          </p>
        )}
        <div className="mx-auto mt-7 max-w-sm border border-border/70 bg-background px-4 py-3.5 text-left">
          <div className="flex items-start gap-2.5">
            <Mail className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <div>
              <p className="luxxy-label text-primary/70">
                {(!email.trim() || embedded && preferredContact !== 'email') ? 'We’ll reply by phone' : mutation.data.customerNotificationStatus === 'sent' ? 'Confirmation email sent' : 'Your enquiry is saved'}
              </p>
              <p className="mt-1 text-xs leading-5 text-primary/70">
                {mutation.data.customerNotificationStatus === 'sent'
                  ? `We sent your reference and enquiry details to ${email.trim()}.`
                  : `Your enquiry is saved. We’ll reply using your chosen contact details. You do not need to send it again.`}
              </p>
              {(!embedded || preferredContact === 'email') && email.trim() && mutation.data.customerNotificationStatus !== 'sent' && (phoneHref || whatsAppHref) && (
                <div className="mt-3 flex flex-wrap gap-3 text-xs font-bold text-accent">
                  {phoneHref && <a href={phoneHref} className="underline underline-offset-4" data-testid="link-fallback-call">Call {dealerConfig.contact.phone}</a>}
                  {whatsAppHref && <a href={whatsAppHref} className="underline underline-offset-4" data-testid="link-fallback-whatsapp">WhatsApp us</a>}
                </div>
              )}
            </div>
          </div>
        </div>
        {vehicle && dealerConfig.onlineReservation?.enabled && <div className="mx-auto mt-6 max-w-sm border-t border-border pt-5">
          <ReserveCar key={vehicle.id} car={vehicle} customer={{ customerName, email, phone }} partExchange={hasPartExchange && exchange.registration && exchange.mileage ? { registration: exchange.registration, mileage: Number(exchange.mileage) } : undefined} className="w-full" />
        </div>}
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="mt-8 h-12 rounded-md border-border bg-background px-6 text-sm font-bold text-foreground shadow-none hover:border-primary/45 hover:bg-secondary hover:text-foreground"
          onClick={() => mutation.reset()}
          data-testid="button-send-another-enquiry"
        >
          Send another enquiry <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    );
  }

  if (embedded) return <form onSubmit={submit} className="space-y-5" data-testid="form-enquiry">
    <label className="block"><span className={labelClass}>What would you like to know?</span><Textarea required rows={3} maxLength={messageLimit} value={message} onChange={event => { messageTouched.current = true; setMessage(event.target.value); }} placeholder="Ask your question about this car" data-testid="textarea-enquiry-message" /></label>
    <fieldset><legend className={labelClass}>How should we reply?</legend><div className="grid grid-cols-2 gap-3">{(['email', 'phone'] as const).map(method => <label key={method} className={`flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 text-sm ${preferredContact === method ? 'border-primary bg-secondary' : 'border-border'}`}><input type="radio" name="enquiry-reply" value={method} checked={preferredContact === method} onChange={() => { setPreferredContact(method); setPhoneError(''); }} />{method === 'email' ? 'Email' : 'Phone'}</label>)}</div></fieldset>
    <label className="block"><span className={labelClass}>Your name</span><Input ref={nameInputRef} required minLength={2} maxLength={120} autoComplete="name" value={customerName} onChange={event => setCustomerName(event.target.value)} data-testid="input-customer-name" /></label>
    {preferredContact === 'email' ? <label className="block"><span className={labelClass}>Email address</span><Input required type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} data-testid="input-customer-email" /></label> : <label className="block"><span className={labelClass}>Phone number</span><Input required type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={event => { setPhone(event.target.value); setPhoneError(''); }} aria-invalid={Boolean(phoneError)} aria-describedby={phoneError ? 'inline-phone-error' : undefined} data-testid="input-customer-phone" />{phoneError && <span id="inline-phone-error" role="alert" className="text-sm text-destructive">{phoneError}</span>}</label>}
    {mutation.isError && <p role="alert" className="text-sm text-destructive">{apiErrorMessage(mutation.error)}</p>}
    <Button type="submit" disabled={mutation.isPending} className="min-h-12 w-full" data-testid="button-submit-enquiry">{mutation.isPending ? 'Sending…' : 'Send enquiry'}<ArrowRight className="h-4 w-4" /></Button>
    <p className="text-sm leading-6 text-muted-foreground">Your question is attached to {vehicleLabel}. {showroomHours(dealerConfig.hours ?? []).state === 'closed' ? 'The showroom is closed. The team will aim to reply after reopening.' : 'The team will reply during opening hours.'}</p>
  </form>;

  return (
    <form onSubmit={submit} className="space-y-4 sm:space-y-6" data-testid="form-enquiry">
      {draftSaved && <div className="flex flex-wrap items-center justify-between gap-2 border-y border-border py-3 text-xs text-muted-foreground" data-testid="enquiry-draft-notice"><p>You can restore these unfinished details in this tab for 30 minutes.</p><button type="button" onClick={discardDraft} className="text-link min-h-11 shrink-0">Discard draft</button></div>}
      <div className="flex items-start justify-between gap-5 border-b border-border/70 pb-4 sm:pb-6">
        <div>
          <p className="luxxy-label text-accent">Your details</p>
          <h2 id="enquiry-form-heading" className="mt-2 font-display text-xl font-semibold leading-tight tracking-tight text-primary sm:mt-3 sm:text-2xl">
            How can we help?
          </h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-primary/70 sm:mt-3 sm:leading-7">
            Tell us what you would like to know and how to contact you.
          </p>
        </div>
      </div>

      {vehicle && !isPartExchange && !embedded && (
        <div className="flex items-start gap-3 rounded-md border border-border bg-card p-3 sm:gap-4 sm:p-4 lg:hidden" data-testid="card-enquiry-vehicle">
          {selectedVehiclePhoto && unavailableVehiclePhoto !== selectedVehiclePhoto && (
            <img
              src={selectedVehiclePhoto}
              {...responsiveVehicleImage(selectedVehiclePhoto, '(min-width: 640px) 120px, 88px')}
              alt=""
              width={160}
              height={120}
              decoding="async"
              referrerPolicy="no-referrer"
              className="aspect-[4/3] w-[88px] shrink-0 rounded-sm border border-border bg-muted object-contain sm:w-[120px]"
              onError={event => { if (!retryOriginalImage(event.currentTarget)) setUnavailableVehiclePhoto(selectedVehiclePhoto); }}
            />
          )}
          <div className="min-w-0 flex-1">
            <p className="luxxy-label text-primary/70">Your selected car</p>
            <p className="mt-1.5 text-base font-semibold leading-snug text-primary">{vehicleDisplayTitle(vehicle)}</p>
            {(customerRegistrationDetails(vehicle) || vehicle.transmission) && <p className="mt-1 text-sm text-muted-foreground">{[customerRegistrationDetails(vehicle), vehicle.transmission].filter(Boolean).join(' · ')}</p>}
            <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3">
            {vehicle.price != null && <p className="luxxy-price-inline text-base font-semibold text-primary">{formatPrice(vehicle.price, vehicle.currency)}</p>}
            <Link href="/stock" onClick={(event) => { if (onChangeCar) { event.preventDefault(); onChangeCar(); } }} className="inline-flex min-h-11 items-center text-sm text-accent underline underline-offset-4 transition-colors hover:text-primary">
              Change car
            </Link>
            </div>
          </div>
        </div>
      )}

          <div className="grid gap-5 sm:grid-cols-2">
            <label className="block">
              <span className={labelClass}>Your name</span>
              <Input ref={nameInputRef} required minLength={2} maxLength={120} value={customerName} onChange={(event) => {setCustomerName(event.target.value);setNameError('');}} onInvalid={()=>{setNameError("Please enter your name (at least two characters).");}} aria-invalid={Boolean(nameError)} aria-describedby={nameError ? "customer-name-help" : undefined} autoComplete="name" placeholder="Your full name" className="h-11" data-testid="input-customer-name" />
              {nameError && <span id="customer-name-help" role="alert" className="mt-2 block text-sm text-destructive">{nameError}</span>}
            </label>
            <label className="block">
              <span className={labelClass}><Mail className="h-3.5 w-3.5 text-accent" />Email address</span>
              <Input required={preferredContact === 'email'} type="email" value={email} onChange={(event) => {setEmail(event.target.value);setEmailError('');}} onInvalid={()=>setEmailError("Enter an email address such as name@example.com.")} aria-invalid={Boolean(emailError)} aria-describedby={emailError ? "customer-email-help" : undefined} autoComplete="email" placeholder="you@example.com" className="h-11" data-testid="input-customer-email" />
              {emailError && <span id="customer-email-help" role="alert" className="mt-2 block text-sm text-destructive">{emailError}</span>}
            </label>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <label className="block">
              <span className={labelClass}><Phone className="h-3.5 w-3.5 text-accent" />Phone number</span>
              <Input
                required={phoneRequired}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(event) => { setPhone(event.target.value); setPhoneError(''); }}
                onInvalid={() => { setPhoneError('Enter a valid phone number, including at least 7 digits.'); }}
                placeholder="07700 900 123"
                aria-invalid={Boolean(phoneError)}
                aria-describedby={phoneError ? 'customer-phone-help' : undefined}
                className="h-11"
                data-testid="input-customer-phone"
              />
              {phoneError && <span id="customer-phone-help" className="mt-2 block text-[13px] leading-5 text-[#8d3e34]" role="alert">{phoneError}</span>}
            </label>
            <label className="block">
              <span className={labelClass}>Preferred contact</span>
              <NativeSelect value={preferredContact} onChange={(event) => setPreferredContact(event.target.value as PreferredContact)} className="h-11" data-testid="select-preferred-contact">
                {contactOptions.map((option) => <option key={option.value} value={option.value}>{option.label} · {option.hint}</option>)}
              </NativeSelect>
            </label>
          </div>

            <label className="block">
              <span className={labelClass}>What can we help with?</span>
              <NativeSelect value={type} onChange={(event) => changeType(event.target.value as EnquiryType)} data-testid="select-enquiry-type">
                {Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </NativeSelect>
            </label>

        {selectedVehicle && <fieldset className="space-y-4 border-t border-border pt-4">
          <legend className="text-sm font-semibold">Do you have a car to part-exchange?</legend>
          <div className="flex gap-3">
            {[false, true].map(value => <label key={String(value)} className={`flex min-h-12 flex-1 cursor-pointer items-center justify-center gap-2 rounded-sm border px-4 text-sm transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-accent ${hasPartExchange === value ? "border-primary bg-primary text-primary-foreground" : "border-input hover:bg-secondary"}`}>
              <input type="radio" name="has-part-exchange" checked={hasPartExchange === value} onChange={() => setHasPartExchange(value)} className="accent-primary" />
              {value ? 'Yes' : 'No'}
            </label>)}
          </div>
          {hasPartExchange && <div className="space-y-4" data-testid="enquiry-part-exchange-details">
            <p className="text-sm text-muted-foreground">Just your registration and approximate mileage for now. We can discuss condition, keys and paperwork when we speak.</p>
            <div className="max-w-sm">
              <label className="block">
                <span className={labelClass}>Registration</span>
                <UKNumberPlate value={exchange.registration} editable
                  onChange={registration => setExchange(current => ({ ...current, registration }))}
                  testId="enquiry-part-exchange-plate" />
              </label>
            </div>
            <label className="block max-w-sm">
              <span className={labelClass}>Current mileage (miles)</span>
              <Input required type="number" min={0} max={1000000} step={1} inputMode="numeric"
                value={exchange.mileage}
                onChange={event => setExchange(current => ({ ...current, mileage: event.target.value }))} />
            </label>
            <details className="border-t border-border pt-3"><summary className="min-h-11 cursor-pointer py-2 text-sm font-medium text-primary">Anything to mention? (optional)</summary><label className="block"><span className={labelClass}>Anything we should know about your car?</span>
              <Textarea rows={3} maxLength={400} value={exchange.notes} onChange={event => setExchange(current => ({ ...current, notes: event.target.value }))} />
            </label></details>
          </div>}
        </fieldset>}
        <details open={!hasPartExchange || Boolean(message) || undefined} className="border-t border-border pt-2">
          <summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">{hasPartExchange ? 'Add a message (optional)' : 'Your message'}</summary>
        <label className="block">
          <span className={labelClass}><MessageSquare className="h-3.5 w-3.5 text-accent" />Anything else we should know?</span>
          <Textarea
            required={!hasPartExchange}
            minLength={1}
            maxLength={messageLimit}
            rows={4}
            value={message}
            onChange={(event) => { messageTouched.current = true; setMessage(event.target.value); }}
            placeholder={`How can the ${dealerConfig.identity.name} team help?`}
            data-testid="textarea-enquiry-message"
          />
        </label>
        </details>
        {message.length > messageLimit && <p role="alert" className="text-sm text-destructive">Please shorten your message by {message.length - messageLimit} characters to include your part-exchange details.</p>}

      {mutation.isError && (
        <div role="alert" className="flex items-start gap-3 border border-destructive/50 bg-background p-4 text-[13px] font-normal text-destructive" data-testid="status-enquiry-error" tabIndex={-1}>
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{apiErrorMessage(mutation.error)}</span>
        </div>
      )}
      <div className="space-y-4">
        <Button key="submit-enquiry" type="submit" size="lg" disabled={mutation.isPending} className="group min-h-12 w-full rounded-md font-display text-[13px] font-semibold tracking-normal shadow-none transition-all" data-testid="button-submit-enquiry">
          {mutation.isPending ? 'Sending enquiry…' : `Send ${typeLabels[type].toLowerCase()}`}
          {!mutation.isPending && <ArrowRight className="ml-3 h-4 w-4 transition-transform group-hover:translate-x-1" />}
        </Button>
        <div className="flex items-start gap-3 border-t border-border px-0 py-3 font-medium text-[13px] tracking-normal leading-relaxed text-primary/70">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
           <span>
             {`Your details are sent securely to the ${dealerConfig.identity.name} enquiry inbox. We will confirm delivery on the next screen.`}
           </span>
        </div>
      </div>
      {vehicle && dealerConfig.onlineReservation?.enabled && (
        <MobileActionDisclosure label="Or reserve this car" className="border-t border-border pt-2" testId="enquiry-reservation-options">
          <p className="mb-3 text-xs text-muted-foreground">You can also reserve this car online. Your enquiry is submitted separately.</p>
          <ReserveCar key={vehicle.id} car={vehicle} customer={{ customerName, email, phone }} partExchange={hasPartExchange && exchange.registration && exchange.mileage ? { registration: exchange.registration, mileage: Number(exchange.mileage) } : undefined} className="w-full" />
        </MobileActionDisclosure>
      )}
    </form>
  );
}
