import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { clearPortalPushSubscription, decodePushKey, onPortalPush, portalPushRegistration, PORTAL_PUSH_OWNER_KEY, readPushOwner, savePushOwner } from './portal-push';
const unsubscribe = vi.fn(), close = vi.fn(), getRegistration = vi.fn(), addEventListener = vi.fn(), removeEventListener = vi.fn();
const registration = { active: { scriptURL: '' }, pushManager: { getSubscription: vi.fn() }, getNotifications: vi.fn() };
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  registration.active.scriptURL = new URL('/portal-push-worker.js', location.origin).href;
  registration.pushManager.getSubscription.mockResolvedValue({ unsubscribe }); registration.getNotifications.mockResolvedValue([{ close }]);
  getRegistration.mockResolvedValue(registration); unsubscribe.mockResolvedValue(true);
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration, addEventListener, removeEventListener } });
});
afterEach(() => vi.unstubAllGlobals());
describe('device alert ownership and account lifecycle', () => {
  it('saves only account binding metadata and handles invalid stored data safely', () => {
    savePushOwner({ actorScope: 'dealer:staff', subscriptionId: 'sub' }); expect(readPushOwner()).toEqual({ actorScope: 'dealer:staff', subscriptionId: 'sub' });
    for (const value of ['null', '{', '{"actorScope":1,"subscriptionId":"sub"}']) { localStorage.setItem(PORTAL_PUSH_OWNER_KEY, value); expect(readPushOwner()).toBeNull(); }
  });
  it('unsubscribes and removes visible notifications on sign-out or account changes', async () => {
    savePushOwner({ actorScope: 'dealer:staff', subscriptionId: 'sub' }); await clearPortalPushSubscription();
    expect(unsubscribe).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce(); expect(readPushOwner()).toBeNull();
  });
  it('does not operate on an unrelated service worker', async () => {
    registration.active.scriptURL = new URL('/unrelated-worker.js', location.origin).href;
    expect(await portalPushRegistration()).toBeUndefined(); await clearPortalPushSubscription(); expect(unsubscribe).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
  });
  it('clears local ownership without logging private diagnostics if the browser fails cleanup', async () => {
    savePushOwner({ actorScope: 'dealer:staff', subscriptionId: 'sub' }); getRegistration.mockRejectedValue(Error('private endpoint'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {}); await clearPortalPushSubscription();
    expect(readPushOwner()).toBeNull(); expect(error).not.toHaveBeenCalled(); error.mockRestore();
  });
  it('refreshes only from the known service worker and the currently bound account', () => {
    const refresh = vi.fn(), stop = onPortalPush('dealer:staff', refresh), receive = addEventListener.mock.calls[0][1];
    const source = { scriptURL: registration.active.scriptURL };
    savePushOwner({ actorScope: 'other:staff', subscriptionId: 'sub' }); receive({ source, data: { type: 'portal-push' } }); expect(refresh).not.toHaveBeenCalled();
    savePushOwner({ actorScope: 'dealer:staff', subscriptionId: 'sub' });
    receive({ source: { scriptURL: 'https://evil.example/portal-push-worker.js' }, data: { type: 'portal-push' } }); receive({ source, data: { type: 'wrong-message' } }); expect(refresh).not.toHaveBeenCalled();
    receive({ source, data: { type: 'portal-push' } }); expect(refresh).toHaveBeenCalledOnce(); stop(); expect(removeEventListener).toHaveBeenCalledWith('message', receive);
  });
  it('decodes URL-safe VAPID key bytes', () => expect(Array.from(decodePushKey('AQIDBA'))).toEqual([1, 2, 3, 4]));
});
