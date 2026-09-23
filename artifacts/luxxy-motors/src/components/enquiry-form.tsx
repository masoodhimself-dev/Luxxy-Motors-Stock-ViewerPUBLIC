import { UKNumberPlate } from '@/components/uk-number-plate';
import { PartExchangeForm } from '@/components/part-exchange-form';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { getGetEnquiryAvailabilityQueryKey, useCreateEnquiry, useGetEnquiryAvailability, type EnquiryInput } from '@workspace/api-client-react';
import { ArrowRight, CalendarDays, CalendarPlus, Check, CheckCircle2, CircleAlert, Clock3, Mail, MessageSquare, Phone, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { Car } from '@/lib/stock-context';
import { formatPrice, getThumbnailUrl, vehicleDisplayTitle } from '@/lib/utils';
import { getPhoneHref, getWhatsAppHref, type EnquiryType } from '@/lib/cta-helpers';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { getVisitorId } from '@/lib/visitor';
import { trackEvent } from '@/lib/analytics';

const typeLabels: Record<EnquiryType, string> = {
  viewing: 'Book a viewing',
  general: 'General enquiry',
  delivery: 'Delivery enquiry',
  warranty: 'Warranty enquiry',
  part_exchange: 'Part exchange valuation',
};

const bookingTimezone = 'Europe/London';

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

function dateString(date: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: bookingTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function bookingDates() {
  const dates: string[] = [];
  const today = dateString(new Date());
  for (let offset = 0; offset <= 30 && dates.length < 14; offset += 1) {
    const candidate = addDays(today, offset);
    const weekday = new Date(`${candidate}T00:00:00.000Z`).getUTCDay();
    if (weekday !== 0) dates.push(candidate);
  }
  return dates;
}

function dateParts(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: bookingTimezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).formatToParts(new Date(`${value}T12:00:00Z`));
}

function formatDateLabel(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: bookingTimezone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${value}T12:00:00Z`));
}

function formatAppointment(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: bookingTimezone,
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(new Date(value));
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
  vehicle,
  stockCars = [],
  initialMessage = '',
  onTypeChange,
  onChangeCar,
}: {
  initialType?: EnquiryType;
  initialMessage?: string;
  vehicle?: Car;
  stockCars?: Car[];
  onTypeChange?: (type: EnquiryType) => void;
  onChangeCar?: () => void;
}) {
  const { settings: dealerConfig } = useDealerSettings();
  const [type, setType] = useState<EnquiryType>(initialType);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [hasPartExchange, setHasPartExchange] = useState(false);
  const [exchange, setExchange] = useState({ registration: '', mileage: '', notes: '' });
  const exchangeSummary = hasPartExchange && vehicle ? [
    'Part exchange', `Registration: ${exchange.registration.trim().toUpperCase()}`,
    `Mileage: ${exchange.mileage} miles`, `Other details: ${exchange.notes.trim() || 'None supplied'}`,
  ].join('\n') : '';
  const messageLimit = 2000 - (exchangeSummary ? exchangeSummary.length + 2 : 0);
  const [viewingVehicleId, setViewingVehicleId] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [preferredContact, setPreferredContact] = useState<PreferredContact>('email');
  const [message, setMessage] = useState(initialMessage);
  const messageTouched = useRef(false);
  useEffect(() => {
    if (!messageTouched.current && initialMessage) setMessage(initialMessage);
  }, [initialMessage]);
  const [selectedDate, setSelectedDate] = useState(() => bookingDates()[0] ?? dateString(new Date()));
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [viewingStep, setViewingStep] = useState<1 | 2>(initialType === 'viewing' ? 1 : 2);
  const mutation = useCreateEnquiry();
  useEffect(() => {
    setType(initialType);
    mutation.reset();
  }, [initialType, mutation.reset]);
  const isViewing = type === 'viewing';
  const dates = useMemo(() => bookingDates(), []);
  const availabilityQuery = useGetEnquiryAvailability(
    { date: selectedDate },
    {
      query: {
        queryKey: getGetEnquiryAvailabilityQueryKey({ date: selectedDate }),
        enabled: isViewing && Boolean(vehicle) && Boolean(selectedDate),
        staleTime: 30_000,
      },
    },
  );

  const isPartExchange = type === 'part_exchange';
  const selectedVehicle = vehicle;
  const vehicleLabel = selectedVehicle?.title || [selectedVehicle?.make, selectedVehicle?.model].filter(Boolean).join(' ') || 'selected vehicle';
  const availableSlots = availabilityQuery.data?.slots.filter((slot) => slot.available) ?? [];
  const selectedSlotLabel = availabilityQuery.data?.slots.find((slot) => slot.startAt === selectedSlot)?.label;
  const phoneRequired = isViewing || preferredContact !== 'email';
  const phoneHref = getPhoneHref(dealerConfig);
  const whatsAppHref = getWhatsAppHref(undefined, dealerConfig);

  useEffect(() => {
    setSelectedSlot(null);
  }, [selectedDate, type]);

  useEffect(() => {
    setViewingStep(type === 'viewing' ? 1 : 2);
  }, [type]);

  useEffect(() => {
    if (selectedSlot && availabilityQuery.data && !availabilityQuery.data.slots.some((slot) => slot.startAt === selectedSlot && slot.available)) {
      setSelectedSlot(null);
    }
  }, [availabilityQuery.data, selectedSlot]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isViewing && (!vehicle || !selectedSlot)) return;
    if (message.trim().length > messageLimit) return;
    const normalizedPhone = normalisePhone(phone);
    if (phone.trim() && !normalizedPhone) {
      setPhoneError('Enter a valid UK or international phone number, including at least 7 digits.');
      return;
    }
    if (!normalizedPhone && phoneRequired) {
      setPhoneError(preferredContact === 'whatsapp' ? 'Enter a mobile number so we can WhatsApp you.' : 'Enter a phone number so we can reach you.');
      return;
    }
    const data: EnquiryInput = {
      vehicleId: vehicle?.id ?? null,
      type,
      customerName: customerName.trim(),
      email: email.trim(),
      phone: normalizedPhone,
      preferredContact,
      message: [message.trim() || (isViewing ? `Viewing appointment requested for ${formatAppointment(selectedSlot!)}` : ''), exchangeSummary].filter(Boolean).join('\n\n'),
      appointmentAt: isViewing ? selectedSlot : null,
      partExchange: hasPartExchange && vehicle ? {
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
          trackEvent('enquiry_completed', {
            enquiry_type: type,
            vehicle_context: Boolean(data.vehicleId),
            preferred_contact: preferredContact,
          });
        },
      },
    );
  };

  if (isPartExchange) return <PartExchangeForm vehicle={vehicle} stockCars={stockCars} />;

  if (isViewing && !vehicle) {
    const choice = stockCars.find(car => car.id === viewingVehicleId);
    return (
      <section aria-labelledby="enquiry-form-heading" data-testid="viewing-vehicle-required">
        <p className="luxxy-label text-accent">Your viewing</p>
        <h2 id="enquiry-form-heading" className="mt-3 font-display text-2xl font-semibold text-primary">Choose a car to view</h2>
        <p className="mt-3 text-sm leading-7 text-muted-foreground">Select a vehicle before choosing your appointment. This helps us prepare the right car for your visit.</p>
        <fieldset className="mt-6">
          <legend className="field-label mb-3">Which car would you like to see?</legend>
          <div className="max-h-[32rem] space-y-3 overflow-y-auto p-1">
            {stockCars.map(car => (
              <label key={car.id} className={`relative flex cursor-pointer items-center gap-3 border p-3 transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-accent ${viewingVehicleId === car.id ? 'border-accent bg-accent/5' : 'border-border hover:border-primary/50'}`}>
                <input type="radio" name="viewing-vehicle" value={car.id}
                  checked={viewingVehicleId === car.id}
                  onChange={() => setViewingVehicleId(car.id)}
                  className="h-4 w-4 shrink-0 accent-primary"
                  aria-label={`Select ${vehicleDisplayTitle(car)}`} />
                <div className="aspect-[4/3] w-20 shrink-0 overflow-hidden bg-muted sm:w-32">
                  {getThumbnailUrl(car) ? <img src={getThumbnailUrl(car)} alt="" loading="lazy" width={160} height={120} className="h-full w-full object-cover" /> : <span className="flex h-full items-center p-2 text-xs text-muted-foreground">Photo to follow</span>}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold leading-snug text-primary">{vehicleDisplayTitle(car)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{[car.year, car.transmission].filter(Boolean).join(' · ')}</p>
                  <p className="mt-2 font-semibold text-primary">{car.price ? formatPrice(car.price, car.currency) : 'Price on application'}</p>
                </div>
              </label>
            ))}
          </div>
        </fieldset>
        {choice ? (
          <Button asChild className="mt-5 w-full"><Link href={`/enquire?type=viewing&vehicleId=${encodeURIComponent(choice.id)}`}>Choose date and time <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
        ) : (
          <Button type="button" disabled className="mt-5 w-full">Select a car to continue</Button>
        )}
        {!stockCars.length && <p className="mt-4 text-sm text-muted-foreground">No vehicles are available to select here. Browse current stock or contact the team for help.</p>}
      </section>
    );
  }

  if (mutation.isSuccess) {
    return (
      <div className="luxxy-reveal py-4 text-center" data-testid="status-enquiry-success">
        <span className="mx-auto grid h-14 w-14 place-items-center border border-border bg-secondary/50 text-accent">
          <CheckCircle2 className="h-6 w-6" />
        </span>
        <p className="luxxy-label mt-7 text-accent">{isViewing ? 'Your visit is reserved' : 'Message received'}</p>
        <h2 className="mt-4 font-display text-[2.1rem] font-semibold leading-[1.04] tracking-[-.035em] text-primary sm:text-[2.5rem]">
          {isViewing ? 'See you at the showroom.' : 'We will be in touch.'}
        </h2>
        <p className="mx-auto mt-5 max-w-md text-sm leading-7 text-primary/70">
          {isViewing
            ? `Thank you, ${customerName.trim()}. We have held your appointment for ${formatAppointment(selectedSlot!)}.`
            : `Thank you, ${customerName.trim()}. The ${dealerConfig.identity.name} team has your request and will be in touch.`}
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
                {mutation.data.customerNotificationStatus === 'sent' ? 'Confirmation email sent' : 'Confirmation email not sent'}
              </p>
              <p className="mt-1 text-xs leading-5 text-primary/70">
                {mutation.data.customerNotificationStatus === 'sent'
                  ? `We sent your reference and ${isViewing ? 'viewing details' : 'enquiry details'} to ${email.trim()}.`
                  : `Please contact the showroom by phone or WhatsApp and quote ${mutation.data.reference}.`}
              </p>
              {mutation.data.customerNotificationStatus !== 'sent' && (phoneHref || whatsAppHref) && (
                <div className="mt-3 flex flex-wrap gap-3 text-xs font-bold text-accent">
                  {phoneHref && <a href={phoneHref} className="underline underline-offset-4" data-testid="link-fallback-call">Call {dealerConfig.contact.phone}</a>}
                  {whatsAppHref && <a href={whatsAppHref} className="underline underline-offset-4" data-testid="link-fallback-whatsapp">WhatsApp us</a>}
                </div>
              )}
            </div>
          </div>
        </div>
        {isViewing && mutation.data.managePath && (
          <div className="mx-auto mt-4 flex max-w-sm flex-col gap-3 border border-border/70 bg-secondary/35 p-4 text-left sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2.5">
              <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              <div>
                <p className="text-sm font-bold text-primary">Manage your viewing</p>
                <p className="mt-1 text-xs leading-5 text-primary/70">Reschedule or cancel using your secure link.</p>
              </div>
            </div>
            <Button asChild type="button" variant="outline" size="sm" className="h-9 shrink-0 rounded-md border-border bg-background text-xs font-bold shadow-none">
              <Link href={mutation.data.managePath}>Manage viewing</Link>
            </Button>
          </div>
        )}
        {isViewing && mutation.data.calendarIcs && (
          <a
            href={`data:text/calendar;charset=utf-8,${encodeURIComponent(mutation.data.calendarIcs)}`}
            download={`luxxy-viewing-${mutation.data.reference}.ics`}
            className="mx-auto mt-4 inline-flex items-center gap-2 text-xs font-bold text-accent underline underline-offset-4"
            data-testid="link-download-calendar"
          >
            <CalendarPlus className="h-4 w-4" /> Add to calendar
          </a>
        )}
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

  return (
    <form onSubmit={submit} className="space-y-4 sm:space-y-6" data-testid="form-enquiry">
      <div className="flex items-start justify-between gap-5 border-b border-border/70 pb-4 sm:pb-6">
        <div>
          <p className="luxxy-label text-accent">{isViewing ? `Step ${viewingStep} of 2` : 'Your details'}</p>
          <h2 id="enquiry-form-heading" className="mt-2 font-display text-xl font-semibold leading-tight tracking-tight text-primary sm:mt-3 sm:text-2xl">
            {isViewing ? (viewingStep === 1 ? 'Choose a date and time' : 'Your contact details') : 'How can we help?'}
          </h2>
          <p className={`mt-2 max-w-md text-sm leading-6 text-primary/70 sm:mt-3 sm:leading-7 ${isViewing && viewingStep === 1 ? 'hidden sm:block' : ''}`}>
            {isViewing
              ? viewingStep === 1
                ? 'Pick your date and time first. You can add your details next.'
                : 'Add your contact details to confirm your booking.'
              : 'Tell us what you would like to know and how to contact you.'}
          </p>
        </div>
      </div>

      {vehicle && !isPartExchange && (
        <div className="flex items-start justify-between gap-3 lg:hidden" data-testid="card-enquiry-vehicle">
          <div className="min-w-0">
            <p className="luxxy-label text-primary/70">Your selected car</p>
            <p className="mt-1.5 text-sm font-semibold leading-5 text-primary">{vehicleLabel}</p>
          </div>
          <div className="shrink-0 text-right">
            {vehicle.price != null && <p className="luxxy-price-inline text-sm font-semibold text-primary">{formatPrice(vehicle.price, vehicle.currency)}</p>}
            <Link href="/#stock" onClick={(event) => { if (onChangeCar) { event.preventDefault(); onChangeCar(); } }} className="inline-flex min-h-11 items-center text-xs text-accent underline underline-offset-4 transition-colors hover:text-primary">
              Change car
            </Link>
          </div>
        </div>
      )}

      {isViewing && viewingStep === 2 && selectedSlotLabel && (
        <div className="flex items-center justify-between gap-4 border border-primary/20 bg-primary/5 px-4 py-3.5" data-testid="card-selected-viewing">
          <div>
            <p className="luxxy-label text-accent">Selected appointment</p>
            <p className="mt-1.5 text-sm font-bold text-primary">{selectedSlotLabel} · {formatDateLabel(selectedDate)}</p>
          </div>
          <button type="button" onClick={() => setViewingStep(1)} className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center px-2 text-xs font-bold text-accent underline underline-offset-4">
            Change
          </button>
        </div>
      )}

      {(!isViewing || viewingStep === 2) && (
        <>
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="block">
              <span className={labelClass}>Your name</span>
              <Input ref={nameInputRef} required minLength={2} maxLength={120} value={customerName} onChange={(event) => setCustomerName(event.target.value)} autoComplete="name" placeholder="Your full name" className="h-11" data-testid="input-customer-name" />
            </label>
            <label className="block">
              <span className={labelClass}><Mail className="h-3.5 w-3.5 text-accent" />Email address</span>
              <Input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="you@example.com" className="h-11" data-testid="input-customer-email" />
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
                onInvalid={(event) => { event.preventDefault(); setPhoneError('Enter a valid phone number, including at least 7 digits.'); }}
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

          {!isViewing && (
            <label className="block">
              <span className={labelClass}>What can we help with?</span>
              <NativeSelect value={type} onChange={(event) => { const nextType = event.target.value as EnquiryType; setType(nextType); onTypeChange?.(nextType); }} data-testid="select-enquiry-type">
                {Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </NativeSelect>
            </label>
          )}
        </>
      )}

      {/* min-w-0 stops the browser's default fieldset min-content sizing from letting the
          scrollable date strip push the whole panel wider than the card. */}
      {isViewing && viewingStep === 1 && (
        <fieldset className="luxxy-reveal luxxy-reveal-1 min-w-0 space-y-5 border-t border-border pt-5 lg:border-t-0 lg:pt-0" data-testid="section-viewing-availability">
          <legend className="sr-only">Choose a time to visit</legend>
          <p className="text-xs leading-relaxed text-muted-foreground">30-minute visits · Monday to Saturday · 10:00–18:00 · London time</p>
          <label className="block sm:hidden" data-testid="label-viewing-date-mobile">
            <span className="sr-only">Choose a viewing date</span>
            <NativeSelect
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
              aria-label="Choose a viewing date"
              className="h-12"
              data-testid="select-viewing-date"
            >
              {dates.map((date) => <option key={date} value={date}>{formatDateLabel(date)}</option>)}
            </NativeSelect>
          </label>
          <div role="group" aria-label="Choose a viewing date" className="no-scrollbar hidden gap-2 overflow-x-auto pb-1 sm:flex" data-testid="group-viewing-dates">
            {dates.map((date) => {
              const parts = dateParts(date);
              const weekday = parts.find((part) => part.type === 'weekday')?.value ?? '';
              const day = parts.find((part) => part.type === 'day')?.value ?? '';
              const month = parts.find((part) => part.type === 'month')?.value ?? '';
              return (
                <button
                  key={date}
                  type="button"
                  onClick={() => setSelectedDate(date)}
                  aria-label={`Select ${formatDateLabel(date)}`}
                  aria-pressed={selectedDate === date}
                  className={`min-w-[76px] border px-3 py-3 text-center transition-colors ${selectedDate === date ? 'border-primary bg-primary text-primary-foreground shadow-[2px_2px_0px_hsl(var(--accent))]' : 'border-border bg-background text-primary/70 hover:border-accent hover:text-primary'}`}
                  data-testid={`button-viewing-date-${date}`}
                >
                  <span className="luxxy-label block opacity-75">{weekday}</span>
                  <span className="mt-1.5 block font-display text-2xl font-semibold leading-none tracking-[-.03em]">{day}</span>
                  <span className="luxxy-label mt-1.5 block opacity-75">{month}</span>
                </button>
              );
            })}
          </div>
          <div className="border-t border-border/70 pt-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="luxxy-label text-primary/70">Available times</p>
              {availableSlots.length > 0 && <p className="font-mono text-[13px] font-medium text-primary">{availableSlots.length} times open</p>}
            </div>
            {availabilityQuery.isLoading ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="loading-availability">
                {[1, 2, 3, 4].map((item) => <div key={item} className="h-12 animate-pulse bg-primary/10 border border-primary/20" />)}
              </div>
            ) : availabilityQuery.isError ? (
              <div role="alert" className="flex items-start gap-2.5 border border-[#c9a49c] bg-[#f7ece9] p-3 text-[13px] leading-6 text-[#8d3e34]" data-testid="status-availability-error">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> We couldn’t load the times for this day. Please choose another date.
              </div>
            ) : availableSlots.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="group-viewing-slots">
                {availabilityQuery.data?.slots.map((slot) => (
                  <button
                    key={slot.startAt}
                    type="button"
                    disabled={!slot.available}
                    onClick={() => setSelectedSlot(slot.startAt)}
                    aria-label={`${slot.label}${slot.available ? '' : ' unavailable'}`}
                    aria-pressed={selectedSlot === slot.startAt}
                    className={`flex h-11 items-center justify-center gap-2 border px-3 font-mono text-[13px] font-bold transition-colors ${selectedSlot === slot.startAt ? 'border-primary bg-primary text-primary-foreground shadow-[2px_2px_0px_hsl(var(--accent))]' : slot.available ? 'border-border bg-background text-foreground hover:border-accent hover:text-primary' : 'cursor-not-allowed border-border/50 bg-secondary/40 text-muted-foreground line-through'}`}
                    data-testid={`button-viewing-slot-${slot.startAt}`}
                  >
                    {selectedSlot === slot.startAt && <Check className="h-4 w-4" />}
                    {slot.label}
                  </button>
                ))}
              </div>
            ) : (
               <p className="border border-accent/50 bg-background p-4 text-[13px] font-normal text-accent" data-testid="status-availability-empty">That day is now full. Please choose another date and we’ll find a good time for you.</p>
            )}
          </div>
          <div className="flex items-start gap-2.5 text-[13px] leading-6 text-primary/70">
            <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
             {selectedSlotLabel ? <span><strong className="font-bold text-primary">Your visit:</strong> {selectedSlotLabel} · {formatDateLabel(selectedDate)}</span> : <span>Choose any open time that suits you.</span>}
          </div>
        </fieldset>
      )}

      {(!isViewing || viewingStep === 2) && (
        <>
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
        <label className="block">
          <span className={labelClass}><MessageSquare className="h-3.5 w-3.5 text-accent" />Anything else we should know?</span>
          <Textarea
            required={!isViewing && !hasPartExchange}
            minLength={isViewing ? undefined : 1}
            maxLength={messageLimit}
            rows={4}
            value={message}
            onChange={(event) => { messageTouched.current = true; setMessage(event.target.value); }}
            placeholder={isViewing ? 'Anything you would like us to prepare?' : `How can the ${dealerConfig.identity.name} team help?`}
            data-testid="textarea-enquiry-message"
          />
        </label>
        {message.length > messageLimit && <p role="alert" className="text-sm text-destructive">Please shorten your message by {message.length - messageLimit} characters to include your part-exchange details.</p>}
        </>
      )}

      {mutation.isError && (
        <div role="alert" className="flex items-start gap-3 border border-destructive/50 bg-background p-4 text-[13px] font-normal text-destructive" data-testid="status-enquiry-error">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{apiErrorMessage(mutation.error)}</span>
        </div>
      )}
      <div className="space-y-4">
        {isViewing && viewingStep === 1 ? (
          <Button
            key="continue-details"
            type="button"
            size="lg"
            disabled={!selectedSlot || availabilityQuery.isLoading}
            onClick={(event) => { event.preventDefault(); setViewingStep(2); requestAnimationFrame(() => nameInputRef.current?.focus()); }}
            className="group min-h-12 w-full rounded-md font-display text-[13px] font-semibold tracking-normal shadow-none transition-all"
            data-testid="button-continue-to-details"
          >
            Continue to your details
            <ArrowRight className="ml-3 h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Button>
        ) : (
          <Button key="submit-enquiry" type="submit" size="lg" disabled={mutation.isPending} className="group min-h-12 w-full rounded-md font-display text-[13px] font-semibold tracking-normal shadow-none transition-all" data-testid="button-submit-enquiry">
            {mutation.isPending ? (isViewing ? 'Reserving your visit…' : 'Sending enquiry…') : isViewing ? 'Reserve my viewing' : `Send ${typeLabels[type].toLowerCase()}`}
            {!mutation.isPending && <ArrowRight className="ml-3 h-4 w-4 transition-transform group-hover:translate-x-1" />}
          </Button>
        )}
        {isViewing && viewingStep === 2 && (
          <button type="button" onClick={() => setViewingStep(1)} className="min-h-11 w-full px-3 text-center text-xs font-bold text-primary/70 underline underline-offset-4 hover:text-primary">
            Back to date and time
          </button>
        )}
        <div className="flex items-start gap-3 border-t border-border px-0 py-3 font-medium text-[13px] tracking-normal leading-relaxed text-primary/70">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
           <span>
             {isViewing && viewingStep === 1
               ? 'Choose a time first. You can add your details on the next step.'
               : isViewing
                 ? `Your details are only used to confirm this appointment. We will send your confirmation and a reminder 24 hours before (${bookingTimezone}).`
                 : `Your details are sent securely to the ${dealerConfig.identity.name} enquiry inbox. We will confirm delivery on the next screen.`}
           </span>
        </div>
      </div>
    </form>
  );
}
