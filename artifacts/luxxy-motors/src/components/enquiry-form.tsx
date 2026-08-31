import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { getGetEnquiryAvailabilityQueryKey, useCreateEnquiry, useGetEnquiryAvailability, type EnquiryInput } from '@workspace/api-client-react';
import { CalendarDays, CheckCircle2, CircleAlert, Clock3, Mail, MessageSquare, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Car } from '@/lib/stock-context';
import { formatPrice } from '@/lib/utils';
import type { EnquiryType } from '@/lib/cta-helpers';

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

function bookingDates() {
  const dates: string[] = [];
  const current = new Date();
  for (let offset = 0; offset <= 30 && dates.length < 14; offset += 1) {
    const candidate = new Date(current);
    candidate.setDate(current.getDate() + offset);
    const weekday = candidate.getDay();
    if (weekday !== 0) dates.push(dateString(candidate));
  }
  return dates;
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
}: {
  initialType?: EnquiryType;
  vehicle?: Car;
}) {
  const [type, setType] = useState<EnquiryType>(initialType);
  const [customerName, setCustomerName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
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

  const vehicleLabel = vehicle?.title || [vehicle?.make, vehicle?.model].filter(Boolean).join(' ') || 'selected vehicle';

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
    const data: EnquiryInput = {
      vehicleId: vehicle?.id ?? null,
      type,
      customerName: customerName.trim(),
      email: email.trim(),
      phone: null,
      preferredContact: 'email',
      message: message.trim() || (isViewing ? `Viewing appointment requested for ${formatAppointment(selectedSlot!)}` : ''),
      appointmentAt: isViewing ? selectedSlot : null,
    };
    mutation.mutate({ data });
  };

  if (mutation.isSuccess) {
    return (
      <div className="rounded-2xl border border-green-200 bg-green-50 p-8 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
          <CheckCircle2 className="h-7 w-7 text-green-700" />
        </div>
        <h2 className="text-2xl font-black text-green-950">{isViewing ? 'Viewing booked' : 'Enquiry received'}</h2>
        <p className="mx-auto mt-3 max-w-lg text-green-900/80">
          {isViewing
            ? `Thank you, ${customerName.trim()}. Your viewing is booked for ${formatAppointment(selectedSlot!)}.`
            : `Thank you, ${customerName.trim()}. The Luxxy Motors team has your request and will be in touch using your preferred contact method.`}
        </p>
        {vehicle && <p className="mt-4 text-sm font-semibold text-green-900">{vehicleLabel}</p>}
        <Button type="button" variant="outline" className="mt-7 border-green-300 bg-white" onClick={() => mutation.reset()}>
          Send another enquiry
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      {vehicle && (
        <div className="rounded-xl border border-primary/15 bg-primary/5 p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-primary">Enquiring about</p>
          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-bold text-foreground">{vehicleLabel}</p>
            {vehicle.price != null && <p className="font-bold text-primary">{formatPrice(vehicle.price, vehicle.currency)}</p>}
          </div>
          {(vehicle.registration || vehicle.plate) && (
            <p className="mt-1 text-sm text-muted-foreground">{vehicle.registration || vehicle.plate}</p>
          )}
        </div>
      )}

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="space-y-2 text-sm font-semibold">
          <span>Your name</span>
          <Input required minLength={2} maxLength={120} value={customerName} onChange={(event) => setCustomerName(event.target.value)} placeholder="Jane Smith" />
        </label>
        <label className="space-y-2 text-sm font-semibold">
          <span>Enquiry type</span>
          <select
            value={type}
            onChange={(event) => setType(event.target.value as EnquiryType)}
            className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="space-y-2 text-sm font-semibold">
          <span className="flex items-center gap-2"><Mail className="h-4 w-4 text-primary" />Email address</span>
          <Input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="jane@example.com" />
        </label>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">Confirmation method</legend>
        <div className="flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm font-semibold text-primary">
          <Mail className="h-4 w-4" />
          We’ll email your confirmation and viewing reminder
        </div>
      </fieldset>

      {isViewing && (
        <fieldset className="space-y-4 rounded-xl border border-primary/15 bg-primary/5 p-5">
          <legend className="flex items-center gap-2 text-sm font-bold text-foreground">
            <CalendarDays className="h-4 w-4 text-primary" /> Choose your viewing time
          </legend>
          <p className="text-sm text-muted-foreground">Appointments are 30 minutes, Monday to Saturday, 10:00 am–6:00 pm.</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {dates.map((date) => (
              <button
                key={date}
                type="button"
                onClick={() => setSelectedDate(date)}
                className={`rounded-lg border px-3 py-3 text-left text-sm font-semibold transition-colors ${
                  selectedDate === date
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background hover:border-primary/50'
                }`}
              >
                {formatDateLabel(date)}
              </button>
            ))}
          </div>
          {availabilityQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock3 className="h-4 w-4 animate-pulse text-primary" /> Loading available times…
            </div>
          ) : availabilityQuery.isError ? (
            <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> Could not load available times. Please try another date.
            </div>
          ) : availabilityQuery.data?.slots.some((slot) => slot.available) ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {availabilityQuery.data.slots.map((slot) => (
                <button
                  key={slot.startAt}
                  type="button"
                  disabled={!slot.available}
                  onClick={() => setSelectedSlot(slot.startAt)}
                  className={`rounded-lg border px-3 py-2.5 text-sm font-semibold transition-colors ${
                    selectedSlot === slot.startAt
                      ? 'border-primary bg-primary text-primary-foreground'
                      : slot.available
                        ? 'border-border bg-background hover:border-primary/50'
                        : 'cursor-not-allowed border-border/60 bg-muted text-muted-foreground/50 line-through'
                  }`}
                >
                  {slot.label}
                </button>
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">There are no remaining times on this date. Please choose another day.</p>
          )}
          {selectedSlot && <p className="text-sm font-semibold text-primary">Selected: {formatAppointment(selectedSlot)}</p>}
        </fieldset>
      )}

      <label className="block space-y-2 text-sm font-semibold">
        <span className="flex items-center gap-2"><MessageSquare className="h-4 w-4 text-primary" />Your message {isViewing && <span className="font-normal text-muted-foreground">(optional)</span>}</span>
        <Textarea required={!isViewing} minLength={isViewing ? undefined : 1} maxLength={2000} rows={5} value={message} onChange={(event) => setMessage(event.target.value)} placeholder={type === 'viewing' ? 'Anything you would like us to know? (optional)' : 'How can the Luxxy Motors team help?'} />
      </label>

      {mutation.isError && (
        <div role="alert" className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <span>{apiErrorMessage(mutation.error)}</span>
        </div>
      )}
      <Button type="submit" size="lg" disabled={mutation.isPending || (isViewing && !selectedSlot)} className="h-12 w-full font-bold sm:w-auto">
        <Send className="mr-2 h-4 w-4" />
        {mutation.isPending ? (isViewing ? 'Booking viewing…' : 'Sending enquiry…') : isViewing ? 'Confirm booking' : `Send ${typeLabels[type].toLowerCase()}`}
      </Button>
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <CalendarDays className="mt-0.5 h-4 w-4 shrink-0" />
        {isViewing ? `Your booking is saved in the Luxxy Motors enquiry inbox. We’ll email your confirmation and send a reminder about 24 hours before your appointment (${bookingTimezone}).` : 'Your details are sent securely to the Luxxy Motors enquiry inbox. We’ll email a confirmation to this address.'}
      </p>
    </form>
  );
}