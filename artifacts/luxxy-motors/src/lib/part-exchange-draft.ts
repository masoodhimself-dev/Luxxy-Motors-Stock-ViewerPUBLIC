import type { PartExchangeDetails } from './part-exchange';

export type PartExchangeDraft = {
  details: PartExchangeDetails;
  vehicleId: string;
  delivery: 'website' | 'whatsapp';
};
const lifetime = 30 * 60_000;
const fields: Array<keyof PartExchangeDetails> = ['registration', 'makeModel', 'mileage', 'condition', 'conditionNotes', 'keys', 'v5', 'serviceHistory', 'name', 'phone', 'email'];
export const partExchangeDraftKey = (vehicleId?: string) => `luxxy.part-exchange-draft:${vehicleId || 'general'}`;

/** Short-lived, tab-local answers only. A restored draft always needs a fresh review. */
export function readPartExchangeDraft(key: string): PartExchangeDraft | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || 'null');
    const draft = saved?.data;
    if (!Number.isFinite(saved?.savedAt) || saved.savedAt > Date.now() || Date.now() - saved.savedAt > lifetime ||
      !draft || !draft.details || !fields.every(field => typeof draft.details[field] === 'string' && draft.details[field].length <= 2000) ||
      typeof draft.vehicleId !== 'string' || draft.vehicleId.length > 100 || !['website', 'whatsapp'].includes(draft.delivery)) {
      discardPartExchangeDraft(key);
      return null;
    }
    return draft;
  } catch { return null; }
}
export function savePartExchangeDraft(key: string, data: PartExchangeDraft) {
  try { sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data })); } catch { /* Storage may be unavailable in private browsing. */ }
}
export function discardPartExchangeDraft(key: string) {
  try { sessionStorage.removeItem(key); } catch { /* The form still works without storage. */ }
}
