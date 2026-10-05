import { useEffect, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import type { ChatSettings } from '@workspace/vehicle-meta';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useQueryClient } from '@tanstack/react-query';
import './integration-settings.css';

const readSettings = () => customFetch<ChatSettings>('/api/staff/chat/settings');
const messageFor = (error: unknown) => error instanceof Error ? error.message : 'Chat settings could not be loaded. Please try again.';

export function CustomerChatSettings() {
  const cache = useQueryClient();
  const [settings, setSettings] = useState<ChatSettings>();
  const [saved, setSaved] = useState<ChatSettings>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const changed = settings && JSON.stringify(settings) !== JSON.stringify(saved);

  async function load() {
    setBusy(true); setError('');
    try { const result = await readSettings(); setSettings(result); setSaved(result); }
    catch (cause) { setError(messageFor(cause)); }
    finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, []);
  function change<K extends keyof ChatSettings>(field: K, value: ChatSettings[K]) {
    setSettings(current => current ? { ...current, [field]: value } : current);
    setNotice('');
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!settings || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await customFetch<ChatSettings>('/api/staff/chat/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });
      setSettings(result); setSaved(result); setNotice('Customer chat settings saved.');
      await cache.invalidateQueries({ queryKey: ['staff-chat-settings'] });
      window.dispatchEvent(new Event('dealer-chat-settings-saved'));
    } catch (cause) { setError(messageFor(cause)); }
    finally { setBusy(false); }
  }
  return <section className="integration-settings" aria-label="Customer chat settings">
    <div className="integration-heading"><div><p className="integration-eyebrow">Customer conversations</p><h2>Website chat</h2><p>A friendly place to ask about a car, speak to your team or leave a message.</p></div></div>
    {error && <p role="alert" className="integration-error">{error}</p>}
    {notice && <p role="status" className="integration-notice">{notice}</p>}
    {!settings ? <Button type="button" disabled={busy} onClick={() => void load()}>{busy ? 'Loading chat settings…' : 'Try again'}</Button> : <form onSubmit={save}>
      <div className="integration-grid">
        <div className="integration-card">
          <div className="integration-card-heading"><div><h3>Chat behaviour</h3><p>Keep the experience helpful and discreet.</p></div><span className="integration-badge">{settings.enabled ? 'Enabled' : 'Disabled'}</span></div>
          <label className="integration-check"><input type="checkbox" checked={settings.enabled} disabled={busy} onChange={event => change('enabled', event.target.checked)} /> Show chat on the customer website</label>
          <label className="integration-check"><input type="checkbox" checked={settings.automaticAnswers} disabled={busy} onChange={event => change('automaticAnswers', event.target.checked)} /> Answer common questions automatically</label>
          <p className="integration-readiness">The showroom assistant uses published vehicle details and dealership information. Questions that need a person are passed to your team.</p>
          <label className="integration-check"><input type="checkbox" checked={settings.notificationsEnabled} disabled={busy} onChange={event => change('notificationsEnabled', event.target.checked)} /> Show unread conversation notifications in the portal</label>
          <p className="integration-footnote">Staff set their availability in Chat. Opening hours come from your website settings. The chat opens only when a customer chooses it.</p>
        </div>
        <div className="integration-card">
          <div className="integration-card-heading"><div><h3>Your welcome</h3><p>Use the same tone as your showroom.</p></div></div>
          <div className="integration-field"><label htmlFor="chat-button-label">Chat button</label><Input id="chat-button-label" value={settings.buttonLabel} maxLength={30} required disabled={busy} onChange={event => change('buttonLabel', event.target.value)} /></div>
          <div className="integration-field"><label htmlFor="chat-greeting">Welcome message</label><Textarea id="chat-greeting" value={settings.greeting} maxLength={500} required disabled={busy} rows={3} onChange={event => change('greeting', event.target.value)} /></div>
          <div className="integration-field"><label htmlFor="chat-offline-message">When the team is unavailable</label><Textarea id="chat-offline-message" value={settings.offlineMessage} maxLength={500} required disabled={busy} rows={3} onChange={event => change('offlineMessage', event.target.value)} /><small>The next opening time is shown when your opening hours provide it.</small></div>
        </div>
      </div>
      <div className="integration-actions"><Button type="submit" disabled={busy || !changed}>{busy ? 'Saving…' : 'Save chat settings'}</Button><Button type="button" variant="outline" disabled={busy || !changed} onClick={() => { setSettings(saved); setError(''); setNotice(''); }}>Undo changes</Button></div>
    </form>}
  </section>;
}
