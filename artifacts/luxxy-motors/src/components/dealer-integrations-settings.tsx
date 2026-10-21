import { customerFeaturePolicy } from '@workspace/vehicle-meta';
import { StockConnectionSettings } from "./stock-connection-settings";
import { useEffect, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { KeyRound, Mail, CreditCard, RefreshCw, ShieldCheck } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import './integration-settings.css';
type Readiness = { resend: { ready: boolean; issues: string[] }; stripe: { ready: boolean; issues: string[] }; message: string };
type Settings = { revision: number; preview?: boolean; resend: { enabled: boolean; apiKeyConfigured: boolean; from: string; replyTo: string }; stripe: { enabled: boolean; mode: 'test' | 'live'; publishableKeyConfigured: boolean; secretKeyConfigured: boolean; webhookSecretConfigured: boolean }; readiness: Readiness };
const request = <T,>(path: string, method = 'GET', body?: unknown) => customFetch<T>(path, { method, ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}) });
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'The integration settings could not be saved.';
export function DealerIntegrationsSettings() {
  const [settings, setSettings] = useState<Settings>();
  const [apiKey, setApiKey] = useState(''), [publishableKey, setPublishableKey] = useState(''), [secretKey, setSecretKey] = useState(''), [webhookSecret, setWebhookSecret] = useState('');
  const [savedConnection, setSavedConnection] = useState('');
  const connectionSnapshot = (value: Settings) => JSON.stringify([value.resend, value.stripe]);
  const [clear, setClear] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  async function load() { setBusy(true); setError(''); try { const loaded = await request<Settings>('/api/dealer-integrations'); setSettings(loaded); setSavedConnection(connectionSnapshot(loaded)); setApiKey(''); setPublishableKey(''); setSecretKey(''); setWebhookSecret(''); setClear({}); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); } }
  useEffect(() => { void load(); }, []);
  async function save() {
    if (!settings) return; setBusy(true); setError(''); setMessage('');
    try { const response = await request<Settings>('/api/dealer-integrations', 'PUT', { expectedRevision: settings.revision, resend: { enabled: settings.resend.enabled, from: settings.resend.from, replyTo: settings.resend.replyTo, apiKey, clearApiKey: clear.apiKey ?? false }, stripe: { enabled: settings.stripe.enabled, mode: settings.stripe.mode, publishableKey, secretKey, webhookSecret, clearPublishableKey: clear.publishableKey ?? false, clearSecretKey: clear.secretKey ?? false, clearWebhookSecret: clear.webhookSecret ?? false } }); setSettings(response); setSavedConnection(connectionSnapshot(response)); setApiKey(''); setPublishableKey(''); setSecretKey(''); setWebhookSecret(''); setClear({}); setMessage('Private integration settings saved.'); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  function secret(label: string, id: string, configured: boolean, value: string, setter: (value: string) => void) { return <div className="integration-field"><label htmlFor={id}>{label} <span className="integration-secret-status">{configured && !clear[id] ? 'Saved privately' : 'Not configured'}</span></label><Input id={id} type="password" autoComplete="new-password" value={value} onChange={event => setter(event.target.value)} placeholder={configured ? 'Leave blank to keep the saved key' : 'Add your key when ready'} /><label className="integration-check"><input type="checkbox" checked={clear[id] ?? false} onChange={event => setClear(current => ({ ...current, [id]: event.target.checked }))} /> Remove saved key</label></div>; }
  const changed = Boolean(settings && (connectionSnapshot(settings) !== savedConnection || apiKey || publishableKey || secretKey || webhookSecret || Object.values(clear).some(Boolean)));
  return <section className="integration-settings" aria-label="API integration settings" data-settings-dirty={changed}><div className="integration-heading"><div><p className="integration-eyebrow">Private settings</p><h2>Connections</h2><p>Email delivery and stock import setup. These settings are usually managed by your platform operator.</p></div><ShieldCheck aria-hidden="true" /></div>
    {error && <p role="alert" className="integration-error">{error}</p>}{message && <p role="status" className="integration-notice">{message}</p>}
    {!settings ? <Button type="button" onClick={() => void load()} disabled={busy}><RefreshCw size={16} />{busy ? 'Loading settings…' : 'Reload settings'}</Button> : <>
    {settings.preview && <p className="integration-notice">Email and payment requests are disabled on this server.</p>}
    <div className="integration-card"><h3>Email delivery</h3><p><strong>{settings.resend.enabled ? 'Enabled' : 'Disabled'}</strong> · {settings.resend.apiKeyConfigured ? 'Key saved privately' : 'No saved key'}</p><p className="integration-readiness">{settings.readiness.resend.ready ? 'Required settings are present. This is not a delivery test.' : settings.readiness.resend.issues.join(' ')}</p></div>
    <details className="integration-connection-editor"><summary>Change connection setup</summary><p className="integration-footnote">Use verified provider details. Changes apply only when saved.</p>
    <fieldset disabled={busy} className="integration-grid"><div className="integration-card"><div className="integration-card-heading"><Mail /><div><h3>Resend</h3><p>Customer emails, receipts and staff notifications</p></div><span className="integration-badge">{settings.resend.enabled ? 'Enabled' : 'Disabled'}</span></div>
      {secret('API key', 'apiKey', settings.resend.apiKeyConfigured, apiKey, setApiKey)}
      <div className="integration-field"><label htmlFor="resend-from">Sender</label><Input id="resend-from" value={settings.resend.from} onChange={event => setSettings({ ...settings, resend: { ...settings.resend, from: event.target.value } })} placeholder="Showroom <hello@yourdomain.co.uk>" /><small>Use an address on a domain verified in Resend.</small></div>
      <div className="integration-field"><label htmlFor="resend-reply">Reply-to email</label><Input id="resend-reply" type="email" value={settings.resend.replyTo} onChange={event => setSettings({ ...settings, resend: { ...settings.resend, replyTo: event.target.value } })} placeholder="Optional" /></div>
      <label className="integration-check"><input type="checkbox" checked={settings.resend.enabled} onChange={event => setSettings({ ...settings, resend: { ...settings.resend, enabled: event.target.checked } })} /> Enable email delivery</label>
      <p className="integration-readiness">{settings.readiness.resend.ready ? 'Saved configuration is ready for provider setup checks.' : settings.readiness.resend.issues.join(' ')}</p>
    </div>{customerFeaturePolicy.onlineCardReservations && <div className="integration-card"><div className="integration-card-heading"><CreditCard /><div><h3>Stripe</h3><p>This dealership’s customer reservation deposits</p></div><span className="integration-badge">{settings.stripe.enabled ? 'Enabled' : 'Disabled'}</span></div>
      <div className="integration-field"><label htmlFor="stripe-mode">Payment mode</label><NativeSelect id="stripe-mode" value={settings.stripe.mode} onChange={event => { setSettings({ ...settings, stripe: { ...settings.stripe, mode: event.target.value as 'test' | 'live', enabled: false, publishableKeyConfigured: false, secretKeyConfigured: false, webhookSecretConfigured: false } }); setPublishableKey(''); setSecretKey(''); setWebhookSecret(''); }}><option value="test">Test payments</option><option value="live">Live payments</option></NativeSelect><small>Changing mode clears the keys from the previous mode when saved.</small></div>
      {secret('Publishable key', 'publishableKey', settings.stripe.publishableKeyConfigured, publishableKey, setPublishableKey)}{secret('Secret key', 'secretKey', settings.stripe.secretKeyConfigured, secretKey, setSecretKey)}{secret('Webhook signing secret', 'webhookSecret', settings.stripe.webhookSecretConfigured, webhookSecret, setWebhookSecret)}
      <div className="integration-field"><label>Webhook endpoint</label><code>{typeof window === 'undefined' ? '' : window.location.origin}/api/reservations/stripe/webhook</code><small>Subscribe to checkout.session.completed, checkout.session.expired, checkout.session.async_payment_failed, charge.refunded, refund.created, refund.updated and refund.failed in Stripe.</small></div>
      <label className="integration-check"><input type="checkbox" checked={settings.stripe.enabled} onChange={event => setSettings({ ...settings, stripe: { ...settings.stripe, enabled: event.target.checked } })} /> Enable reservation payments</label>
      <p className="integration-readiness">{settings.readiness.stripe.ready ? 'Saved configuration is ready for webhook setup checks.' : settings.readiness.stripe.issues.join(' ')}</p>
    </div>}</fieldset>
    <div className="integration-actions"><Button type="button" disabled={busy || !changed} onClick={() => void save()}><KeyRound size={16} />{busy ? 'Working…' : 'Save private settings'}</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => { if (!changed || window.confirm('Discard unsaved connection settings and reload?')) void load(); }}>Reload saved settings</Button></div><p role="status" className="integration-footnote">{changed ? 'Unsaved connection changes.' : 'Connection settings saved.'} Configuration checks run when saving. They do not contact the provider or send an email. Keys are never returned to the browser or saved in browser storage.</p></details>
    </>}
    <StockConnectionSettings />
  </section>;
}
