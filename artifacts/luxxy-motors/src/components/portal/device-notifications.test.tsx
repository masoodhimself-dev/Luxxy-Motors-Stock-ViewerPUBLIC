import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { DeviceNotificationSettings, DeviceNotifications, PortalInstallMetadata } from './device-notifications';
import { PORTAL_PUSH_OWNER_KEY, type StaffPushSettings } from '@/lib/portal-push';
vi.mock('@workspace/api-client-react', () => ({ customFetch: vi.fn() }));
const fetchMock = vi.mocked(customFetch);
const requestPermission = vi.fn();
const subscription = { endpoint: 'https://push.example/private-endpoint', toJSON: () => ({ endpoint: 'https://push.example/private-endpoint', expirationTime: null, keys: { p256dh: 'private-key', auth: 'private-auth' } }), unsubscribe: vi.fn() };
const register = vi.fn();
const getSubscription = vi.fn();
const close = vi.fn();
const registration = { active: { scriptURL: 'http://localhost:3000/portal-push-worker.js' }, pushManager: { getSubscription, subscribe: vi.fn() }, getNotifications: vi.fn() };
const settings: StaffPushSettings = { configured: true, publicKey: 'AQIDBA', actorScope: 'dealer:staff', subscriptions: [], preferences: { enquiries: true, bookings: true, reminders: true, followups: true, emailFailures: true, reminderMinutes: 30 } };
const saved = { id: 'sub-1', deviceLabel: 'Desktop browser', createdAt: '2026-10-17T09:00:00Z', lastSuccessAt: null };
function mount(canEmail = true) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DeviceNotificationSettings canEmail={canEmail} /></QueryClientProvider>);
}
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('Notification', { permission: 'default', requestPermission });
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Desktop Chrome' });
  Object.defineProperty(navigator, 'platform', { configurable: true, value: 'Linux' });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register, getRegistration: vi.fn().mockResolvedValue(registration), ready: Promise.resolve(registration), addEventListener: vi.fn(), removeEventListener: vi.fn() } });
  registration.active.scriptURL = new URL('/portal-push-worker.js', window.location.origin).href;
  getSubscription.mockResolvedValue(null);
  registration.pushManager.subscribe.mockResolvedValue(subscription);
  registration.getNotifications.mockResolvedValue([{ close }]);
  subscription.unsubscribe.mockResolvedValue(true);
  register.mockResolvedValue(registration);
  requestPermission.mockResolvedValue('granted');
  fetchMock.mockImplementation(async (url, options) => options?.method === 'POST' && String(url).endsWith('/subscriptions') ? saved : structuredClone(settings));
});
afterEach(() => vi.unstubAllGlobals());

