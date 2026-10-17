/** Staff device alerts. Subscription keys never enter application logs or browser storage. */
export const PORTAL_PUSH_SCRIPT = '/portal-push-worker.js';
export const PORTAL_PUSH_SCOPE = '/portal';
export const PORTAL_PUSH_OWNER_KEY = 'dealer-workspace:push-owner:v1';

export type PushPreferences = {
  enquiries: boolean;
  bookings: boolean;
  reminders: boolean;
  followups: boolean;
  emailFailures: boolean;
  reminderMinutes: number;
};
export type DeviceSubscription = { id: string; deviceLabel: string; createdAt: string; lastSuccessAt: string | null };
export type StaffPushSettings = {
  configured: boolean;
  publicKey: string | null;
  actorScope: string;
  subscriptions: DeviceSubscription[];
  preferences: PushPreferences;
};
export type PushOwner = { actorScope: string; subscriptionId: string };
export type PushAvailability = { state: 'available' | 'ios-install' | 'insecure' | 'unsupported'; detail: string };

export function pushAvailability(): PushAvailability {
  if (!window.isSecureContext) return { state: 'insecure', detail: 'Device alerts need HTTPS. Open your secure dealership website to set them up.' };
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const installed = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (ios && !installed) return { state: 'ios-install', detail: 'On iPhone or iPad, open this portal in Safari, tap Share → Add to Home Screen, then open that app and enable alerts. Requires iOS or iPadOS 16.4 or later.' };
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return { state: 'unsupported', detail: 'This browser does not support device alerts. Try an up-to-date Safari, Chrome, Edge or Firefox. Your workspace notifications still work here.' };
  return { state: 'available', detail: 'Get staff alerts on this device, even when the workspace is not open. Your device settings control delivery.' };
}

export function readPushOwner(): PushOwner | null {
  try {
    const owner: unknown = JSON.parse(localStorage.getItem(PORTAL_PUSH_OWNER_KEY) ?? 'null');
    if (owner && typeof owner === 'object' && 'actorScope' in owner && 'subscriptionId' in owner && typeof owner.actorScope === 'string' && typeof owner.subscriptionId === 'string') return owner as PushOwner;
  } catch { /* Storage may be disabled. Never infer ownership. */ }
  return null;
}
export function savePushOwner(owner: PushOwner): void {
  localStorage.setItem(PORTAL_PUSH_OWNER_KEY, JSON.stringify(owner));
}
export function clearPushOwner(): void {
  try { localStorage.removeItem(PORTAL_PUSH_OWNER_KEY); } catch { /* The subscription still gets removed. */ }
}
export function decodePushKey(value: string): Uint8Array<ArrayBuffer> {
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}
export async function portalPushRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  if (!('serviceWorker' in navigator)) return undefined;
  const registration = await navigator.serviceWorker.getRegistration(new URL(PORTAL_PUSH_SCOPE, window.location.origin).href);
  const script = registration?.active?.scriptURL ?? registration?.waiting?.scriptURL ?? registration?.installing?.scriptURL;
  return script === new URL(PORTAL_PUSH_SCRIPT, window.location.origin).href ? registration : undefined;
}
/** Called on sign-out/account changes. Unsubscribing makes the old endpoint unusable. */
export async function clearPortalPushSubscription(): Promise<void> {
  clearPushOwner();
  try {
    const registration = await portalPushRegistration();
    if (!registration) return;
    await Promise.all([
      registration.pushManager.getSubscription().then(subscription => subscription?.unsubscribe()),
      registration.getNotifications().then(notifications => notifications.forEach(notification => notification.close())),
    ]);
  } catch { /* No sensitive diagnostic output. The backend independently checks active staff access. */ }
}

/** Message payloads contain no customer details. Only the currently bound account may refresh. */
export function onPortalPush(actorScope: string, refresh: () => void): () => void {
  if (!('serviceWorker' in navigator)) return () => {};
  const receive = (event: MessageEvent) => {
    const worker = event.source as ServiceWorker | null;
    if (worker?.scriptURL !== new URL(PORTAL_PUSH_SCRIPT, window.location.origin).href || event.data?.type !== 'portal-push') return;
    if (readPushOwner()?.actorScope !== actorScope) return;
    refresh();
  };
  navigator.serviceWorker.addEventListener('message', receive);
  return () => navigator.serviceWorker.removeEventListener('message', receive);
}

export function defaultDeviceLabel(): string {
  const agent = navigator.userAgent;
  if (/iPad/.test(agent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/iPhone|iPod/.test(agent)) return 'iPhone';
  if (/Android/.test(agent)) return 'Android';
  return 'Desktop browser';
}
