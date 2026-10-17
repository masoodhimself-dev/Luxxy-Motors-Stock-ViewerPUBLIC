import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const source = readFileSync(`${process.cwd()}/public/portal-push-worker.js`, 'utf8');
let handlers: Record<string, (event: any) => void>;
let showNotification: ReturnType<typeof vi.fn>, matchAll: ReturnType<typeof vi.fn>, openWindow: ReturnType<typeof vi.fn>;
async function push(data: unknown) {
  let work: Promise<unknown> | undefined;
  handlers.push({ data: { json: () => data }, waitUntil: (promise: Promise<unknown>) => { work = promise; } }); await work;
}
async function click(url: unknown) {
  let work: Promise<unknown> | undefined; const close = vi.fn();
  handlers.notificationclick({ notification: { close, data: { url } }, waitUntil: (promise: Promise<unknown>) => { work = promise; } }); await work; expect(close).toHaveBeenCalledOnce();
}
beforeEach(() => {
  handlers = {}; showNotification = vi.fn().mockResolvedValue(undefined); matchAll = vi.fn().mockResolvedValue([]); openWindow = vi.fn().mockResolvedValue(null);
  vm.runInNewContext(source, { URL, self: { location: { origin: 'https://dealer.example' }, registration: { showNotification }, clients: { matchAll, openWindow }, addEventListener: (event: string, handler: (event: unknown) => void) => { handlers[event] = handler; } } });
});
describe('staff push service worker', () => {
  it('keeps lock-screen notifications generic and tags repeated events consistently', async () => {
    const message = { eventId: 'event-1', title: 'Private customer name', body: 'Private registration', url: '/portal?section=notifications&workView=customers&enquiryId=1' };
    await push(message); await push(message); const [title, options] = showNotification.mock.calls[0];
    expect(title).toBe('Dealership update'); expect(options.body).not.toMatch(/Private/); expect(options.tag).toBe(showNotification.mock.calls[1][1].tag); expect(options.renotify).toBe(false);
    expect(options.data.url).toBe('https://dealer.example/portal?section=notifications&workView=customers&enquiryId=1');
  });
  it.each([
    ['enquiries', 'New enquiry'], ['bookings', 'Test-drive update'], ['reminders', 'Appointment reminder'],
    ['followups', 'Follow-up due'], ['emailFailures', 'Email needs attention'], ['test', 'Test notification'],
    ['unknown', 'Dealership update'], ['__proto__', 'Dealership update'],
  ])('shows useful generic copy for %s without displaying payload text', async (category, title) => {
    await push({ category, title: 'Private person', body: 'Private car details' });
    expect(showNotification.mock.calls[0][0]).toBe(title); expect(showNotification.mock.calls[0][1].body).not.toMatch(/Private/);
  });
  it.each(['https://evil.example/portal', '//evil.example/portal', 'javascript:alert(1)', '/platform', '/portal-other', '/portal/../../platform'])('refuses a notification redirect to %s', async url => {
    await click(url); expect(openWindow).toHaveBeenCalledWith('https://dealer.example/portal?section=notifications');
  });
  it('focuses an existing portal window without navigating a customer showroom tab', async () => {
    const customer = { url: 'https://dealer.example/stock', navigate: vi.fn(), focus: vi.fn() };
    const portal = { url: 'https://dealer.example/portal?section=sales', navigate: vi.fn().mockResolvedValue(undefined), focus: vi.fn().mockResolvedValue(undefined) };
    matchAll.mockResolvedValue([customer, portal]); await click('/portal?section=notifications&workView=test-drives');
    expect(customer.navigate).not.toHaveBeenCalled(); expect(portal.navigate).toHaveBeenCalledWith('https://dealer.example/portal?section=notifications&workView=test-drives'); expect(portal.focus).toHaveBeenCalledOnce(); expect(openWindow).not.toHaveBeenCalled();
  });
  it('posts only a generic refresh signal to same-origin portal windows', async () => {
    const portal = { url: 'https://dealer.example/portal', postMessage: vi.fn() }, customer = { url: 'https://dealer.example/stock', postMessage: vi.fn() }, other = { url: 'https://other.example/portal', postMessage: vi.fn() };
    matchAll.mockResolvedValue([portal, customer, other]); await push({ eventId: '1', body: 'Private data' });
    expect(portal.postMessage).toHaveBeenCalledWith({ type: 'portal-push', eventId: '1' }); expect(customer.postMessage).not.toHaveBeenCalled(); expect(other.postMessage).not.toHaveBeenCalled();
  });
  it.each([null, 'text', 123, {}])('handles malformed message data safely: %s', async data => { await push(data); expect(showNotification).toHaveBeenCalledOnce(); });
  it('does not intercept requests or cache private application data', () => expect(Object.keys(handlers).sort()).toEqual(['notificationclick', 'push']));
});
