/**
 * Customer-site practice views must not read or alter the browser's real
 * shortlist, recently viewed cars or browsing preferences. Keep those values
 * in memory per test session instead. The guard's document marker is set only
 * while the staff test workspace is active.
 */
const isolated = new Map<string, Map<string, string>>();

export function customerTestSession(): string | null {
  return typeof document === 'undefined' ? null : document.documentElement.dataset.testModeSession || null;
}

export function readCustomerStorage(storage: Storage, key: string, sessionOverride?: string | null): string | null {
  const session = sessionOverride === undefined ? customerTestSession() : sessionOverride;
  return session ? isolated.get(session)?.get(key) ?? null : storage.getItem(key);
}

export function writeCustomerStorage(storage: Storage, key: string, value: string, sessionOverride?: string | null): void {
  const session = sessionOverride === undefined ? customerTestSession() : sessionOverride;
  if (!session) { storage.setItem(key, value); return; }
  let values = isolated.get(session);
  if (!values) { values = new Map(); isolated.set(session, values); }
  values.set(key, value);
}

export function removeCustomerStorage(storage: Storage, key: string, sessionOverride?: string | null): void {
  const session = sessionOverride === undefined ? customerTestSession() : sessionOverride;
  if (session) isolated.get(session)?.delete(key);
  else storage.removeItem(key);
}

/** Remove ephemeral values when a test workspace ends. */
export function clearCustomerTestStorage(session: string): void {
  isolated.delete(session);
}
