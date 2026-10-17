import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { Bell, BellRing, Check, ChevronDown, Smartphone, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  clearPushOwner, decodePushKey, defaultDeviceLabel, onPortalPush, portalPushRegistration,
  PORTAL_PUSH_SCOPE, PORTAL_PUSH_SCRIPT, pushAvailability, readPushOwner, savePushOwner,
  type DeviceSubscription, type PushPreferences, type StaffPushSettings,
} from '@/lib/portal-push';
import './device-notifications.css';

const preferenceFields = [
  ['enquiries', 'New enquiries'], ['bookings', 'Booking requests & changes'],
  ['reminders', 'Appointment reminders'], ['followups', 'Follow-ups due'],
  ['emailFailures', 'Email delivery problems'],
] as const;
const api = '/api/staff/push';
const json = (body: unknown) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });


/** Installation is offered only in the staff portal, never to public car shoppers. */
export function PortalInstallMetadata() {
  useEffect(() => {
    const tags = [
      Object.assign(document.createElement('link'), { rel: 'manifest', href: '/portal.webmanifest' }),
      Object.assign(document.createElement('link'), { rel: 'apple-touch-icon', href: '/portal-icons/apple-touch-icon.png' }),
      Object.assign(document.createElement('meta'), { name: 'apple-mobile-web-app-capable', content: 'yes' }),
      Object.assign(document.createElement('meta'), { name: 'apple-mobile-web-app-title', content: 'Workspace' }),
      Object.assign(document.createElement('meta'), { name: 'theme-color', content: '#203747' }),
    ];
    tags.forEach(tag => document.head.appendChild(tag));
    return () => tags.forEach(tag => tag.remove());
  }, []);
  return null;
}

export function DeviceNotifications({ canEmail }: { canEmail: boolean }) {
  const [open, setOpen] = useState(false);
  const [visited, setVisited] = useState(false);
  return <section className="device-alerts" aria-label="Device notifications">
    <button type="button" className="device-alerts-toggle" aria-expanded={open} aria-controls="device-alerts-settings" onClick={() => { setVisited(true); setOpen(value => !value); }}>
      <BellRing size={17} aria-hidden="true" /><span>Device alerts</span><ChevronDown size={15} className={open ? 'is-open' : ''} aria-hidden="true" />
    </button>
    {visited && <div id="device-alerts-settings" hidden={!open}><DeviceNotificationSettings canEmail={canEmail} visible={open} /></div>}
  </section>;
}

