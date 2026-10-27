import { customerTestSession, readCustomerStorage, writeCustomerStorage, removeCustomerStorage } from './customer-test-storage';
import { readTestCustomerSnapshots, writeTestCustomerSnapshots, removeTestCustomerSnapshots } from './test-customer-shortlist-storage';
import type { Car } from './stock-context';
import { getThumbnailUrl, vehicleDisplayTitle, vehicleRegistration } from './utils';
export type SavedSnapshot = { title: string; photo: string; price: number | null; currency: string; status: string; savedAt: string; registration?: string };
const key = 'luxxy.saved-car-snapshots.v1';
function effectiveSession(sessionId?:string|null) { return sessionId === undefined ? customerTestSession() : sessionId; }
export function readSavedSnapshots(sessionId?: string | null): Record<string, SavedSnapshot> {
  try {
    const session=effectiveSession(sessionId);
    const data = JSON.parse((session ? readTestCustomerSnapshots(session) ?? readCustomerStorage(localStorage,key,session) : readCustomerStorage(localStorage,key,null)) || '{}');
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    return Object.fromEntries(Object.entries(data).filter(([, item]) => {
      const value = item as SavedSnapshot;
      return value && typeof value.title === 'string' && typeof value.photo === 'string' && (value.price === null || typeof value.price === 'number' && Number.isFinite(value.price)) && typeof value.currency === 'string' && typeof value.status === 'string' && typeof value.savedAt === 'string' && (value.registration === undefined || typeof value.registration === 'string');
    })) as Record<string, SavedSnapshot>;
  } catch { return {}; }
}
export function rememberSavedCar(car: Car, sessionId?: string | null) {
  const registration = vehicleRegistration(car);
  try { const session=effectiveSession(sessionId); const value=JSON.stringify({ ...readSavedSnapshots(sessionId), [car.id]: { title: vehicleDisplayTitle(car), photo: getThumbnailUrl(car) || '', price: car.price ?? null, currency: car.currency || 'GBP', status: String(car.inventoryStatus || 'available'), savedAt: new Date().toISOString(), ...(registration ? { registration } : {}) } }); writeCustomerStorage(localStorage,key,value,session); if(session)writeTestCustomerSnapshots(session,value); } catch { /* Saving the shortlist still works when storage is unavailable. */ }
}
export function forgetSavedSnapshots(ids?: string[], sessionId?: string | null) {
  try {
    const session=effectiveSession(sessionId);
    if (!ids) { removeCustomerStorage(localStorage,key,session); if(session)removeTestCustomerSnapshots(session); return; }
    const data = readSavedSnapshots(sessionId); ids.forEach(id => delete data[id]); const value=JSON.stringify(data); writeCustomerStorage(localStorage,key,value,session); if(session)writeTestCustomerSnapshots(session,value);
  } catch {}
}
export function savedPriceReduction(snapshot: SavedSnapshot | undefined, car: Car) {
  return snapshot && snapshot.currency === (car.currency || 'GBP') && snapshot.price != null && typeof car.price === 'number' && car.price < snapshot.price ? snapshot.price - car.price : null;
}
