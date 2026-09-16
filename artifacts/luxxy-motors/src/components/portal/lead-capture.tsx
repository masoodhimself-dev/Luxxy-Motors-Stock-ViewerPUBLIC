import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetLeadChannelSummaryQueryKey,
  getGetLeadsQueryKey,
  getGetPortalWorklistQueryKey,
  useCreateLead,
  type LeadInput,
  type LeadInputSource,
} from '@workspace/api-client-react';
import { LoaderCircle, UserPlus } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useStock } from '@/lib/stock-context';
import { SelectField } from './portal-ui';
import { Field, SourceSelect, fromLocalInput, orNull, poundsToPence } from './lead-form-fields';

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
  const openerRef = useRef(document.activeElement as HTMLElement | null);
  const cache = useQueryClient();
  const { stock } = useStock();
  const createLead = useCreateLead();

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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-w-2xl p-0 sm:p-0"
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          openerRef.current?.focus();
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          nameRef.current?.focus();
        }}
      >
        <form
          onSubmit={handleSubmit}
          className="luxxy-grain mx-auto w-full max-w-2xl border border-border bg-card shadow-none"
          data-testid="lead-capture-form"
        >
          <header className="flex items-start justify-between gap-4 border-b border-primary px-6 py-5 pr-16">
            <div>
              <p className="flex items-center gap-2 font-display text-xs font-semibold text-accent">
                <UserPlus className="h-3.5 w-3.5" /> New lead
              </p>
              <DialogTitle
                id="lead-capture-title"
                className="mt-2 font-display text-2xl font-semibold tracking-tight text-primary"
              >
                Who walked in?
              </DialogTitle>
              <p className="mt-1 text-[13px] text-primary/70 font-medium">
                A name and a channel is enough. Everything else can wait.
              </p>
            </div>
          </header>

          <div className="grid gap-5 px-6 py-6 sm:grid-cols-2">
            <Field label="Name" className="sm:col-span-2">
              <Input
                ref={nameRef}
                value={form.customerName}
                onChange={(event) => set('customerName')(event.target.value)}
                placeholder="Priya Shah"
                className="rounded-md"
                maxLength={160}
                data-testid="input-customer-name"
              />
            </Field>

            <Field label="Phone">
              <Input
                value={form.phone}
                onChange={(event) => set('phone')(event.target.value)}
                placeholder="07700 900123"
                className="rounded-md font-mono"
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
                className="rounded-md"
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
                className="rounded-md"
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
                className="min-h-24 rounded-md"
                maxLength={2000}
                data-testid="input-summary"
              />
            </Field>

            <Field label="Viewing booked for">
              <Input
                type="datetime-local"
                value={form.appointmentAt}
                onChange={(event) => set('appointmentAt')(event.target.value)}
                className="rounded-md font-mono"
                data-testid="input-appointment"
              />
            </Field>

            <Field label="Deposit taken" hint="Leave blank if nothing has been paid.">
              <Input
                value={form.deposit}
                onChange={(event) => set('deposit')(event.target.value)}
                placeholder="500"
                className="rounded-md font-mono"
                inputMode="decimal"
                data-testid="input-deposit"
              />
            </Field>

            <Field label="Next action">
              <Input
                value={form.nextAction}
                onChange={(event) => set('nextAction')(event.target.value)}
                placeholder="Ring back with a part-ex figure"
                className="rounded-md"
                maxLength={300}
                data-testid="input-next-action"
              />
            </Field>

            <Field label="Due">
              <Input
                type="datetime-local"
                value={form.nextActionDueAt}
                onChange={(event) => set('nextActionDueAt')(event.target.value)}
                className="rounded-md font-mono"
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

          <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-primary bg-secondary/50 px-6 py-4">
            <Button type="button" variant="ghost" className="rounded-md" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              className="rounded-md text-[12px] font-medium"
              disabled={createLead.isPending}
              data-testid="button-save-lead"
            >
              {createLead.isPending && <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />}
              Save lead
            </Button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
