import { useEffect, useId, useRef, useState } from 'react';
import { customFetch, HttpApiError } from '@workspace/api-client-react';
import type { SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { CheckCircle2 } from '@/components/icons';
import { requestUuid } from '@/lib/request-uuid';

export function SaleReturnInspection({ sale, onChange, disabled = false, canInspect = true }: { sale: SaleWorkspaceRecord; onChange: (sale: SaleWorkspaceRecord) => void; disabled?: boolean; canInspect?: boolean }) {
  const id = useId();
  const [note, setNote] = useState(''), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const retry = useRef<{ key: string; requestId: string } | undefined>(undefined);
  const latest = useRef(sale); latest.current = sale;
  const inFlight = useRef(false), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setNote(''); setConfirmed(false); setError(''); retry.current = undefined; }, [sale.id]);
  if (sale.lifecycle?.status !== 'returned' || (!sale.standaloneReturn && sale.returnReplacement?.direction !== 'returned')) return null;
  async function complete() {
    if (inFlight.current || disabled || !canInspect || !confirmed || !note.trim()) return;
    inFlight.current = true; setBusy(true); setError('');
    const current = { id: sale.id, revision: sale.revision };
    const key = JSON.stringify([current, note.trim()]);
    if (retry.current?.key !== key) retry.current = { key, requestId: requestUuid() };
    try {
      const result = await customFetch<{ sale: SaleWorkspaceRecord }>(`/api/sale-return-inspection/${sale.id}`, { method: 'POST', body: JSON.stringify({ expectedRevision: sale.revision, requestId: retry.current.requestId, confirm: true, note: note.trim() }) });
      if (!mounted.current) return;
      if (latest.current.id !== current.id || latest.current.revision !== current.revision) throw new Error('The deal changed while the inspection was saved. Reload it to see the latest vehicle status.');
      if (result.sale?.id !== current.id || !result.sale.returnInspection || result.sale.lifecycle?.status !== 'returned') throw new Error('The inspection result could not be confirmed. Reload the deal before trying again.');
      onChange(result.sale);
    } catch (failure) {
      if (mounted.current) setError(failure instanceof HttpApiError && failure.data && typeof failure.data === 'object' && 'error' in failure.data ? String(failure.data.error) : failure instanceof Error ? failure.message : 'The inspection could not be saved. Keep this page open and try again.');
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  if (sale.returnInspection) return <section className="sale-desk-sheet" aria-label="Returned vehicle inspection"><h3><CheckCircle2 size={18} aria-hidden="true"/> Inspection recorded</h3><p>The returned vehicle was made available on {new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' }).format(new Date(sale.returnInspection.at))}. The original sale documents and payment history are kept.</p><details><summary>Inspection note</summary><p>{sale.returnInspection.note}</p></details></section>;
  return <section className="sale-desk-sheet" aria-label="Returned vehicle inspection" aria-busy={busy}><h3><CheckCircle2 size={18} aria-hidden="true"/> Returned vehicle inspection</h3><p>This car is held off sale. After checking its condition, keys and paperwork, record the inspection to make it available again.</p>{!canInspect ? <p>A staff member with permission to manage sales must record the inspection.</p> : <details><summary>Complete inspection</summary><fieldset disabled={disabled || busy} style={{ minWidth: 0, marginTop: '1rem' }}><label htmlFor={`${id}-note`}>Inspection note</label><Textarea id={`${id}-note`} rows={3} maxLength={1200} value={note} onChange={event => setNote(event.target.value)} placeholder="Condition, mileage, keys, documents and work completed"/><label className="sale-return-check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/><span>I have inspected the returned vehicle and it is ready to advertise.</span></label><p>The current stock listing and ownership will be checked before availability changes. A listing archived after the previous sale will also be restored.</p></fieldset>{error && <p role="alert">{error}</p>}<Button type="button" variant="outline" disabled={disabled || busy || !confirmed || !note.trim()} onClick={() => void complete()}>{busy ? 'Recording inspection…' : 'Record inspection & make available'}</Button></details>}</section>;
}
