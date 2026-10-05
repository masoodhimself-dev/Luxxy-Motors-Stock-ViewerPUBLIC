import type { Car } from './stock-context';
import { getThumbnailUrl, vehicleDisplayTitle, vehicleRegistration } from './utils';
export type SavedSnapshot = { title: string; photo: string; price: number | null; currency: string; status: string; savedAt: string; registration?: string };
const key = 'luxxy.saved-car-snapshots.v1';
export function readSavedSnapshots(): Record<string, SavedSnapshot> {
  try {
    const data = JSON.parse(localStorage.getItem(key) || '{}');
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
    return Object.fromEntries(Object.entries(data).filter(([, item]) => {
      const value = item as SavedSnapshot;
      return value && typeof value.title === 'string' && typeof value.photo === 'string' && (value.price === null || typeof value.price === 'number' && Number.isFinite(value.price)) && typeof value.currency === 'string' && typeof value.status === 'string' && typeof value.savedAt === 'string' && (value.registration === undefined || typeof value.registration === 'string');
    })) as Record<string, SavedSnapshot>;
  } catch { return {}; }
}
export function rememberSavedCar(car: Car) {
  const registration = vehicleRegistration(car);
  try { localStorage.setItem(key, JSON.stringify({ ...readSavedSnapshots(), [car.id]: { title: vehicleDisplayTitle(car), photo: getThumbnailUrl(car) || '', price: car.price ?? null, currency: car.currency || 'GBP', status: String(car.inventoryStatus || 'available'), savedAt: new Date().toISOString(), ...(registration ? { registration } : {}) } })); } catch { /* Saving the shortlist still works when storage is unavailable. */ }
}
export function forgetSavedSnapshots(ids?: string[]) {
  try {
    if (!ids) { localStorage.removeItem(key); return; }
    const data = readSavedSnapshots(); ids.forEach(id => delete data[id]); localStorage.setItem(key, JSON.stringify(data));
  } catch {}
}
export function savedPriceReduction(snapshot: SavedSnapshot | undefined, car: Car) {
  return snapshot && snapshot.currency === (car.currency || 'GBP') && snapshot.price != null && typeof car.price === 'number' && car.price < snapshot.price ? snapshot.price - car.price : null;
}