export function DeviceNotificationSettings({ canEmail, visible = true }: { canEmail: boolean; visible?: boolean }) {
  const client = useQueryClient();
  const [settings, setSettings] = useState<StaffPushSettings | null>(null);
  const [preferences, setPreferences] = useState<PushPreferences | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [devicePresent, setDevicePresent] = useState(false);
  const [ownershipConflict, setOwnershipConflict] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>(() => typeof Notification === 'undefined' ? 'default' : Notification.permission);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);
  const availability = pushAvailability();

  useEffect(() => {
    const updatePermission = () => setPermission(typeof Notification === 'undefined' ? 'default' : Notification.permission);
    if (visible) updatePermission();
    window.addEventListener('focus', updatePermission);
    return () => window.removeEventListener('focus', updatePermission);
  }, [visible]);

  useEffect(() => {
    mounted.current = true;
    let current = true;
    setLoadError(false);
    void customFetch<StaffPushSettings>(api).then(async data => {
      if (!current) return;
      setSettings(data); setPreferences(data.preferences);
      try {
        const registration = await portalPushRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        if (!current) return;
        const owner = readPushOwner();
        const owned = Boolean(subscription && owner?.actorScope === data.actorScope && data.subscriptions.some(item => item.id === owner.subscriptionId));
        setDevicePresent(Boolean(subscription));
        setDeviceId(owned ? owner!.subscriptionId : null);
        setOwnershipConflict(Boolean(subscription && !owned));
      } catch { /* Enable will report browser permission or registration failures. */ }
    }).catch(() => { if (current) setLoadError(true); });
    return () => { current = false; mounted.current = false; };
  }, [attempt]);

  useEffect(() => settings ? onPortalPush(settings.actorScope, () => {
    void client.invalidateQueries({ predicate: query => {
      const key = String(query.queryKey[0]);
      return key === 'staff-notifications' || key === 'staff-email' || key.includes('/enquiries') || key.includes('/test-drive-bookings');
    } });
  }) : undefined, [settings, client]);

  async function enable() {
    if (!settings?.configured || !settings.publicKey || availability.state !== 'available' || busy || ownershipConflict) return;
    setBusy(true); setError(''); setNotice('');
    let newlyCreated: PushSubscription | null = null;
    let createdId: string | null = null;
    try {
      // Permission is requested synchronously from this explicit button action, never on page load.
      const granted = await Notification.requestPermission();
      if (!mounted.current) return;
      setPermission(granted);
      if (granted !== 'granted') return;
      const registration = await navigator.serviceWorker.register(PORTAL_PUSH_SCRIPT, { scope: PORTAL_PUSH_SCOPE });
      const ready = registration.active ? registration : await navigator.serviceWorker.ready;
      if (!mounted.current) return;
      let subscription = await ready.pushManager.getSubscription();
      const owner = readPushOwner();
      if (subscription && (owner?.actorScope !== settings.actorScope || !settings.subscriptions.some(item => item.id === owner.subscriptionId))) {
        setOwnershipConflict(true); setDevicePresent(true);
        setError('Alerts on this browser belong to another setup. Disconnect this device below before enabling them for your account.');
        return;
      }
      if (!subscription) {
        subscription = await ready.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodePushKey(settings.publicKey) });
        newlyCreated = subscription;
      }
      if (!mounted.current) { await newlyCreated?.unsubscribe(); return; }
      const serialized = subscription.toJSON();
      const saved = await customFetch<DeviceSubscription>(`${api}/subscriptions`, { method: 'POST', ...json({ subscription: { endpoint: subscription.endpoint, keys: serialized.keys }, deviceLabel: defaultDeviceLabel() }) });
      createdId = saved.id;
      if (!mounted.current) { await subscription.unsubscribe(); return; }
      savePushOwner({ actorScope: settings.actorScope, subscriptionId: saved.id });
      setDeviceId(saved.id); setDevicePresent(true); setOwnershipConflict(false);
      setSettings(value => value && ({ ...value, subscriptions: [...value.subscriptions.filter(item => item.id !== saved.id), saved] }));
      setNotice('Alerts are on for this device. Send a test to check your device settings.');
    } catch {
      // A failed API save must not leave an untracked browser subscription behind.
      await newlyCreated?.unsubscribe().catch(() => {});
      if (createdId) await customFetch(`${api}/subscriptions/${encodeURIComponent(createdId)}`, { method: 'DELETE' }).catch(() => {});
      if (mounted.current) setError('Alerts could not be enabled. Check your connection and browser permissions, then try again.');
    } finally { if (mounted.current) setBusy(false); }
  }

  async function disconnect(id: string | null, local = false) {
    setBusy(true); setError(''); setNotice('');
    try {
      if (local) {
        const registration = await portalPushRegistration();
        const subscription = await registration?.pushManager.getSubscription();
        if (subscription && !await subscription.unsubscribe()) throw new Error('Unsubscribe failed');
        const notifications = await registration?.getNotifications();
        notifications?.forEach(notification => notification.close());
        clearPushOwner(); setDeviceId(null); setDevicePresent(false); setOwnershipConflict(false);
      }
      if (id) await customFetch(`${api}/subscriptions/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!mounted.current) return;
      setSettings(value => value && ({ ...value, subscriptions: value.subscriptions.filter(item => item.id !== id) }));
      setNotice(local ? 'Alerts are off for this device.' : 'Device disconnected.');
    } catch { if (mounted.current) setError(local ? 'Device alerts were disconnected where possible, but we could not finish updating your account. Try again.' : 'The device could not be disconnected. Try again.'); }
    finally { if (mounted.current) setBusy(false); }
  }

  async function savePreferences() {
    if (!preferences) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const next = { ...preferences, emailFailures: canEmail && preferences.emailFailures };
      await customFetch(`${api}/preferences`, { method: 'PUT', ...json(next) });
      if (mounted.current) { setSettings(value => value && ({ ...value, preferences: next })); setNotice('Alert preferences saved. They apply to all your devices for this dealership.'); }
    } catch { if (mounted.current) setError('Preferences could not be saved. Try again.'); }
    finally { if (mounted.current) setBusy(false); }
  }

  async function test() {
    if (!deviceId) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await customFetch(`${api}/test`, { method: 'POST', ...json({ subscriptionId: deviceId }) });
      if (mounted.current) setNotice('Test requested. Look for a device notification; your browser or Focus settings may silence it.');
    } catch { if (mounted.current) setError('The test could not be sent. Check your connection and try again.'); }
    finally { if (mounted.current) setBusy(false); }
  }

  return <div className="device-alerts-panel">
    <div className="device-alerts-intro"><Smartphone size={22} aria-hidden="true" /><div><h3>Alerts on your devices</h3><p>{availability.detail}</p><small>Only generic alerts appear on your lock screen. Customer details stay in the signed-in workspace.</small></div></div>
    {loadError ? <div className="device-alerts-warning" role="alert">Alert settings could not be loaded. <Button variant="outline" size="sm" onClick={() => setAttempt(value => value + 1)}>Try again</Button></div> : !settings ? <p role="status">Loading alert settings…</p> : <>
      {!settings.configured && <p className="device-alerts-warning" role="status">Device alerts are not configured for this website yet. Your workspace notifications continue to work.</p>}
      {availability.state === 'available' && permission === 'denied' && <p className="device-alerts-warning">Notifications are blocked for this website. Allow them in your browser or device notification settings, then reopen this panel.</p>}
      {ownershipConflict && <p className="device-alerts-warning">This browser has an alert subscription from another setup. Disconnect it before enabling alerts for this account.</p>}
      <div className="device-alerts-actions">
        {deviceId ? <><span className="device-alerts-enabled"><Check size={16} aria-hidden="true" />{permission === 'denied' ? 'Connected · notifications blocked' : 'Enabled on this device'}</span><Button variant="outline" disabled={busy || !settings.configured} onClick={() => void test()}><Bell size={16} aria-hidden="true" />Send test</Button></> : <Button disabled={busy || !settings.configured || availability.state !== 'available' || permission === 'denied' || ownershipConflict} onClick={() => void enable()}><BellRing size={16} aria-hidden="true" />{busy ? 'Please wait…' : 'Enable notifications'}</Button>}
        {devicePresent && <Button variant="ghost" disabled={busy} onClick={() => void disconnect(deviceId, true)}>Disconnect this device</Button>}
      </div>
      {preferences && <fieldset className="device-alerts-preferences" disabled={busy || !settings.configured}><legend>What should we alert you about?</legend><div className="device-alerts-checks">{preferenceFields.filter(([key]) => canEmail || key !== 'emailFailures').map(([key, label]) => <label key={key}><input type="checkbox" checked={preferences[key]} onChange={event => setPreferences({ ...preferences, [key]: event.target.checked })} /><span>{label}</span></label>)}</div><label className="device-alerts-reminder">Remind me before an appointment<select value={preferences.reminderMinutes} onChange={event => setPreferences({ ...preferences, reminderMinutes: Number(event.target.value) })}><option value="15">15 minutes</option><option value="30">30 minutes</option><option value="60">1 hour</option></select></label><Button variant="outline" onClick={() => void savePreferences()}>Save preferences</Button></fieldset>}
      {settings.subscriptions.filter(item => item.id !== deviceId).length > 0 && <details className="device-alerts-other"><summary>Other connected devices ({settings.subscriptions.filter(item => item.id !== deviceId).length})</summary><ul>{settings.subscriptions.filter(item => item.id !== deviceId).map(item => <li key={item.id}><span><Smartphone size={15} aria-hidden="true" />{item.deviceLabel}</span><Button size="sm" variant="ghost" disabled={busy} aria-label={`Disconnect ${item.deviceLabel}`} onClick={() => void disconnect(item.id)}><X size={15} aria-hidden="true" />Disconnect</Button></li>)}</ul></details>}
    </>}
    {notice && <p role="status" className="device-alerts-notice">{notice}</p>}
    {error && <p role="alert" className="device-alerts-warning">{error}</p>}
  </div>;
}
