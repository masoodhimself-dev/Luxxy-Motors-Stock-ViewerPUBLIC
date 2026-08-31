import { useState, type FormEvent } from 'react';
import { useCreateEnquiry, type EnquiryInput } from '@workspace/api-client-react';
import { CalendarDays, CheckCircle2, CircleAlert, Mail, MessageSquare, Phone, Send } from 'lucide-react';
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
  const [phone, setPhone] = useState('');
  const [preferredContact, setPreferredContact] = useState<'phone' | 'email' | 'whatsapp'>('phone');
  const [message, setMessage] = useState('');
  const mutation = useCreateEnquiry();

  const vehicleLabel = vehicle?.title || [vehicle?.make, vehicle?.model].filter(Boolean).join(' ') || 'selected vehicle';

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data: EnquiryInput = {
      vehicleId: vehicle?.id ?? null,
      type,
      customerName: customerName.trim(),
      email: email.trim() || null,
      phone: phone.trim() || null,
      preferredContact: preferredContact || null,
      message: message.trim(),
    };
    mutation.mutate({ data });
  };

  if (mutation.isSuccess) {
    return (
      <div className="rounded-2xl border border-green-200 bg-green-50 p-8 text-center">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
          <CheckCircle2 className="h-7 w-7 text-green-700" />
        </div>
        <h2 className="text-2xl font-black text-green-950">Enquiry received</h2>
        <p className="mx-auto mt-3 max-w-lg text-green-900/80">
          Thank you, {customerName.trim()}. The Luxxy Motors team has your request and will be in touch using your preferred contact method.
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
          <span className="flex items-center gap-2"><Mail className="h-4 w-4 text-primary" />Email address <span className="font-normal text-muted-foreground">(optional)</span></span>
          <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="jane@example.com" />
        </label>
        <label className="space-y-2 text-sm font-semibold">
          <span className="flex items-center gap-2"><Phone className="h-4 w-4 text-primary" />Phone number <span className="font-normal text-muted-foreground">(optional)</span></span>
          <Input type="tel" minLength={5} maxLength={40} value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="07xxx xxx xxx" />
        </label>
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold">How should we contact you?</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {([
            ['phone', 'Phone', Phone],
            ['email', 'Email', Mail],
            ['whatsapp', 'WhatsApp', MessageSquare],
          ] as const).map(([value, label, Icon]) => (
            <label key={value} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm font-semibold transition-colors ${preferredContact === value ? 'border-primary bg-primary/5 text-primary' : 'border-border hover:border-primary/40'}`}>
              <input type="radio" name="preferredContact" value={value} checked={preferredContact === value} onChange={() => setPreferredContact(value)} className="accent-primary" />
              <Icon className="h-4 w-4" />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="block space-y-2 text-sm font-semibold">
        <span className="flex items-center gap-2"><MessageSquare className="h-4 w-4 text-primary" />Your message</span>
        <Textarea required minLength={1} maxLength={2000} rows={5} value={message} onChange={(event) => setMessage(event.target.value)} placeholder={type === 'viewing' ? 'Tell us when you would like to visit…' : 'How can the Luxxy Motors team help?'} />
      </label>

      {mutation.isError && (
        <div role="alert" className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <span>{apiErrorMessage(mutation.error)}</span>
        </div>
      )}
      <Button type="submit" size="lg" disabled={mutation.isPending} className="h-12 w-full font-bold sm:w-auto">
        <Send className="mr-2 h-4 w-4" />
        {mutation.isPending ? 'Sending enquiry…' : `Send ${typeLabels[type].toLowerCase()}`}
      </Button>
      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <CalendarDays className="mt-0.5 h-4 w-4 shrink-0" />
        Your details are sent securely to the Luxxy Motors enquiry inbox. Please provide an email address or phone number.
      </p>
    </form>
  );
}