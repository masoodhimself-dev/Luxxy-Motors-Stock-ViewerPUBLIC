/* Staff alerts only. Deliberately no fetch handler, private API cache or offline mode. */
'use strict';
const FALLBACK_URL = '/portal?section=notifications';
const MESSAGES = {
  enquiries: ['New enquiry', 'A customer enquiry is waiting in your workspace.'],
  bookings: ['Test-drive update', 'A test-drive booking needs your attention.'],
  reminders: ['Appointment reminder', 'You have an appointment coming up. Open your diary for details.'],
  followups: ['Follow-up due', 'A customer follow-up is due in your workspace.'],
  emailFailures: ['Email needs attention', 'An email could not be delivered. Open your workspace to review it.'],
  test: ['Test notification', 'Device alerts are working. You can return to your dealership workspace.'],
};
function safePortalUrl(value) {
  try {
    const url = new URL(typeof value === 'string' ? value : FALLBACK_URL, self.location.origin);
    if (url.origin === self.location.origin && (url.pathname === '/portal' || url.pathname.startsWith('/portal/'))) return url.href;
  } catch { /* Fall back to the authenticated workspace. */ }
  return new URL(FALLBACK_URL, self.location.origin).href;
}
self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let data = {};
    try { const parsed = event.data?.json(); data = parsed && typeof parsed === 'object' ? parsed : {}; } catch { /* An invalid message never exposes raw payload data. */ }
    const eventId = typeof data.eventId === 'string' ? data.eventId.slice(0, 160) : 'workspace-update';
    // Only local, allowlisted copy. Never display arbitrary payload text or customer details.
    const copy = typeof data.category === 'string' && Object.prototype.hasOwnProperty.call(MESSAGES, data.category)
      ? MESSAGES[data.category]
      : ['Dealership update', 'Something needs your attention. Open your dealership workspace for details.'];
    await self.registration.showNotification(copy[0], {
      body: copy[1],
      icon: '/portal-icons/workspace-192.png',
      badge: '/portal-icons/badge-96.png',
      tag: `dealer-workspace:${eventId}`,
      renotify: false,
      data: { url: safePortalUrl(data.url) },
    });
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      const url = new URL(client.url);
      if (url.origin === self.location.origin && (url.pathname === '/portal' || url.pathname.startsWith('/portal/'))) client.postMessage({ type: 'portal-push', eventId });
    }
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const url = safePortalUrl(event.notification.data?.url);
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      const current = new URL(client.url);
      if (current.origin === self.location.origin && (current.pathname === '/portal' || current.pathname.startsWith('/portal/'))) {
        await client.navigate(url);
        await client.focus();
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
