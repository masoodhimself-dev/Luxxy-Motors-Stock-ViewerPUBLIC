import { useEffect, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { MessageCircle, QrCode } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { WhatsAppTemplateSettings } from '@/components/whatsapp-template-settings';
import { phoneSharingSettingsQueryKey, usePhoneSharingSettings, type PhoneSharingSettings as Settings } from '@/lib/phone-sharing-settings';
import './integration-settings.css';
import './phone-sharing-settings.css';

export function PhoneSharingSettings() {
  const query = usePhoneSharingSettings();
  const cache = useQueryClient();
  const [enabled, setEnabled] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // Preserve unsaved edits if another panel refreshes the shared query.
  useEffect(() => { if (enabled === undefined && query.data) setEnabled(query.data.enabled); }, [enabled, query.data]);
  const changed = enabled !== undefined && query.data !== undefined && enabled !== query.data.enabled;
  async function reload() {
    setError(''); setNotice('');
    const result = await query.refetch();
    if (result.data) setEnabled(result.data.enabled);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!query.data || enabled === undefined || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await customFetch<Settings>('/api/staff/phone-sharing-settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: query.data.revision, enabled }),
      });
      cache.setQueryData(phoneSharingSettingsQueryKey, result);
      setEnabled(result.enabled);
      setNotice('WhatsApp & QR settings saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sharing settings could not be saved. Try again.');
    } finally { setBusy(false); }
  }

  return <section className="integration-settings phone-sharing-settings" aria-label="WhatsApp and QR settings" data-settings-dirty={changed}>
    <div className="integration-heading"><div><p className="integration-eyebrow">Staff sharing</p><h2>WhatsApp & QR</h2><p>Prepare a customer message in the portal, then scan with your phone to send it in WhatsApp.</p></div><QrCode aria-hidden="true" /></div>
    {(query.isError || error) && <div className="integration-error" role="alert"><p>{error || 'Sharing settings could not be loaded.'}</p><Button type="button" variant="outline" disabled={busy || query.isFetching} onClick={() => void reload()}>Reload settings</Button></div>}
    {notice && <p className="integration-notice" role="status">{notice}</p>}
    {!query.data ? query.isLoading && <p role="status">Loading sharing settings…</p> : <form onSubmit={save}>
      <article className="integration-card">
        <div className="phone-sharing-toggle"><div><h3 id="phone-sharing-label">Allow WhatsApp QR sharing</h3><p id="phone-sharing-help">Staff can prepare messages for enquiries, bookings, vehicle media and sales documents.</p></div><Switch aria-labelledby="phone-sharing-label" aria-describedby="phone-sharing-help" checked={enabled ?? query.data.enabled} onCheckedChange={value => { setEnabled(value); setNotice(''); }} disabled={busy} /></div>
        <p className="integration-footnote">Turning this off stops new WhatsApp sharing links. Existing links keep their original expiry; staff can still record messages already sent or revoke a link. Email delivery and your public WhatsApp contact button are unchanged.</p>
        <div className="integration-actions"><Button type="submit" disabled={busy || !changed}>{busy ? 'Saving…' : 'Save sharing settings'}</Button><Button type="button" variant="outline" disabled={busy || !changed} onClick={() => { setEnabled(query.data!.enabled); setError(''); setNotice(''); }}>Undo changes</Button></div>
      </article>
    </form>}
    <WhatsAppTemplateSettings />
    <details className="phone-sharing-guide"><summary>How sharing works, link expiry and upload limits</summary><div className="integration-grid">
      <article className="integration-card"><div className="integration-card-heading"><MessageCircle aria-hidden="true" /><div><h3>Sending from your phone</h3><p>Staff stay in control of every message.</p></div></div><ol className="phone-sharing-steps"><li>Check the customer number, message and selected files.</li><li>Scan the QR, open WhatsApp and tap Send.</li><li>Return to the portal and choose “I’ve sent it” to save the message in the customer’s enquiry history.</li></ol><p className="integration-footnote">Scanning never sends a message. Staff confirmation does not prove delivery or read status, and replies in a personal WhatsApp account do not appear in the portal. Use email instead when needed.</p></article>
      <article className="integration-card"><h3>Private links and phone uploads</h3><dl className="phone-sharing-limits"><div><dt>Customer file links</dt><dd>Expire after 24 hours; revoke sooner from the sharing panel.</dd></div><div><dt>Quick Enquiry photos</dt><dd>Up to 2 compressed photos. Phone-upload links last 15 minutes.</dd></div><div><dt>Vehicle recording</dt><dd>Up to 30 seconds, landscape, with pause and resume. Preview before publishing.</dd></div></dl><p className="integration-footnote">Phone upload and recording links are separate staff tools. This switch controls customer WhatsApp sharing only. Link lifetimes and upload limits are fixed for security.</p></article>
    </div></details>
  </section>;
}
