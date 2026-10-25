import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { useStaffAccess } from '@/components/portal/dealer-administration';
import { Button } from '@/components/ui/button';
import { vehicleWatchCountsKey, vehicleWatchSettingsKey, vehicleWatchTasksKey, useVehicleWatchSettings, type VehicleWatchSettings as Settings } from '@/lib/vehicle-watch-tasks';
import './integration-settings.css';
import './vehicle-watch-settings.css';

export function VehicleWatchSettings() {
  const query = useVehicleWatchSettings(), access = useStaffAccess(), cache = useQueryClient();
  const [edits, setEdits] = useState<{ enabled: boolean; revision: number } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const values = edits ?? { enabled: query.data?.enabled ?? false, revision: query.data?.revision ?? 0 };
  const changed = Boolean(query.data && values.enabled !== query.data.enabled);
  const canSave = Boolean(access.data?.permissions.includes('settings.publish'));
  async function reload() {
    const response = await query.refetch();
    if (response.data) { setEdits(null); setError(''); setNotice(''); }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!query.data || busy || !canSave || !changed) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await customFetch<Settings>('/api/staff/vehicle-watch-settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
      cache.setQueryData(vehicleWatchSettingsKey, response);
      await Promise.all([cache.invalidateQueries({ queryKey: vehicleWatchTasksKey }), cache.invalidateQueries({ queryKey: vehicleWatchCountsKey }), cache.invalidateQueries({ queryKey: ['vehicle-watch-availability'] })]);
      setEdits(null); setNotice('Watch preferences saved. Customer updates remain manual.');
    } catch (cause) {
      const conflict = Boolean(cause && typeof cause === 'object' && 'status' in cause && cause.status === 409);
      setError(conflict ? 'Watch preferences changed in another session. Your edit is kept. Reload the latest preferences before saving again.' : 'Watch preferences could not be saved. Your edit is kept. Try again.');
    } finally { setBusy(false); }
  }
  return <section className="integration-settings" aria-label="Watch this car settings" data-settings-dirty={changed}>
    <div className="integration-heading"><div><p className="integration-eyebrow">Customer updates</p><h2>Watch this car</h2><p>Let customers request price and availability updates without creating an account.</p></div></div>
    {(query.isError || error) && <div className="integration-error" role="alert"><p>{error || 'Watch preferences could not be loaded.'}</p><Button variant="outline" type="button" disabled={busy || query.isFetching} onClick={() => void reload()}>Reload watch settings</Button></div>}
    {notice && <p className="integration-notice" role="status">{notice}</p>}
    {!query.data ? query.isLoading && <p role="status">Loading watch preferences…</p> : <form onSubmit={save}><article className="integration-card">
      <label className="watch-settings-toggle"><input type="checkbox" checked={values.enabled} disabled={busy || !canSave} onChange={event => { setEdits({ enabled: event.target.checked, revision: values.revision }); setNotice(''); }} /><span><strong>Offer Watch this car on the website</strong><span className="watch-settings-toggle-help">Customers verify their email before receiving updates. They can stop watching from any update email.</span></span></label>
      <p className="integration-footnote" role="status">{query.data.emailReady ? 'The dealership email connection is ready.' : 'The dealership email connection is not ready. Complete Connections before asking customers to verify their email.'}</p>
      {query.data.repliesReady !== undefined && <p className="integration-footnote">{query.data.repliesReady ? 'Customer email replies return to the correct enquiry in Inbox.' : 'Customer replies use the configured reply inbox. Incoming email routing must be enabled to bring them into Inbox.'}</p>}
      <p className="integration-footnote">Price reductions, reservations, a car becoming available again and confirmed sales appear on Home for staff review. A missing stock-feed advert is never treated as a sale.</p>
      <p className="integration-footnote">Staff choose the recipients, edit the message and approve each batch. No price or availability update is sent automatically. Watching alone does not create an enquiry.</p>
      {!canSave && <p className="integration-footnote">An owner with settings permission can change this preference.</p>}
      <div className="integration-actions"><Button type="submit" disabled={busy || !canSave || !changed}>{busy ? 'Saving…' : 'Save watch preferences'}</Button><Button variant="outline" type="button" disabled={busy || !changed} onClick={() => { setEdits(null); setError(''); setNotice(''); }}>Undo changes</Button></div>
    </article></form>}
  </section>;
}
