import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { getGetEnquiryAvailabilityQueryKey, useCreateEnquiry, useGetEnquiryAvailability, type EnquiryInput } from '@workspace/api-client-react';
import { ArrowRight, CalendarDays, CarFront, Check, CheckCircle2, CircleAlert, Clock3, Gauge, Mail, MessageSquare, ShieldCheck, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Car } from '@/lib/stock-context';
import { formatPrice, getThumbnailUrl, vehicleRegistration } from '@/lib/utils';
import type { EnquiryType } from '@/lib/cta-helpers';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { UKNumberPlate } from '@/components/uk-number-plate';

const typeLabels: Record<EnquiryType, string> = {
  viewing: 'Book a viewing',
  general: 'General enquiry',
  delivery: 'Delivery enquiry',
  warranty: 'Warranty enquiry',
  part_exchange: 'Part exchange valuation',
};

const bookingTimezone = 'Europe/London';

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
  const [message, setMessage] = useState('');
  const [selectedVehicleId, setSelectedVehicleId] = useState(vehicle?.id ?? '');
  const [partExchangeRegistration, setPartExchangeRegistration] = useState('');
  const [partExchangeMileage, setPartExchangeMileage] = useState('');
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
    const partExchangeDetails = isPartExchange
      ? [
          `Interested in: ${vehicleLabel}`,
          'Customer part exchange vehicle',
          `Registration: ${partExchangeRegistration.trim().toUpperCase()}`,
          `Mileage: ${Number(partExchangeMileage).toLocaleString('en-GB')} miles`,
        ].join('\n')
      : '';
    const data: EnquiryInput = {
      vehicleId: isPartExchange ? selectedVehicleId || null : vehicle?.id ?? null,
      type,
      customerName: customerName.trim(),
      email: email.trim(),
      phone: null,
      preferredContact: 'email',
      message: [partExchangeDetails, message.trim() || (isViewing ? `Viewing appointment requested for ${formatAppointment(selectedSlot!)}` : '')]
        .filter(Boolean)
        .join('\n\n'),
      appointmentAt: isViewing ? selectedSlot : null,
    };
    mutation.mutate({ data });
  };

  if (mutation.isSuccess) {
    return (
      <div className="appointment-rise overflow-hidden rounded-[1.5rem] border border-[#b5cbbd] bg-[#edf5ef] p-7 text-center sm:p-12" data-testid="status-enquiry-success">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#d3e8d9] text-[#2e6245]">
          <CheckCircle2 className="h-8 w-8" />
        </div>
        <p className="mt-7 text-xs font-bold uppercase tracking-[0.2em] text-[#47725a]">{isViewing ? 'Your visit is reserved' : 'Message received'}</p>
        <h2 className="font-display mt-2 text-4xl text-[#173a2a] sm:text-5xl">{isViewing ? 'See you at the showroom.' : 'We will be in touch.'}</h2>
        <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-[#47725a]">
          {isViewing
            ? `Thank you, ${customerName.trim()}. We have held your appointment for ${formatAppointment(selectedSlot!)}.`
            : `Thank you, ${customerName.trim()}. The ${dealerConfig.identity.name} team has your request and will reply by email.`}
        </p>
        {selectedVehicle && <p className="mt-5 text-sm font-bold text-[#173a2a]" data-testid="text-confirmed-vehicle">{vehicleLabel}</p>}
        <div className="mx-auto mt-7 flex max-w-sm items-center justify-center gap-2 rounded-full border border-[#b5cbbd] bg-[#f6fbf7] px-4 py-3 text-xs font-semibold text-[#47725a]">
          <Mail className="h-4 w-4" /> A confirmation is on its way
        </div>
        <Button type="button" variant="outline" className="mt-8 border-[#9fbea9] bg-transparent text-[#2e6245] hover:bg-[#dcecdf]" onClick={() => mutation.reset()} data-testid="button-send-another-enquiry">
          Send another enquiry <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-8" data-testid="form-enquiry">
      <div className="flex items-start justify-between gap-5 border-b border-[#e6dfd2] pb-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">Your details</p>
          <h2 className="font-display mt-1 text-3xl text-foreground sm:text-4xl">{isViewing ? 'Let’s make it easy.' : 'How can we help?'}</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">A few details is all we need. No pressure, no sales script.</p>
        </div>
        <div className="hidden rounded-full bg-[#f3e8c9] p-3 text-[#8d6714] sm:block"><Sparkles className="h-5 w-5" /></div>
      </div>

      {vehicle && !isPartExchange && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-[#d5c59e] bg-[#fbf6e8] px-4 py-3" data-testid="card-enquiry-vehicle">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#97721d]">Viewing</p>
            <p className="truncate text-sm font-bold text-foreground">{vehicleLabel}</p>
          </div>
          {vehicle.price != null && <p className="shrink-0 text-sm font-bold text-primary">{formatPrice(vehicle.price, vehicle.currency)}</p>}
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="space-y-2 text-sm font-semibold text-foreground">
          <span>Your name</span>
          <Input required minLength={2} maxLength={120} value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Your full name" data-testid="input-customer-name" />
        </label>
        <label className="space-y-2 text-sm font-semibold text-foreground">
          <span className="flex items-center gap-2"><Mail className="h-4 w-4 text-primary" />Email address</span>
          <Input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" data-testid="input-customer-email" />
        </label>
      </div>

      <label className="block space-y-2 text-sm font-semibold text-foreground">
        <span>What can we help with?</span>
        <select value={type} onChange={(event) => setType(event.target.value as EnquiryType)} className="flex h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="select-enquiry-type">
          {Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>

      {isPartExchange && (
        <fieldset className="appointment-rise appointment-rise-delay-1 space-y-5 rounded-2xl bg-[#f8f5ee] p-4 sm:p-6" data-testid="section-part-exchange-details">
          <div>
            <legend className="flex items-center gap-2 text-base font-bold text-foreground"><CarFront className="h-5 w-5 text-primary" /> Let’s work out the difference</legend>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Choose the {dealerConfig.identity.name} car you’re considering, then tell us about your current car.</p>
          </div>
          <div className="space-y-4" data-testid="section-part-exchange-target-vehicle">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#97721d]">Step 1 · Your next car</p>
                <p className="mt-1 text-sm font-bold text-foreground">Which car are you considering?</p>
              </div>
              <span className="rounded-full bg-[#f3e8c9] px-2.5 py-1 text-[10px] font-bold text-[#8d6714]">{stockCars.length} available</span>
            </div>
            <select
              required
              value={selectedVehicleId}
              onChange={(event) => setSelectedVehicleId(event.target.value)}
              disabled={stockCars.length === 0}
              className="mt-4 flex h-12 w-full rounded-xl border border-[#d5c59e] bg-background px-4 py-2 text-sm font-bold text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="select-part-exchange-target-vehicle"
            >
              <option value="">Choose a car from our current stock</option>
              {stockCars.map((car) => {
                const label = car.title || [car.make, car.model].filter(Boolean).join(' ') || 'Selected vehicle';
                const price = car.price != null ? ` · ${formatPrice(car.price, car.currency)}` : '';
                return <option key={car.id} value={car.id}>{label}{price}</option>;
              })}
            </select>
            {selectedVehicle && (
              <div className="mt-3" data-testid="card-part-exchange-target-vehicle">
                <div className="flex items-center gap-3">
                  {getThumbnailUrl(selectedVehicle) ? (
                    <img src={getThumbnailUrl(selectedVehicle)} alt="" referrerPolicy="no-referrer" className="h-14 w-20 shrink-0 rounded-md object-cover" />
                  ) : (
                    <div className="flex h-14 w-20 shrink-0 items-center justify-center rounded-md bg-secondary text-primary"><CarFront className="h-5 w-5" /></div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-foreground">{vehicleLabel}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{selectedVehicle.year ? `${selectedVehicle.year} · ` : ''}{selectedVehicle.price != null ? formatPrice(selectedVehicle.price, selectedVehicle.currency) : 'Price on request'}</p>
                  </div>
                  <Check className="ml-auto h-5 w-5 shrink-0 text-[#47725a]" />
                </div>
                {vehicleRegistration(selectedVehicle) && (
                  <div className="mt-3 pt-1">
                    <div className="mb-1.5 flex items-center justify-between gap-3">
                      <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#97721d]">Actual registration</span>
                      <span className="text-[10px] font-semibold text-muted-foreground">From stock record</span>
                    </div>
                    <UKNumberPlate value={vehicleRegistration(selectedVehicle)} testId="visual-target-uk-number-plate" />
                  </div>
                )}
              </div>
            )}
            {stockCars.length === 0 && <p className="mt-3 text-xs leading-5 text-[#8d3e34]">Our current stock is unavailable right now. Please call us and we’ll help match your part exchange to a car.</p>}
          </div>
          <div className="border-t border-[#d8c48c]/60 pt-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#97721d]">Step 2 · Your current car</p>
            <p className="mt-1 text-sm font-bold text-foreground">Tell us about the car you’d like to exchange</p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="space-y-2 text-sm font-semibold text-foreground">
              <span className="flex items-center justify-between gap-3">
                <span>Your car’s registration</span>
                <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">UK plate</span>
              </span>
              <UKNumberPlate
                value={partExchangeRegistration}
                editable
                onChange={setPartExchangeRegistration}
                testId="visual-uk-number-plate"
                inputTestId="input-part-exchange-registration"
                helpId="part-exchange-registration-help"
              />
              <span id="part-exchange-registration-help" className="block text-xs font-normal leading-5 text-muted-foreground">Enter the registration exactly as it appears on the plate.</span>
            </label>
            <label className="space-y-2 text-sm font-semibold text-foreground">
              <span className="flex items-center gap-2"><Gauge className="h-4 w-4 text-primary" />Current mileage</span>
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
                data-testid="input-part-exchange-mileage"
              />
            </label>
          </div>
        </fieldset>
      )}

      {isViewing && (
        <fieldset className="appointment-rise appointment-rise-delay-1 space-y-5 rounded-2xl border border-[#d8cfbe] bg-[#f8f5ee] p-4 sm:p-6" data-testid="section-viewing-availability">
          <div className="flex items-start justify-between gap-4">
            <div>
              <legend className="flex items-center gap-2 text-base font-bold text-foreground"><CalendarDays className="h-5 w-5 text-primary" /> Choose a time to visit</legend>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">30 minutes · Monday to Saturday · 10:00–18:00</p>
            </div>
            <span className="hidden rounded-full border border-[#d8cfbe] bg-background px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground sm:block">London time</span>
          </div>
          <label className="block sm:hidden" data-testid="label-viewing-date-mobile">
            <span className="sr-only">Choose a viewing date</span>
            <select
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
              aria-label="Choose a viewing date"
              className="h-12 w-full rounded-xl border border-[#d9d0c1] bg-background px-4 text-sm font-bold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="select-viewing-date"
            >
              {dates.map((date) => <option key={date} value={date}>{formatDateLabel(date)}</option>)}
            </select>
          </label>
          <div role="group" aria-label="Choose a viewing date" className="no-scrollbar hidden gap-2 overflow-x-auto px-1 pb-1 sm:flex" data-testid="group-viewing-dates">
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
                  className={`min-w-[76px] rounded-xl border px-3 py-3 text-center transition-all duration-200 ${selectedDate === date ? 'border-primary bg-primary text-primary-foreground shadow-[0_8px_16px_hsl(var(--primary)/.18)]' : 'border-[#ddd4c4] bg-background text-muted-foreground hover:-translate-y-0.5 hover:border-primary/50'}`}
                  data-testid={`button-viewing-date-${date}`}
                >
                  <span className="block text-[10px] font-bold uppercase tracking-wider opacity-75">{weekday}</span>
                  <span className="mt-1 block text-2xl font-bold leading-none">{day}</span>
                  <span className="mt-1 block text-[10px] font-semibold">{month}</span>
                </button>
              );
            })}
          </div>
          <div className="border-t border-[#e3ddcf] pt-5">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">Available times</p>
              {availableSlots.length > 0 && <p className="text-xs font-semibold text-[#47725a]">{availableSlots.length} times open</p>}
            </div>
            {availabilityQuery.isLoading ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="loading-availability">
                {[1, 2, 3, 4].map((item) => <div key={item} className="h-11 animate-pulse rounded-lg bg-[#e7e1d6]" />)}
              </div>
            ) : availabilityQuery.isError ? (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-[#e8c6c0] bg-[#fff2ef] p-3 text-sm text-[#8d3e34]" data-testid="status-availability-error">
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
                    className={`flex h-11 items-center justify-center gap-2 rounded-lg border px-3 text-sm font-bold transition-all duration-200 ${selectedSlot === slot.startAt ? 'border-primary bg-primary text-primary-foreground shadow-[0_6px_14px_hsl(var(--primary)/.2)]' : slot.available ? 'border-[#d9d0c1] bg-background hover:-translate-y-0.5 hover:border-primary/60 hover:bg-[#fffdf7]' : 'cursor-not-allowed border-transparent bg-[#e9e5dc] text-muted-foreground/40 line-through'}`}
                    data-testid={`button-viewing-slot-${slot.startAt}`}
                  >
                    {selectedSlot === slot.startAt && <Check className="h-4 w-4" />}
                    {slot.label}
                  </button>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-[#e2cf9d] bg-[#fff8e6] p-3 text-sm text-[#80611f]" data-testid="status-availability-empty">There are no remaining times on this date. Please choose another day.</p>
            )}
          </div>
          <div className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
            <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            {selectedSlotLabel ? <span><strong className="text-foreground">Your time:</strong> {selectedSlotLabel} · {formatDateLabel(selectedDate)}</span> : <span>Select any open time to reserve your visit.</span>}
          </div>
        </fieldset>
      )}

      <label className="block space-y-2 text-sm font-semibold text-foreground">
        <span className="flex items-center gap-2"><MessageSquare className="h-4 w-4 text-primary" />Anything else we should know?</span>
        <Textarea required={!isViewing} minLength={isViewing ? undefined : 1} maxLength={2000} rows={4} value={message} onChange={(event) => setMessage(event.target.value)} placeholder={isViewing ? 'Anything you would like us to prepare?' : `How can the ${dealerConfig.identity.name} team help?`} data-testid="textarea-enquiry-message" />
      </label>

      {mutation.isError && (
        <div role="alert" className="flex items-start gap-3 rounded-lg border border-[#e8c6c0] bg-[#fff2ef] p-4 text-sm text-[#8d3e34]" data-testid="status-enquiry-error">
          <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <span>{apiErrorMessage(mutation.error)}</span>
        </div>
      )}
      <div className="space-y-4">
        <Button type="submit" size="lg" disabled={mutation.isPending || (isViewing && !selectedSlot)} className="group h-13 w-full rounded-xl bg-primary font-bold shadow-[0_10px_24px_hsl(var(--primary)/.18)] transition-all hover:-translate-y-0.5 hover:shadow-[0_14px_28px_hsl(var(--primary)/.24)] sm:w-full" data-testid="button-submit-enquiry">
          {mutation.isPending ? (isViewing ? 'Reserving your visit…' : 'Sending enquiry…') : isViewing ? 'Reserve this viewing' : `Send ${typeLabels[type].toLowerCase()}`}
          {!mutation.isPending && <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />}
        </Button>
        <div className="flex items-start gap-3 rounded-lg bg-[#f5f1e8] px-3 py-3 text-xs leading-5 text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#47725a]" />
          <span>{isViewing ? `Your details are only used to confirm this appointment. We will email your confirmation and a reminder 24 hours before (${bookingTimezone}).` : `Your details are sent securely to the ${dealerConfig.identity.name} enquiry inbox. We will email a confirmation to this address.`}</span>
        </div>
      </div>
    </form>
  );
}