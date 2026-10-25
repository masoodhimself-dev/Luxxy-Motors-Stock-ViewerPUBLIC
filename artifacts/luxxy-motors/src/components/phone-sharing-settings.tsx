import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { MessageCircle, QrCode } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { WhatsAppTemplateSettings } from '@/components/whatsapp-template-settings';
import { phoneSharingSettingsQueryKey, usePhoneSharingSettings, type PhoneSharingSettings as Settings } from '@/lib/phone-sharing-settings';
import { privateSettingsSaved, usePrivateSettingsRefresh, type PrivateSettingsSave } from '@/lib/private-settings-sync';
import './integration-settings.css';
import './phone-sharing-settings.css';

export function PhoneSharingSettings() {
  const query = usePhoneSharingSettings();
  const cache = useQueryClient();
  const [draft, setDraft] = useState<{baseline:Settings;enabled:boolean;invoiceQrEnabled:boolean}>();
  const enabled=draft?.enabled,invoiceQrEnabled=draft?.invoiceQrEnabled,baseline=draft?.baseline;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const ownRefresh=useRef<PrivateSettingsSave|undefined>(undefined);
  const snapshot = (settings: Settings) => JSON.stringify([settings.enabled, settings.invoiceQrEnabled === true]);
  const changed = baseline !== undefined && ((enabled !== undefined && enabled !== baseline.enabled) || (invoiceQrEnabled !== undefined && invoiceQrEnabled !== (baseline.invoiceQrEnabled === true)));
  // Preserve unsaved edits if another panel refreshes the shared query.
  useEffect(() => {
    if (!query.data || busy) return;
    const loaded=query.data;
    setDraft(current=>{
      const dirty=current&&(current.enabled!==current.baseline.enabled||current.invoiceQrEnabled!==(current.baseline.invoiceQrEnabled===true));
      if(!current||!dirty)return{baseline:loaded,enabled:loaded.enabled,invoiceQrEnabled:loaded.invoiceQrEnabled===true};
      return current.baseline.revision===ownRefresh.current?.previousRevision&&loaded.revision===ownRefresh.current.savedRevision&&snapshot(loaded)===snapshot(current.baseline)?{...current,baseline:loaded}:current;
    });
  }, [query.data, busy, enabled, invoiceQrEnabled]);
  usePrivateSettingsRefresh('sharing', saved => {ownRefresh.current=saved;return query.refetch();});
  const restore = (settings: Settings) => setDraft({baseline:settings,enabled:settings.enabled,invoiceQrEnabled:settings.invoiceQrEnabled===true});
  async function reload() {
    setError(''); setNotice('');
    const result = await query.refetch();
    if (result.data) restore(result.data);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!baseline || enabled === undefined || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await customFetch<Settings>('/api/staff/phone-sharing-settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: baseline.revision, enabled, invoiceQrEnabled: invoiceQrEnabled === true }),
      });
      cache.setQueryData(phoneSharingSettingsQueryKey, result);
      restore(result);
      await privateSettingsSaved('sharing',baseline.revision,result.revision);
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
        <div className="phone-sharing-toggle"><div><h3 id="phone-sharing-label">Allow WhatsApp QR sharing</h3><p id="phone-sharing-help">Prepare messages for enquiries, bookings, car photos and videos. Staff choose when to send.</p></div><Switch aria-labelledby="phone-sharing-label" aria-describedby="phone-sharing-help" checked={enabled ?? query.data.enabled} onCheckedChange={value => { setDraft(current=>current?{...current,enabled:value}:current); setNotice(''); }} disabled={busy} /></div>
        {(enabled ?? query.data.enabled) && <div className="phone-sharing-toggle phone-sharing-invoice-toggle"><div><h3 id="invoice-sharing-label">Share invoices by WhatsApp QR</h3><p id="invoice-sharing-help">Off by default. Staff can still email, download and print invoices. Receipts and statements use the main sharing switch.</p></div><Switch aria-labelledby="invoice-sharing-label" aria-describedby="invoice-sharing-help" checked={invoiceQrEnabled ?? query.data.invoiceQrEnabled === true} onCheckedChange={value => { setDraft(current=>current?{...current,invoiceQrEnabled:value}:current); setNotice(''); }} disabled={busy} /></div>}
        <p className="integration-footnote">Turning off all sharing stops new WhatsApp links; the invoice switch stops only new invoice links. Existing links keep their original expiry; staff can still record messages already sent or revoke a link. Email delivery and your public WhatsApp contact button are unchanged.</p>
        <div className="integration-actions"><Button type="submit" disabled={busy || !changed}>{busy ? 'Saving…' : 'Save sharing settings'}</Button><Button type="button" variant="outline" disabled={busy || !changed} onClick={() => { restore(query.data!); setError(''); setNotice(''); }}>Undo changes</Button></div>
      </article>
    </form>}
    <details className="phone-sharing-templates"><summary>Edit message templates</summary><WhatsAppTemplateSettings /></details>
    <details className="phone-sharing-guide"><summary>How sharing works, link expiry and upload limits</summary><div className="integration-grid">
      <article className="integration-card"><div className="integration-card-heading"><MessageCircle aria-hidden="true" /><div><h3>Sending from your phone</h3><p>Staff stay in control of every message.</p></div></div><ol className="phone-sharing-steps"><li>Check the customer number, message and selected files.</li><li>Scan the QR, open WhatsApp and tap Send.</li><li>Return to the portal and choose “I’ve sent it” to save the message in the customer’s enquiry history.</li></ol><p className="integration-footnote">Scanning never sends a message. Staff confirmation does not prove delivery or read status, and replies in a personal WhatsApp account do not appear in the portal. Use email instead when needed.</p></article>
      <article className="integration-card"><h3>Private links and phone uploads</h3><dl className="phone-sharing-limits"><div><dt>Customer file links</dt><dd>Expire after 24 hours; revoke sooner from the sharing panel.</dd></div><div><dt>Quick Enquiry photos</dt><dd>Up to 2 compressed photos. Phone-upload links last 15 minutes.</dd></div><div><dt>Vehicle recording</dt><dd>Up to 30 seconds, landscape, with pause and resume. Preview before publishing.</dd></div></dl><p className="integration-footnote">Phone upload and recording links are separate staff tools. This switch controls customer WhatsApp sharing only. Link lifetimes and upload limits are fixed for security.</p></article>
    </div></details>
  </section>;
}