describe('staff device notification controls', () => {
  it('keeps the compact entry idle without asking permission, registering a worker or fetching settings', () => {
    render(<DeviceNotifications canEmail />);
    expect(screen.getByRole('button', { name: 'Device alerts' })).toHaveAttribute('aria-expanded', 'false');
    expect(fetchMock).not.toHaveBeenCalled(); expect(requestPermission).not.toHaveBeenCalled(); expect(register).not.toHaveBeenCalled();
  });
  it('does not request permission when loading settings; enabling explicitly binds this device', async () => {
    mount();
    const enable = await screen.findByRole('button', { name: 'Enable notifications' });
    expect(requestPermission).not.toHaveBeenCalled();
    fireEvent.click(enable);
    expect(requestPermission).toHaveBeenCalledOnce();
    await screen.findByText('Enabled on this device');
    expect(register).toHaveBeenCalledWith('/portal-push-worker.js', { scope: '/portal' });
    expect(fetchMock).toHaveBeenCalledWith('/api/staff/push/subscriptions', expect.objectContaining({ method: 'POST', body: JSON.stringify({ subscription: { endpoint: subscription.endpoint, keys: subscription.toJSON().keys }, deviceLabel: 'Desktop browser' }) }));
    const stored = localStorage.getItem(PORTAL_PUSH_OWNER_KEY)!;
    expect(JSON.parse(stored)).toEqual({ actorScope: 'dealer:staff', subscriptionId: 'sub-1' });
    expect(stored).not.toContain('endpoint'); expect(stored).not.toContain('private-auth');
  });
  it('gives Home Screen instructions on iPhone and does not attempt permission', async () => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'iPhone OS 18_0' });
    mount();
    expect(await screen.findByRole('button', { name: 'Enable notifications' })).toBeDisabled();
    expect(screen.getByText(/Add to Home Screen/)).toBeVisible(); expect(requestPermission).not.toHaveBeenCalled();
  });
  it('allows an installed iPad app to enable notifications', async () => {
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'MacIntel' });
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 });
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Enable notifications' }));
    await screen.findByText('Enabled on this device'); expect(requestPermission).toHaveBeenCalledOnce();
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 0 });
  });
  it('supports Android browser setup with its own device label', async () => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Android Chrome' });
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Enable notifications' }));
    await screen.findByText('Enabled on this device');
    expect(fetchMock).toHaveBeenCalledWith('/api/staff/push/subscriptions', expect.objectContaining({ body: JSON.stringify({ subscription: { endpoint: subscription.endpoint, keys: subscription.toJSON().keys }, deviceLabel: 'Android' }) }));
  });
  it('explains browsers without push support', async () => {
    vi.stubGlobal('PushManager', undefined); delete (window as any).PushManager;
    mount(); expect(await screen.findByRole('button', { name: 'Enable notifications' })).toBeDisabled();
    expect(screen.getByText(/This browser does not support/)).toBeVisible();
  });
  it('updates the permission status when the person returns from browser settings', async () => {
    const browserPermission = { permission: 'denied', requestPermission };
    vi.stubGlobal('Notification', browserPermission); mount();
    const enable = await screen.findByRole('button', { name: 'Enable notifications' }); expect(enable).toBeDisabled();
    browserPermission.permission = 'granted'; fireEvent.focus(window);
    await waitFor(() => expect(enable).toBeEnabled()); expect(requestPermission).not.toHaveBeenCalled();
  });
  it('explains blocked permission without repeatedly prompting', async () => {
    vi.stubGlobal('Notification', { permission: 'denied', requestPermission });
    mount(); expect(await screen.findByRole('button', { name: 'Enable notifications' })).toBeDisabled();
    expect(screen.getByText(/Notifications are blocked/)).toBeVisible(); expect(requestPermission).not.toHaveBeenCalled();
  });
  it('stops cleanly when the person refuses the permission prompt', async () => {
    requestPermission.mockResolvedValue('denied'); mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Enable notifications' }));
    await screen.findByText(/Notifications are blocked/); expect(register).not.toHaveBeenCalled();
  });
  it('explains HTTPS and refuses setup from an insecure device URL', async () => {
    vi.stubGlobal('isSecureContext', false); mount();
    expect(await screen.findByRole('button', { name: 'Enable notifications' })).toBeDisabled(); expect(screen.getByText(/Device alerts need HTTPS/)).toBeVisible();
  });
  it('makes an unconfigured server clear without pretending notifications are enabled', async () => {
    fetchMock.mockResolvedValue({ ...settings, configured: false, publicKey: null }); mount();
    expect(await screen.findByRole('button', { name: 'Enable notifications' })).toBeDisabled();
    expect(screen.getByText(/not configured for this website/)).toBeVisible(); expect(requestPermission).not.toHaveBeenCalled();
  });
  it('removes a new browser subscription if saving it on the server fails', async () => {
    fetchMock.mockImplementation(async (_url, options) => { if (options?.method === 'POST') throw Error('private server data'); return structuredClone(settings); });
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Enable notifications' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Alerts could not be enabled');
    expect(subscription.unsubscribe).toHaveBeenCalledOnce(); expect(localStorage.getItem(PORTAL_PUSH_OWNER_KEY)).toBeNull();
    expect(screen.queryByText(/private server data/)).not.toBeInTheDocument();
  });
  it('does not silently reassign a browser subscription from another staff account', async () => {
    localStorage.setItem(PORTAL_PUSH_OWNER_KEY, JSON.stringify({ actorScope: 'other:staff', subscriptionId: 'sub-other' }));
    getSubscription.mockResolvedValue(subscription); mount();
    await screen.findByText(/another setup/);
    expect(screen.getByRole('button', { name: 'Enable notifications' })).toBeDisabled();
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect this device' }));
    await screen.findByText('Alerts are off for this device.'); expect(subscription.unsubscribe).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
  });
  it('targets a test at this device only and does not claim it was delivered', async () => {
    localStorage.setItem(PORTAL_PUSH_OWNER_KEY, JSON.stringify({ actorScope: settings.actorScope, subscriptionId: saved.id }));
    getSubscription.mockResolvedValue(subscription);
    fetchMock.mockResolvedValue({ ...settings, subscriptions: [saved, { ...saved, id: 'sub-other', deviceLabel: 'iPad' }] });
    mount(); fireEvent.click(await screen.findByRole('button', { name: 'Send test' }));
    await screen.findByText(/Test requested/);
    expect(fetchMock).toHaveBeenCalledWith('/api/staff/push/test', expect.objectContaining({ body: JSON.stringify({ subscriptionId: saved.id }) }));
  });
  it('saves explicit preferences and hides email alerts from staff without email access', async () => {
    mount(false); await screen.findByRole('button', { name: 'Enable notifications' });
    expect(screen.queryByRole('checkbox', { name: 'Email delivery problems' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'New enquiries' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Remind me before an appointment' }), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }));
    await screen.findByText(/Alert preferences saved/);
    expect(fetchMock).toHaveBeenCalledWith('/api/staff/push/preferences', expect.objectContaining({ body: JSON.stringify({ ...settings.preferences, enquiries: false, emailFailures: false, reminderMinutes: 15 }) }));
  });
  it('allows a failed settings load to be retried', async () => {
    fetchMock.mockRejectedValueOnce(Error('network')); mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Enable notifications' })).toBeEnabled();
  });
  it('only exposes app installation metadata while the staff portal is mounted', () => {
    expect(document.head.querySelector('link[rel=manifest]')).toBeNull();
    const { unmount } = render(<PortalInstallMetadata />);
    expect(document.head.querySelector('link[rel=manifest]')).toHaveAttribute('href', '/portal.webmanifest');
    unmount(); expect(document.head.querySelector('link[rel=manifest]')).toBeNull();
  });
});
