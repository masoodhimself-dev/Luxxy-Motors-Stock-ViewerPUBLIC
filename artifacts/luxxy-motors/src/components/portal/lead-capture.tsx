import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetLeadChannelSummaryQueryKey,
  getGetLeadsQueryKey,
  getGetPortalWorklistQueryKey,
  useCreateLead,
  type LeadInput,
  type LeadInputSource,
} from '@workspace/api-client-react';
import { LoaderCircle, UserPlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useStock } from '@/lib/stock-context';
import { SelectField } from './portal-ui';
import {
  Field,
  SourceSelect,
  fromLocalInput,
  orNull,
  poundsToPence,
} from './lead-form-fields';

const emptyForm = {
  customerName: '',
  phone: '',
  email: '',
  source: 'walk_in' as const,
  vehicleId: '',
  owner: '',
  summary: '',
  appointmentAt: '',
  nextAction: '',
  nextActionDueAt: '',
  deposit: '',
};

/**
 * Manual capture has to beat a notepad, so only the name and the channel are
 * required and the name field takes focus the moment the panel opens.
 */
export function LeadCapture({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const cache = useQueryClient();
  const { stock } = useStock();
  const createLead = useCreateLead();

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const set = (key: keyof typeof emptyForm) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (form.customerName.trim() === '') {
      setError('A name is needed, even if it is just a first name.');
      nameRef.current?.focus();
      return;
    }

    const car = stock?.cars.find((entry) => entry.id === form.vehicleId);
    const payload: LeadInput = {
      customerName: form.customerName.trim(),
      email: orNull(form.email),
      phone: orNull(form.phone),
      source: form.source as LeadInputSource,
      vehicleId: orNull(form.vehicleId),
      vehicleTitle: car?.title ?? null,
      owner: orNull(form.owner),
      summary: orNull(form.summary),
      appointmentAt: fromLocalInput(form.appointmentAt),
      nextAction: orNull(form.nextAction),
      nextActionDueAt: fromLocalInput(form.nextActionDueAt),
      depositPence: poundsToPence(form.deposit),
    };

    try {
      const lead = await createLead.mutateAsync({ data: payload });
      await Promise.all([
        cache.invalidateQueries({ queryKey: getGetLeadsQueryKey() }),
        cache.invalidateQueries({ queryKey: getGetPortalWorklistQueryKey() }),
        cache.invalidateQueries({ queryKey: getGetLeadChannelSummaryQueryKey() }),
      ]);
      onCreated(lead.lead.id);
    } catch {
      setError('The lead could not be saved. Check the details and try again.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] overflow-y-auto bg-primary/40 px-4 py-8 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lead-capture-title"
    >
      <form
        onSubmit={handleSubmit}
        className="luxxy-grain mx-auto w-full max-w-2xl border-4 border-primary bg-background shadow-[0_30px_80px_-40px_hsl(183_31%_18%_/_0.6)]"
        data-testid="lead-capture-form"
      >
        <header className="flex items-start justify-between gap-4 border-b-4 border-primary px-6 py-5">
          <div>
            <p className="font-display text-[11px] font-black uppercase tracking-[0.2em] text-accent text-accent">
              <UserPlus className="h-3.5 w-3.5" /> New lead
            </p>
            <h2
              id="lead-capture-title"
              className="mt-2 font-display text-2xl font-black uppercase tracking-tighter text-primary"
            >
              Who walked in?
            </h2>
            <p className="mt-1 text-[13px] text-primary/70 font-bold uppercase tracking-widest">
              A name and a channel is enough. Everything else can wait.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="rounded-none"
            onClick={onClose}
            aria-label="Close"
            data-testid="button-close-capture"
          >
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="grid gap-5 px-6 py-6 sm:grid-cols-2">
          <Field label="Name" className="sm:col-span-2">
            <Input
              ref={nameRef}
              value={form.customerName}
              onChange={(event) => set('customerName')(event.target.value)}
              placeholder="Priya Shah"
              className="rounded-none"
              maxLength={160}
              data-testid="input-customer-name"
            />
          </Field>

          <Field label="Phone">
            <Input
              value={form.phone}
              onChange={(event) => set('phone')(event.target.value)}
              placeholder="07700 900123"
              className="rounded-none font-mono"
              maxLength={40}
              inputMode="tel"
              data-testid="input-phone"
            />
          </Field>

          <Field label="Email">
            <Input
              value={form.email}
              onChange={(event) => set('email')(event.target.value)}
              placeholder="priya@example.com"
              className="rounded-none"
              maxLength={200}
              type="email"
              data-testid="input-email"
            />
          </Field>

          <Field label="Came from">
            <SourceSelect value={form.source} onChange={set('source')} />
          </Field>

          <Field label="Handled by">
            <Input
              value={form.owner}
              onChange={(event) => set('owner')(event.target.value)}
              placeholder="Who is looking after this"
              className="rounded-none"
              maxLength={120}
              data-testid="input-owner"
            />
          </Field>

          <Field label="Car of interest" className="sm:col-span-2">
            <SelectField
              value={form.vehicleId}
              onChange={(event) => set('vehicleId')(event.target.value)}
              data-testid="select-vehicle"
            >
              <option value="">No particular car yet</option>
              {(stock?.cars ?? []).map((car) => (
                <option key={car.id} value={car.id}>
                  {car.title}
                  {car.registration ? ` — ${car.registration}` : ''}
                </option>
              ))}
            </SelectField>
          </Field>

          <Field label="What they said" className="sm:col-span-2">
            <Textarea
              value={form.summary}
              onChange={(event) => set('summary')(event.target.value)}
              placeholder="Wants a diesel estate under £14k, part-exchanging a Golf."
              className="min-h-24 rounded-none"
              maxLength={2000}
              data-testid="input-summary"
            />
          </Field>

          <Field label="Viewing booked for">
            <Input
              type="datetime-local"
              value={form.appointmentAt}
              onChange={(event) => set('appointmentAt')(event.target.value)}
              className="rounded-none font-mono"
              data-testid="input-appointment"
            />
          </Field>

          <Field label="Deposit taken" hint="Leave blank if nothing has been paid.">
            <Input
              value={form.deposit}
              onChange={(event) => set('deposit')(event.target.value)}
              placeholder="500"
              className="rounded-none font-mono"
              inputMode="decimal"
              data-testid="input-deposit"
            />
          </Field>

          <Field label="Next action">
            <Input
              value={form.nextAction}
              onChange={(event) => set('nextAction')(event.target.value)}
              placeholder="Ring back with a part-ex figure"
              className="rounded-none"
              maxLength={300}
              data-testid="input-next-action"
            />
          </Field>

          <Field label="Due">
            <Input
              type="datetime-local"
              value={form.nextActionDueAt}
              onChange={(event) => set('nextActionDueAt')(event.target.value)}
              className="rounded-none font-mono"
              data-testid="input-next-action-due"
            />
          </Field>
        </div>

        {error && (
          <p
            className="mx-6 mb-4 border border-destructive/40 bg-destructive/10 px-4 py-3 text-[13px] text-destructive"
            role="alert"
          >
            {error}
          </p>
        )}

        <footer className="flex flex-wrap items-center justify-end gap-3 border-t-4 border-primary bg-secondary/50 px-6 py-4">
          <Button type="button" variant="ghost" className="rounded-none" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            className="rounded-none text-[12px] font-bold uppercase tracking-[.1em]"
            disabled={createLead.isPending}
            data-testid="button-save-lead"
          >
            {createLead.isPending && (
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
            )}
            Save lead
          </Button>
        </footer>
      </form>
    </div>
  );
}
