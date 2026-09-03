import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { getGetEnquiryAvailabilityQueryKey, useCreateEnquiry, useGetEnquiryAvailability, type EnquiryInput } from '@workspace/api-client-react';
import { ArrowRight, CalendarDays, CalendarPlus, CarFront, Check, CheckCircle2, CircleAlert, Clock3, Gauge, Mail, MessageSquare, Phone, ShieldCheck, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { Car } from '@/lib/stock-context';
import { formatPrice, getThumbnailUrl, vehicleRegistration } from '@/lib/utils';
import { getPhoneHref, getWhatsAppHref, type EnquiryType } from '@/lib/cta-helpers';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { UKNumberPlate } from '@/components/uk-number-plate';
import { getVisitorId } from '@/lib/visitor';

const typeLabels: Record<EnquiryType, string> = {
  viewing: 'Book a viewing',
  general: 'General enquiry',
  delivery: 'Delivery enquiry',
  warranty: 'Warranty enquiry',
  part_exchange: 'Part exchange valuation',
};

const bookingTimezone = 'Europe/London';

const labelClass = 'luxxy-label mb-2 flex items-center gap-1.5 text-muted-foreground';
type PreferredContact = 'email' | 'phone' | 'whatsapp';
type PartExchangeCondition = 'excellent' | 'good' | 'fair' | 'poor';

const contactOptions: Array<{ value: PreferredContact; label: string; hint: string }> = [
  { value: 'email', label: 'Email', hint: 'Written confirmation' },
  { value: 'phone', label: 'Phone call', hint: 'Quickest answer' },
  { value: 'whatsapp', label: 'WhatsApp', hint: 'Photos and questions' },
];

const conditionOptions: Array<{ value: PartExchangeCondition; label: string; hint: string }> = [
  { value: 'excellent', label: 'Excellent', hint: 'Like new, no marks' },
  { value: 'good', label: 'Good', hint: 'Light wear for its age' },
  { value: 'fair', label: 'Fair', hint: 'Some marks or work needed' },
  { value: 'poor', label: 'Poor', hint: 'Needs attention' },
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
}: {
  initialType?: EnquiryType;
  vehicle?: Car;
  stockCars?: Car[];
}) {
  const { settings: dealerConfig } = useDealerSettings();
  const [type, setType] = useState<EnquiryType>(initialType);
  const [customerName, setCustomerName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [preferredContact, setPreferredContact] = useState<PreferredContact>('email');
  const [message, setMessage] = useState('');
  const [selectedVehicleId, setSelectedVehicleId] = useState(vehicle?.id ?? '');
  const [partExchangeRegistration, setPartExchangeRegistration] = useState('');
  const [partExchangeMileage, setPartExchangeMileage] = useState('');
  const [partExchangeCondition, setPartExchangeCondition] = useState<PartExchangeCondition>('good');
  const [selectedDate, setSelectedDate] = useState(() => bookingDates()[0] ?? dateString(new Date()));
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const mutation = useCreateEnquiry();
  const isViewing = type === 'viewing';
  const dates = useMemo(() => bookingDates(), []);
  const availabilityQuery = useGetEnquiryAvailability(
    { date: selectedDate },
    {
      query: {
        queryKey: getGetEnquiryAvailabilityQueryKey({ date: selectedDate }),
        enabled: isViewing && Boolean(selectedDate),
        staleTime: 30_000,
      },
    },
  );

  const isPartExchange = type === 'part_exchange';
  const selectedStockVehicle = stockCars.find((car) => car.id === selectedVehicleId);
  const selectedVehicle = isPartExchange ? selectedStockVehicle ?? vehicle : vehicle;
  const vehicleLabel = selectedVehicle?.title || [selectedVehicle?.make, selectedVehicle?.model].filter(Boolean).join(' ') || 'selected vehicle';
  const availableSlots = availabilityQuery.data?.slots.filter((slot) => slot.available) ?? [];
  const selectedSlotLabel = availabilityQuery.data?.slots.find((slot) => slot.startAt === selectedSlot)?.label;
  const phoneRequired = isViewing || preferredContact !== 'email';
  const phoneHref = getPhoneHref(dealerConfig);
  const whatsAppHref = getWhatsAppHref(undefined, dealerConfig);

  useEffect(() => {
    if (vehicle?.id) setSelectedVehicleId(vehicle.id);
  }, [vehicle?.id]);

  useEffect(() => {
    setSelectedSlot(null);
  }, [selectedDate, type]);

  useEffect(() => {
    if (selectedSlot && availabilityQuery.data && !availabilityQuery.data.slots.some((slot) => slot.startAt === selectedSlot && slot.available)) {
      setSelectedSlot(null);
    }
  }, [availabilityQuery.data, selectedSlot]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isViewing && !selectedSlot) return;
    if (isPartExchange && !selectedVehicleId) return;
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
      vehicleId: isPartExchange ? selectedVehicleId || null : vehicle?.id ?? null,
      type,
      customerName: customerName.trim(),
      email: email.trim(),
      phone: normalizedPhone,
      preferredContact,
      message: message.trim() || (isViewing ? `Viewing appointment requested for ${formatAppointment(selectedSlot!)}` : ''),
      appointmentAt: isViewing ? selectedSlot : null,
      partExchange: isPartExchange
        ? {
            registration: partExchangeRegistration.trim().toUpperCase() || null,
            mileage: Number(partExchangeMileage),
            condition: partExchangeCondition,
          }
        : null,
      visitorId: getVisitorId(),
    };
    mutation.mutate({ data });
  };

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
        <p className="mx-auto mt-5 max-w-md text-sm leading-7 text-muted-foreground">
          {isViewing
            ? `Thank you, ${customerName.trim()}. We have held your appointment for ${formatAppointment(selectedSlot!)}.`
            : `Thank you, ${customerName.trim()}. The ${dealerConfig.identity.name} team has your request and will be in touch.`}
        </p>
        <div className="mx-auto mt-6 max-w-sm border border-primary/20 bg-primary/5 px-5 py-4 text-left">
          <p className="luxxy-label text-accent">Your reference</p>
          <p className="mt-2 font-mono text-xl font-bold tracking-[.12em] text-primary" data-testid="text-enquiry-reference">{mutation.data.reference}</p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">Keep this reference handy if you call the showroom.</p>
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
              <p className="luxxy-label text-muted-foreground">
                {mutation.data.customerNotificationStatus === 'sent' ? 'Confirmation email sent' : 'Confirmation email not sent'}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
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
                <p className="mt-1 text-xs leading-5 text-muted-foreground">Reschedule or cancel using your secure link.</p>
              </div>
            </div>
            <Button asChild type="button" variant="outline" size="sm" className="h-9 shrink-0 rounded-none border-border bg-background text-xs font-bold shadow-none">
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
          className="mt-8 h-12 rounded-none border-border bg-background px-6 text-sm font-bold text-foreground shadow-none hover:border-primary/45 hover:bg-secondary hover:text-foreground"
          onClick={() => mutation.reset()}
          data-testid="button-send-another-enquiry"
        >
          Send another enquiry <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-8" data-testid="form-enquiry">
      <div className="flex items-start justify-between gap-5 border-b border-border/70 pb-6">
        <div>
          <p className="luxxy-label text-accent">Your details</p>
          <h2 className="mt-4 font-display text-[1.85rem] font-semibold leading-[1.05] tracking-[-.03em] text-primary sm:text-[2.1rem]">
            {isViewing ? 'Let’s make it easy.' : 'How can we help?'}
          </h2>
          <p className="mt-3 max-w-md text-sm leading-7 text-muted-foreground">A few details is all we need. No pressure, no sales script.</p>
        </div>
        <span className="hidden h-10 w-10 shrink-0 place-items-center border border-border bg-secondary/50 text-accent sm:grid"><Sparkles className="h-4 w-4" /></span>
      </div>

      {vehicle && !isPartExchange && (
        <div className="flex items-center justify-between gap-4 border border-border/70 bg-secondary/35 px-4 py-3.5" data-testid="card-enquiry-vehicle">
          <div className="min-w-0">
            <p className="luxxy-label text-muted-foreground">Viewing</p>
            <p className="mt-1.5 truncate text-sm font-bold text-primary">{vehicleLabel}</p>
          </div>
          {vehicle.price != null && <p className="shrink-0 font-mono text-[13px] font-bold text-primary">{formatPrice(vehicle.price, vehicle.currency)}</p>}
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block">
          <span className={labelClass}>Your name</span>
          <Input required minLength={2} maxLength={120} value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Your full name" className="h-11" data-testid="input-customer-name" />
        </label>
        <label className="block">
          <span className={labelClass}><Mail className="h-3.5 w-3.5 text-accent" />Email address</span>
          <Input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" className="h-11" data-testid="input-customer-email" />
        </label>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block">
          <span className={labelClass}><Phone className="h-3.5 w-3.5 text-accent" />Phone number</span>
          <Input
            required={phoneRequired}
            type="tel"
            inputMode="tel"
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

      <label className="block">
        <span className={labelClass}>What can we help with?</span>
        <NativeSelect value={type} onChange={(event) => setType(event.target.value as EnquiryType)} data-testid="select-enquiry-type">
          {Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </NativeSelect>
      </label>

      {isPartExchange && (
        <fieldset className="luxxy-reveal luxxy-reveal-1 min-w-0 space-y-6 border border-border/70 bg-secondary/25 p-5 sm:p-6" data-testid="section-part-exchange-details">
          <div className="border-b border-border/70 pb-5">
            <legend className="flex items-center gap-2.5 font-display text-xl font-semibold tracking-[-.02em] text-primary">
              <CarFront className="h-5 w-5 text-accent" /> Let’s work out the difference
            </legend>
            <p className="mt-3 text-[13px] leading-6 text-muted-foreground">Choose the {dealerConfig.identity.name} car you’re considering, then tell us about your current car.</p>
          </div>
          <div className="space-y-4" data-testid="section-part-exchange-target-vehicle">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="luxxy-label text-accent">Step 1 · Your next car</p>
                <p className="mt-2 text-sm font-bold text-primary">Which car are you considering?</p>
              </div>
              <span className="luxxy-label shrink-0 border border-border bg-background px-2.5 py-1.5 text-muted-foreground">{stockCars.length} available</span>
            </div>
            <NativeSelect
              required
              value={selectedVehicleId}
              onChange={(event) => setSelectedVehicleId(event.target.value)}
              disabled={stockCars.length === 0}
              className="h-12"
              data-testid="select-part-exchange-target-vehicle"
            >
              <option value="">Choose a car from our current stock</option>
              {stockCars.map((car) => {
                const label = car.title || [car.make, car.model].filter(Boolean).join(' ') || 'Selected vehicle';
                const price = car.price != null ? ` · ${formatPrice(car.price, car.currency)}` : '';
                return <option key={car.id} value={car.id}>{label}{price}</option>;
              })}
            </NativeSelect>
            {selectedVehicle && (
              <div className="border border-border/70 bg-background p-4" data-testid="card-part-exchange-target-vehicle">
                <div className="flex items-center gap-4">
                  {getThumbnailUrl(selectedVehicle) ? (
                    <img src={getThumbnailUrl(selectedVehicle)} alt="" referrerPolicy="no-referrer" className="h-14 w-20 shrink-0 object-cover" />
                  ) : (
                    <div className="grid h-14 w-20 shrink-0 place-items-center bg-secondary text-primary"><CarFront className="h-5 w-5" /></div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-primary">{vehicleLabel}</p>
                    <p className="mt-1 font-mono text-[12px] font-bold text-muted-foreground">{selectedVehicle.year ? `${selectedVehicle.year} · ` : ''}{selectedVehicle.price != null ? formatPrice(selectedVehicle.price, selectedVehicle.currency) : 'Price on request'}</p>
                  </div>
                  <Check className="ml-auto h-5 w-5 shrink-0 text-accent" />
                </div>
                {vehicleRegistration(selectedVehicle) && (
                  <div className="mt-4 border-t border-border/70 pt-4">
                    <div className="mb-2.5 flex items-center justify-between gap-3">
                      <span className="luxxy-label text-accent">Actual registration</span>
                      <span className="luxxy-label text-muted-foreground">From stock record</span>
                    </div>
                    <UKNumberPlate value={vehicleRegistration(selectedVehicle)} testId="visual-target-uk-number-plate" />
                  </div>
                )}
              </div>
            )}
            {stockCars.length === 0 && <p className="border border-[#c9a49c] bg-[#f7ece9] p-3 text-[13px] leading-6 text-[#8d3e34]">Our current stock is unavailable right now. Please call us and we’ll help match your part exchange to a car.</p>}
          </div>
          <div className="border-t border-border/70 pt-5">
            <p className="luxxy-label text-accent">Step 2 · Your current car</p>
            <p className="mt-2 text-sm font-bold text-primary">Tell us about the car you’d like to exchange</p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="block">
              <span className={`${labelClass} justify-between`}>
                <span>Your car’s registration</span>
                <span className="text-muted-foreground">UK plate</span>
              </span>
              <UKNumberPlate
                value={partExchangeRegistration}
                editable
                onChange={setPartExchangeRegistration}
                testId="visual-uk-number-plate"
                inputTestId="input-part-exchange-registration"
                helpId="part-exchange-registration-help"
              />
              <span id="part-exchange-registration-help" className="mt-2 block text-[13px] leading-6 text-muted-foreground">Enter the registration exactly as it appears on the plate.</span>
            </label>
            <label className="block">
              <span className={labelClass}><Gauge className="h-3.5 w-3.5 text-accent" />Current mileage</span>
              <Input
                required
                type="number"
                min={0}
                max={2000000}
                step={1}
                inputMode="numeric"
                value={partExchangeMileage}
                onChange={(event) => setPartExchangeMileage(event.target.value)}
                placeholder="45,000"
                className="h-11"
                data-testid="input-part-exchange-mileage"
              />
            </label>
          </div>
          <label className="block border-t border-border/70 pt-5">
            <span className={labelClass}>Condition</span>
            <NativeSelect required value={partExchangeCondition} onChange={(event) => setPartExchangeCondition(event.target.value as PartExchangeCondition)} className="h-11" data-testid="select-part-exchange-condition">
              {conditionOptions.map((option) => <option key={option.value} value={option.value}>{option.label} · {option.hint}</option>)}
            </NativeSelect>
          </label>
        </fieldset>
      )}

      {/* min-w-0 stops the browser's default fieldset min-content sizing from letting the
          scrollable date strip push the whole panel wider than the card. */}
      {isViewing && (
        <fieldset className="luxxy-reveal luxxy-reveal-1 min-w-0 space-y-6 border border-border/70 bg-secondary/25 p-5 sm:p-6" data-testid="section-viewing-availability">
          <div className="flex items-start justify-between gap-4 border-b border-border/70 pb-5">
            <div>
              <legend className="flex items-center gap-2.5 font-display text-xl font-semibold tracking-[-.02em] text-primary">
                <CalendarDays className="h-5 w-5 text-accent" /> Choose a time to visit
              </legend>
              <p className="mt-3 text-[13px] leading-6 text-muted-foreground">30 minutes · Monday to Saturday · 10:00–18:00</p>
            </div>
            <span className="luxxy-label hidden shrink-0 border border-border bg-background px-2.5 py-1.5 text-muted-foreground sm:block">London time</span>
          </div>
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
                  className={`min-w-[76px] border px-3 py-3 text-center transition-colors ${selectedDate === date ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground hover:border-accent hover:text-primary'}`}
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
              <p className="luxxy-label text-muted-foreground">Available times</p>
              {availableSlots.length > 0 && <p className="font-mono text-[12px] font-bold text-primary">{availableSlots.length} times open</p>}
            </div>
            {availabilityQuery.isLoading ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="loading-availability">
                {[1, 2, 3, 4].map((item) => <div key={item} className="h-11 animate-pulse bg-secondary" />)}
              </div>
            ) : availabilityQuery.isError ? (
              <div role="alert" className="flex items-start gap-2.5 border border-[#c9a49c] bg-[#f7ece9] p-3 text-[13px] leading-6 text-[#8d3e34]" data-testid="status-availability-error">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> Could not load available times. Please choose another date.
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
                    className={`flex h-11 items-center justify-center gap-2 border px-3 font-mono text-[13px] font-bold transition-colors ${selectedSlot === slot.startAt ? 'border-primary bg-primary text-primary-foreground' : slot.available ? 'border-border bg-background text-foreground hover:border-accent hover:text-primary' : 'cursor-not-allowed border-border/50 bg-secondary/40 text-muted-foreground/45 line-through'}`}
                    data-testid={`button-viewing-slot-${slot.startAt}`}
                  >
                    {selectedSlot === slot.startAt && <Check className="h-4 w-4" />}
                    {slot.label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="border border-[#d4bd83] bg-[#f7f0dd] p-3 text-[13px] leading-6 text-[#80611f]" data-testid="status-availability-empty">There are no remaining times on this date. Please choose another day.</p>
            )}
          </div>
          <div className="flex items-start gap-2.5 text-[13px] leading-6 text-muted-foreground">
            <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            {selectedSlotLabel ? <span><strong className="font-bold text-primary">Your time:</strong> {selectedSlotLabel} · {formatDateLabel(selectedDate)}</span> : <span>Select any open time to reserve your visit.</span>}
          </div>
        </fieldset>
      )}

      <label className="block">
        <span className={labelClass}><MessageSquare className="h-3.5 w-3.5 text-accent" />Anything else we should know?</span>
        <Textarea
          required={!isViewing}
          minLength={isViewing ? undefined : 1}
          maxLength={2000}
          rows={4}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={isViewing ? 'Anything you would like us to prepare?' : `How can the ${dealerConfig.identity.name} team help?`}
          data-testid="textarea-enquiry-message"
        />
      </label>

      {mutation.isError && (
        <div role="alert" className="flex items-start gap-3 border border-[#c9a49c] bg-[#f7ece9] p-4 text-sm leading-6 text-[#8d3e34]" data-testid="status-enquiry-error">
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{apiErrorMessage(mutation.error)}</span>
        </div>
      )}
      <div className="space-y-4">
        <Button type="submit" size="lg" disabled={mutation.isPending || (isViewing && !selectedSlot)} className="group h-12 w-full rounded-none text-sm font-bold shadow-none" data-testid="button-submit-enquiry">
          {mutation.isPending ? (isViewing ? 'Reserving your visit…' : 'Sending enquiry…') : isViewing ? 'Reserve this viewing' : `Send ${typeLabels[type].toLowerCase()}`}
          {!mutation.isPending && <ArrowRight className="ml-3 h-4 w-4 transition-transform group-hover:translate-x-1" />}
        </Button>
        <div className="flex items-start gap-3 border border-border/70 bg-secondary/35 px-4 py-3.5 text-[13px] leading-6 text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
           <span>{isViewing ? `Your details are only used to confirm this appointment. We will send your confirmation and a reminder 24 hours before (${bookingTimezone}).` : `Your details are sent securely to the ${dealerConfig.identity.name} enquiry inbox. We will confirm delivery on the next screen.`}</span>
        </div>
      </div>
    </form>
  );
}
