export type VehicleExchangeDraft = { registration: string; mileage: string; notes: string };
const key = (id: string) => `luxxy.vehicle-exchange.${id}`;
export function readVehicleExchange(id?: string): VehicleExchangeDraft | null {
  if (!id) return null;
  try {
    const value = JSON.parse(sessionStorage.getItem(key(id)) || 'null');
    if (value && (!Number.isFinite(value.savedAt) || Date.now() - value.savedAt > 30 * 60_000)) { sessionStorage.removeItem(key(id)); return null; }
    if (!value || typeof value.registration !== 'string' || !/^[A-Z0-9 ]{2,10}$/.test(value.registration) || (!/^\d{1,7}$/.test(value.mileage) || Number(value.mileage) > 1000000)) return null;
    return { registration: value.registration, mileage: value.mileage, notes: '' };
  } catch { return null; }
}
export function saveVehicleExchange(id: string, draft: VehicleExchangeDraft) {
  try { sessionStorage.setItem(key(id), JSON.stringify({ ...draft, savedAt: Date.now() })); return true; }
  catch { return false; }
}
