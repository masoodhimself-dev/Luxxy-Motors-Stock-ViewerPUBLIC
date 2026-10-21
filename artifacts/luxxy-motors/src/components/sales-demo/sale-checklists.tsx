import {
  normalizedSaleExchangeRegistration,
  partExchangeChecklistItems,
  saleCompletionChecklistItems,
  saleWorkspaceExchanges,
  type SaleCheckEvidence,
  type SaleCheckStatus,
  type SaleWorkspaceChecklistInput,
  type SaleWorkspaceDraft,
  type SaleWorkspaceRecord,
} from '@workspace/vehicle-meta';
import { Button } from '@/components/ui/button';
import './sale-checklists.css';

interface Props {
  draft: SaleWorkspaceDraft;
  checklists?: SaleWorkspaceRecord['checklists'];
  busy?: boolean;
  readOnly?: boolean;
  intakeOnly?: boolean;
  onReviewIntake?: () => void;
  onChange: (input: SaleWorkspaceChecklistInput) => void;
}

function CheckRow({ item, evidence, disabled, onChange }: {
  item: { id: string; label: string; detail: string };
  evidence?: SaleCheckEvidence;
  disabled: boolean;
  onChange: (status: SaleCheckStatus) => void;
}) {
  const status = evidence?.status ?? 'pending';
  return <div className="sale-check-row" data-status={status} role="group" aria-label={item.label}>
    <div className="sale-check-copy"><strong>{item.label}</strong><p>{item.detail}</p>
      {evidence && <small title={new Date(evidence.at).toLocaleString('en-GB')}>Saved by {evidence.actor}</small>}
    </div>
    <div className="sale-check-controls">
      <label><input type="checkbox" aria-label={`Check: ${item.label}`} checked={status === 'checked'}
        disabled={disabled} onChange={event => onChange(event.target.checked ? 'checked' : 'pending')} />Checked</label>
      <Button type="button" variant="outline" size="sm" disabled={disabled} aria-pressed={status === 'not_needed'}
        aria-label={`Not needed: ${item.label}`} onClick={() => onChange(status === 'not_needed' ? 'pending' : 'not_needed')}>Not needed</Button>
    </div>
  </div>;
}

export function SaleChecklists({ draft, checklists, busy = false, readOnly = false, intakeOnly = false, onChange, onReviewIntake }: Props) {
  const exchanges = saleWorkspaceExchanges(draft);
  const registrations = exchanges.map(exchange => normalizedSaleExchangeRegistration(exchange.registration));
  const duplicates = new Set(registrations.filter((registration, index) => registration && registrations.indexOf(registration) !== index));
  if (intakeOnly && !exchanges.length) return null;
  if (!intakeOnly) {
    const intakeComplete = !duplicates.size && exchanges.every(exchange => {
      const registration = normalizedSaleExchangeRegistration(exchange.registration);
      return registration && partExchangeChecklistItems.every(item => Boolean(checklists?.partExchanges[registration]?.[item.id]));
    });
    return <aside className="sale-checklists sale-reminders" aria-label="Before completing the sale">
      <header><div><h2>Before completing the sale</h2><p>A quick reminder of what to review.</p></div></header>
      <ul>{saleCompletionChecklistItems.map(item => <li key={item.id}>{item.detail}</li>)}</ul>
      {exchanges.length > 0 && <div className="sale-intake-status">
        <p>{intakeComplete ? 'Part-exchange intake checks are saved. No need to complete them again.' : 'Part-exchange intake checks still need completing in Payments.'}</p>
        {!intakeComplete && onReviewIntake && !readOnly && <Button type="button" variant="outline" disabled={busy} onClick={onReviewIntake}>Review part-exchange checks</Button>}
      </div>}
    </aside>;
  }
  return <section className="sale-checklists" aria-label={intakeOnly ? 'Part-exchange intake checks' : 'Final sale checklist'} aria-busy={busy}>
    {duplicates.size > 0 && <p className="sale-check-hint" role="alert">The same part-exchange registration appears more than once. Correct the entries in Payments before completing these checks.</p>}
    {exchanges.map((exchange, index) => {
      const registration = normalizedSaleExchangeRegistration(exchange.registration);
      const saved = checklists?.partExchanges[registration];
      const remaining = partExchangeChecklistItems.filter(item => !saved?.[item.id]).length;
      return <details className="sale-px-checks" key={`${registration}-${index}`} open={remaining > 0}>
        <summary><span>Part-exchange intake{registration ? ` — ${exchange.registration}` : ` — car ${index + 1}`}</span>
          <span className="sale-check-count" data-ready={remaining === 0}>{remaining ? `${remaining} to check` : 'Complete'}</span></summary>
        {!registration && <p className="sale-check-hint">Enter this car’s registration before saving its intake checks.</p>}
        <div className="sale-check-rows">{partExchangeChecklistItems.map(item => <CheckRow key={item.id} item={item}
          evidence={saved?.[item.id]} disabled={busy || readOnly || !registration || duplicates.has(registration)}
          onChange={status => onChange({ partExchanges: [{ registration, items: { [item.id]: status } }] })} />)}</div>
      </details>;
    })}
    <p className="sale-check-hint">{readOnly ? 'Saved checks are kept with this sale.' : busy ? 'Saving checks…' : 'Checks save as you go. Completed intake checks stay saved for this car.'}</p>
  </section>;
}
