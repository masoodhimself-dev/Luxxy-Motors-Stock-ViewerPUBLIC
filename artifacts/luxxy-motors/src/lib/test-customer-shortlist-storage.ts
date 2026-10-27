export type TestWatch = { email: string; confirmed: boolean };
export type TestShortlistState = { sessionId: string; savedIds: string[]; watches: Record<string, TestWatch> };
const prefix = 'luxxy.test-customer-shortlist.v1:';
const snapshotsPrefix = 'luxxy.test-customer-snapshots.v1:';
const states = new Map<string,TestShortlistState>();
const listeners = new Map<string,Set<()=>void>>();
export const emptyTestCustomerShortlist = (sessionId: string): TestShortlistState => ({ sessionId, savedIds: [], watches: {} });

/** These entries are per-tab, per-test-session and never use the live shortlist keys. */
export function readTestCustomerShortlist(sessionId: string): TestShortlistState {
  const cached=states.get(sessionId);
  if(cached)return cached;
  let state:TestShortlistState = emptyTestCustomerShortlist(sessionId);
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(prefix + sessionId) || 'null');
    if(value && typeof value === 'object') {
      const parsed = value as Partial<TestShortlistState>;
      if(parsed.sessionId === sessionId && Array.isArray(parsed.savedIds) && parsed.watches && typeof parsed.watches === 'object') {
        const savedIds = [...new Set(parsed.savedIds.filter(id => typeof id === 'string' && id.length > 0 && id.length <= 128))];
        const watches = Object.fromEntries(Object.entries(parsed.watches).filter(([id, watch]) => id.length > 0 && id.length <= 128 && watch && typeof watch.email === 'string' && watch.email.length <= 320 && typeof watch.confirmed === 'boolean'));
        state={sessionId,savedIds,watches};
      }
    }
  } catch { /* Use the empty in-memory state. */ }
  states.set(sessionId,state);
  return state;
}

export function writeTestCustomerShortlist(value: TestShortlistState): void {
  if(states.get(value.sessionId)===value)return;
  states.set(value.sessionId,value);
  try { window.sessionStorage.setItem(prefix + value.sessionId, JSON.stringify(value)); } catch { /* Practice still works in memory if storage is unavailable. */ }
  listeners.get(value.sessionId)?.forEach(notify=>notify());
}

export function subscribeTestCustomerShortlist(sessionId:string, notify:()=>void):()=>void {
  let set=listeners.get(sessionId);if(!set){set=new Set();listeners.set(sessionId,set);}set.add(notify);
  return ()=>{set!.delete(notify);if(!set!.size)listeners.delete(sessionId);};
}

export function clearTestCustomerShortlist(sessionId: string): void {
  try { window.sessionStorage.removeItem(prefix + sessionId); window.sessionStorage.removeItem(snapshotsPrefix + sessionId); } catch { /* Browser storage can be unavailable. */ }
  states.delete(sessionId);
  listeners.get(sessionId)?.forEach(notify=>notify());
}

export function readTestCustomerSnapshots(sessionId:string): string | null {
  try { return window.sessionStorage.getItem(snapshotsPrefix + sessionId); } catch { return null; }
}
export function writeTestCustomerSnapshots(sessionId:string, value:string): void {
  try { window.sessionStorage.setItem(snapshotsPrefix + sessionId,value); } catch { /* In-memory snapshots remain available if storage is unavailable. */ }
}
export function removeTestCustomerSnapshots(sessionId:string): void {
  try { window.sessionStorage.removeItem(snapshotsPrefix + sessionId); } catch { /* Browser storage can be unavailable. */ }
}
