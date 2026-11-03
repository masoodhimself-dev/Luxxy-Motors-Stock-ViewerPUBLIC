import { useEffect, useRef, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import type { SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { AlertCircle, CheckCircle2, FileText, CreditCard, LoaderCircle, ShieldCheck, Truck } from '@/components/icons';
import { Button } from '@/components/ui/button';
import './sale-final-review.css';

type FinalReview = NonNullable<SaleWorkspaceRecord['finalReview']>;
export type SaleFinalReviewProps = {
  sale: SaleWorkspaceRecord;
  onSaved: (sale: SaleWorkspaceRecord) => void;
  onNavigate?: (field: string) => void;
  /** Parent deal editor must save pending changes before reviewing the saved revision. */
  disabled?: boolean;
};
const fieldLabels: Record<string, string> = { deal: 'Deal', customer: 'Customer', vehicle: 'Vehicle', payments: 'Payments', invoices: 'Invoices', handover: 'Collection and delivery' };
const checks = [
  { label: 'Totals and delivery charges', Icon: FileText },
  { label: 'Confirmed payments and balance', Icon: CreditCard },
  { label: 'Customer, car and documents', Icon: ShieldCheck },
  { label: 'Collection or delivery details', Icon: Truck },
];
export function SaleFinalReview({ sale, onSaved, onNavigate, disabled = false }: SaleFinalReviewProps) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [checked, setChecked] = useState<SaleWorkspaceRecord | null>(null);
  const latest = useRef(sale); latest.current = sale;
  const latestDisabled = useRef(disabled); latestDisabled.current = disabled;
  const inFlight = useRef(false), generation = useRef(0), controller = useRef<AbortController | null>(null);
  useEffect(() => {
    setChecked(null); setError(''); setBusy(false); inFlight.current = false;
    return () => { generation.current++; controller.current?.abort(); };
  }, [sale.id]);
  const displayed = checked?.id === sale.id && checked.revision >= sale.revision ? checked : sale;
  const review = displayed.finalReview, stale = !!review && review.reviewedRevision !== displayed.revision;
  const passed = !stale && review?.status === 'passed' && !disabled;
  const status = busy ? 'checking' : stale || disabled && !!review ? 'stale' : review?.status ?? 'ready';
  const title = { checking: 'Please wait while AI checks the sale…', stale: 'The sale has changed', passed: 'Checks passed', attention: 'Needs attention', unavailable: 'Check unavailable', ready: 'Final checks' }[status];
  const summary = busy ? 'Checking totals, payments, documents and collection or delivery details.'
    : status === 'stale' ? disabled ? 'Save your changes, then run the final checks again.' : 'The previous check is for an earlier version. Run the checks again before continuing.'
    : review?.summary || 'Check the saved deal before issuing the final invoice or completing handover.';
  async function run() {
    if (inFlight.current || disabled || passed) return;
    const requested = { id: displayed.id, revision: displayed.revision, baselineRevision: sale.revision };
    const current = ++generation.current, requestController = new AbortController(); controller.current = requestController;
    inFlight.current = true; setBusy(true); setError('');
    try {
      const result = await customFetch<{ sale: SaleWorkspaceRecord; review: FinalReview }>(`/api/sale-operations/${requested.id}/final-review`, { method: 'POST', signal: requestController.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: requested.revision }) });
      if (current !== generation.current || latest.current.id !== requested.id) return;
      if (latest.current.revision !== requested.revision && latest.current.revision !== requested.baselineRevision) { setError('The sale changed while the checks were running. Review the saved changes and run the checks again.'); return; }
      if (latestDisabled.current) { setError('The deal has unsaved changes. Save them and run the checks again.'); return; }
      const savedReview = result.sale?.finalReview;
      if (result.sale?.id !== requested.id || !Number.isSafeInteger(result.sale.revision) || result.sale.revision < requested.revision || !savedReview || !Array.isArray(savedReview.issues) || typeof savedReview.summary !== 'string' || savedReview.reviewedRevision !== result.sale.revision || !['passed', 'attention', 'unavailable'].includes(savedReview.status) || savedReview.id !== result.review?.id) throw new Error('Invalid final check result');
      setChecked(result.sale); onSaved(result.sale);
    } catch (error) {
      if (current !== generation.current || latest.current.id !== requested.id) return;
      const message = (error as { data?: { error?: unknown } })?.data?.error;
      setError(typeof message === 'string' ? message : 'The final check could not be completed. Your saved deal is kept. Try again.');
    } finally { if (current === generation.current) { inFlight.current = false; setBusy(false); } }
  }
  return <section className={`sale-final-review sale-final-review--${status}`} aria-label="Final sale checks" aria-busy={busy}>
    <div className="sale-final-review-heading"><span className="sale-final-review-mark" aria-hidden="true">{busy ? <LoaderCircle className="sale-final-review-loader" /> : passed ? <CheckCircle2 /> : status === 'attention' || status === 'unavailable' ? <AlertCircle /> : <ShieldCheck />}</span><div className="sale-final-review-copy"><h3 role="status" aria-live="polite">{title}</h3><p>{summary}</p></div>
      <Button type="button" variant={passed ? 'outline' : 'default'} disabled={busy || disabled || passed} onClick={() => void run()}>{busy ? 'Checking…' : passed ? 'Checked' : review?.status === 'unavailable' || error ? 'Retry checks' : 'Run final checks'}</Button>
    </div>
    <ul className="sale-final-review-checks" aria-label="What is checked">{checks.map(({ label, Icon }) => <li key={label}><Icon size={16} /><span>{label}</span></li>)}</ul>
    {error && <p className="sale-final-review-error" role="alert">{error}</p>}
    {!busy && status !== 'stale' && review && !!review.issues.length && <ul className="sale-final-review-issues" aria-label="Check results">{review.issues.map((issue, index) => <li key={`${issue.field}-${index}`} className={`sale-final-review-issue--${issue.severity}`}><span className="sale-final-review-issue-label">{issue.severity === 'error' ? 'Fix before continuing' : 'Please check'}</span><p>{issue.message}</p>{onNavigate && <button type="button" onClick={() => onNavigate(issue.field)}>Open {fieldLabels[issue.field] ?? 'deal'}</button>}</li>)}</ul>}
    {!busy && disabled && !review && <p className="sale-final-review-help">Save the deal before running the final checks.</p>}
    {!busy && status !== 'stale' && review && <p className="sale-final-review-help">Checked {new Date(review.checkedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}{review.status === 'passed' ? '. New changes will need another check.' : '.'}</p>}
  </section>;
}
