import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetLeadChannelSummaryQueryKey,
  getGetLeadQueryKey,
  getGetLeadsQueryKey,
  getGetPortalWorklistQueryKey,
  useCreateLeadActivity,
  type LeadActivityInput,
  type LeadActivityInputKind,
  type LeadActivityInputStage,
  type LeadStage,
} from '@workspace/api-client-react';
import { LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { SelectField, activityIcons, stageLabels } from './portal-ui';
import { Field, fromLocalInput, orNull } from './lead-form-fields';

/** Only the kinds a person actually logs by hand. */
const loggableKinds: LeadActivityInputKind[] = [
  'call',
  'whatsapp',
  'email',
  'note',
  'visit',
];

const kindPlaceholders: Record<string, string> = {
  call: 'Rang about the Octavia — wants to see it Saturday morning.',
  whatsapp: 'Sent photos of the rear bumper scuff. Waiting on a reply.',
  email: 'Emailed over the service history and the warranty terms.',
  note: 'Part-ex is a 2016 Golf, 78k, one owner. Needs a valuation.',
  visit: 'Came in and drove it. Wants the alloys refurbished before buying.',
};

const openStages: LeadStage[] = [
  'new',
  'qualifying',
  'viewing_booked',
  'offer',
  'reserved',
  'sale_agreed',
  'collected',
];

/**
 * Logging contact and deciding the next move are the same thought, so they are
 * the same form: what happened, then what happens next and when.
 */
export function ActivityComposer({
  leadId,
  currentStage,
}: {
  leadId: string;
  currentStage: LeadStage;
}) {
  const [kind, setKind] = useState<LeadActivityInputKind>('call');
  const [body, setBody] = useState('');
  const [stage, setStage] = useState<string>('');
  const [nextAction, setNextAction] = useState('');
  const [nextActionDueAt, setNextActionDueAt] = useState('');
  const [error, setError] = useState<string | null>(null);

  const cache = useQueryClient();
  const createActivity = useCreateLeadActivity();

  const reset = () => {
    setBody('');
    setStage('');
    setNextAction('');
    setNextActionDueAt('');
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (body.trim() === '') {
      setError('Write a line about what happened.');
      return;
    }

    const payload: LeadActivityInput = {
      kind,
      body: body.trim(),
      ...(stage ? { stage: stage as LeadActivityInputStage } : {}),
      nextAction: orNull(nextAction),
      nextActionDueAt: fromLocalInput(nextActionDueAt),
    };

    try {
      await createActivity.mutateAsync({ id: leadId, data: payload });
      await Promise.all([
        cache.invalidateQueries({ queryKey: getGetLeadQueryKey(leadId) }),
        cache.invalidateQueries({ queryKey: getGetLeadsQueryKey() }),
        cache.invalidateQueries({ queryKey: getGetPortalWorklistQueryKey() }),
        cache.invalidateQueries({ queryKey: getGetLeadChannelSummaryQueryKey() }),
      ]);
      reset();
    } catch {
      setError('That did not save. Try again.');
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="luxxy-surface overflow-hidden rounded-[1rem] border border-primary/10"
      data-testid="activity-composer"
    >
      <header className="border-b border-primary/10 bg-background/45 px-5 py-4">
        <p className="luxxy-kicker text-[11px]">Log contact</p>
        <h2 className="mt-2 font-display text-2xl font-semibold tracking-[-.03em] text-primary">
          What just happened?
        </h2>
      </header>

      <div className="space-y-5 px-5 py-5">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Kind of contact">
          {loggableKinds.map((option) => {
            const Icon = activityIcons[option];
            const active = kind === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => setKind(option)}
                aria-pressed={active}
                data-testid={`button-kind-${option}`}
                className={`inline-flex items-center gap-2 border px-3 py-2 text-[12px] font-bold uppercase tracking-[.1em] transition-colors ${
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-primary/10 bg-background text-primary/70 hover:border-accent/40 hover:bg-accent/10 hover:text-primary'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {option === 'whatsapp' ? 'WhatsApp' : option}
              </button>
            );
          })}
        </div>

        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          placeholder={kindPlaceholders[kind]}
          className="min-h-24 rounded-none"
          maxLength={4000}
          data-testid="input-activity-body"
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Move to stage">
            <SelectField
              value={stage}
              onChange={(event) => setStage(event.target.value)}
              data-testid="select-activity-stage"
            >
              <option value="">Leave at {stageLabels[currentStage].toLowerCase()}</option>
              {openStages.map((option) => (
                <option key={option} value={option}>
                  {stageLabels[option]}
                </option>
              ))}
            </SelectField>
          </Field>

          <Field label="Then do this">
            <Input
              value={nextAction}
              onChange={(event) => setNextAction(event.target.value)}
              placeholder="Chase for a decision"
              className="rounded-none"
              maxLength={300}
              data-testid="input-activity-next-action"
            />
          </Field>

          <Field label="By when">
            <Input
              type="datetime-local"
              value={nextActionDueAt}
              onChange={(event) => setNextActionDueAt(event.target.value)}
              className="rounded-none font-mono"
              data-testid="input-activity-next-due"
            />
          </Field>
        </div>

        {error && (
          <p
            className="border border-destructive/40 bg-destructive/10 px-4 py-3 text-[13px] text-destructive"
            role="alert"
          >
            {error}
          </p>
        )}
      </div>

      <footer className="flex justify-end border-t border-primary/10 bg-secondary/35 px-5 py-4">
        <Button
          type="submit"
          className="rounded-none text-[12px] font-bold uppercase tracking-[.1em]"
          disabled={createActivity.isPending}
          data-testid="button-log-activity"
        >
          {createActivity.isPending && (
            <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
          )}
          Log it
        </Button>
      </footer>
    </form>
  );
}
