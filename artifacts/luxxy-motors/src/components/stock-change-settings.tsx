import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { useStaffAccess } from '@/components/portal/dealer-administration';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { stockChangeSettingsQueryKey, stockChangeTasksQueryKey, useStockChangeSettings, type StockChangeSettings as Settings } from '@/lib/stock-change-tasks';
import './integration-settings.css';

export function StockChangeSettings() {
  const query = useStockChangeSettings();
  const access = useStaffAccess();
  const cache = useQueryClient();
  const [edits, setEdits] = useState<{ minimumReduction: string; contactIntervalDays: string; revision: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const values = edits ?? { minimumReduction: String(query.data?.minimumReduction ?? ''), contactIntervalDays: String(query.data?.contactIntervalDays ?? ''), revision: query.data?.revision ?? 0 };
  const changed = Boolean(query.data && (values.minimumReduction !== String(query.data.minimumReduction) || values.contactIntervalDays !== String(query.data.contactIntervalDays)));
  const canSave = access.data?.permissions.includes('settings.publish') ?? false;
  async function reload() {
    const result = await query.refetch();
    if (result.data) { setEdits(null); setError(''); setNotice(''); }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!query.data || busy || !canSave) return;
    const minimumReduction = Number(values.minimumReduction), contactIntervalDays = Number(values.contactIntervalDays);
    if (!values.minimumReduction.trim() || !values.contactIntervalDays.trim() || !Number.isInteger(minimumReduction) || minimumReduction < 0 || minimumReduction > 1000000 || !Number.isInteger(contactIntervalDays) || contactIntervalDays < 0 || contactIntervalDays > 365) {
      setError('Enter a whole-pound reduction from £0 to £1,000,000 and a contact interval from 0 to 365 days.'); return;
    }
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await customFetch<Settings>('/api/staff/stock-change-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: values.revision, minimumReduction, contactIntervalDays }) });
      cache.setQueryData(stockChangeSettingsQueryKey, result);
      await cache.invalidateQueries({ queryKey: stockChangeTasksQueryKey });
      setEdits(null); setNotice('Price update preferences saved. Customer messages remain manual.');
    } catch (cause) {
      const conflict = Boolean(cause && typeof cause === 'object' && 'status' in cause && cause.status === 409);
      setError(conflict ? 'These preferences changed in another session. Your edits are kept. Reload the latest settings before saving again.' : 'Price update preferences could not be saved. Your edits are kept. Try again.');
    } finally { setBusy(false); }
  }
  return <section className="integration-settings" aria-label="Price update settings" data-settings-dirty={changed}>
    <div className="integration-heading"><div><p className="integration-eyebrow">Staff reminders</p><h2>Price updates</h2><p>Choose when Home suggests contacting customers about a reduced car price.</p></div></div>
    {(query.isError || error) && <div className="integration-error" role="alert"><p>{error || 'Price update preferences could not be loaded.'}</p><Button variant="outline" type="button" disabled={busy || query.isFetching} onClick={() => void reload()}>Reload price update settings</Button></div>}
    {notice && <p className="integration-notice" role="status">{notice}</p>}
    {!query.data ? query.isLoading && <p role="status">Loading price update preferences…</p> : <form onSubmit={save}><article className="integration-card">
      <div className="integration-grid">
        <div className="grid gap-2 text-sm"><label htmlFor="stock-minimum-reduction"><strong>Minimum reduction (£)</strong></label><Input id="stock-minimum-reduction" type="number" inputMode="numeric" min={0} max={1000000} step={1} value={values.minimumReduction} disabled={busy || !canSave} onChange={event => { setEdits({ ...values, minimumReduction: event.target.value }); setNotice(''); }} aria-describedby="stock-minimum-help" /><span id="stock-minimum-help">Suggest contact when a reduction reaches this amount. Use 0 for every reduction.</span></div>
        <div className="grid gap-2 text-sm"><label htmlFor="stock-contact-interval"><strong>Days between price-update contacts</strong></label><Input id="stock-contact-interval" type="number" inputMode="numeric" min={0} max={365} step={1} value={values.contactIntervalDays} disabled={busy || !canSave} onChange={event => { setEdits({ ...values, contactIntervalDays: event.target.value }); setNotice(''); }} aria-describedby="stock-interval-help" /><span id="stock-interval-help">Avoid repeat suggestions for the same customer and car. Use 0 for no waiting period.</span></div>
      </div>
      <p className="integration-footnote">Every accepted price change is still recorded and shown on the website as usual. These preferences only control staff reminders. Booked visits and paid commitments still need review. Agreed prices, deposits, invoices and payments stay unchanged.</p>
      <p className="integration-footnote">No email or WhatsApp message is sent automatically. Staff review the current price before sending.</p>
      {!canSave && <p className="integration-footnote" role="status">An owner with settings permission can change these preferences.</p>}
      <div className="integration-actions"><Button type="submit" disabled={busy || !changed || !canSave}>{busy ? 'Saving…' : 'Save price update preferences'}</Button><Button variant="outline" type="button" disabled={busy || !changed} onClick={() => { setEdits(null); setError(''); setNotice(''); }}>Undo changes</Button></div>
    </article></form>}
  </section>;
}
