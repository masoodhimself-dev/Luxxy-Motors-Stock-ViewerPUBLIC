import type { PartExchangeDetails } from './part-exchange';
import { normaliseExchangeRegistration, type PartExchangeAutofill } from './part-exchange-autofill';

export type PartExchangeDraft = {
  details: PartExchangeDetails;
  vehicleId: string | null;
  delivery: 'website' | 'whatsapp';
  autofill?: PartExchangeAutofill;
  message?: { text: string; source: string; edited: boolean };
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
      (draft.vehicleId !== null && (typeof draft.vehicleId !== 'string' || draft.vehicleId.length > 100)) ||
      !['website', 'whatsapp'].includes(draft.delivery)) {
      discardPartExchangeDraft(key);
      return null;
    }
    const candidate = draft.autofill;
    const autofill = candidate && typeof candidate === 'object' && !Array.isArray(candidate) &&
      candidate.registration === normaliseExchangeRegistration(draft.details.registration) &&
      ['makeModel', 'mileage'].every(field => candidate[field] === undefined || (typeof candidate[field] === 'string' && candidate[field].length <= 100 && candidate[field] === draft.details[field])) &&
      ['manualMakeModel', 'manualMileage'].every(field => candidate[field] === undefined || typeof candidate[field] === 'boolean')
      ? { registration: candidate.registration, makeModel: candidate.makeModel, mileage: candidate.mileage, manualMakeModel: candidate.manualMakeModel, manualMileage: candidate.manualMileage } : undefined;
    const message = draft.message && typeof draft.message === 'object' && typeof draft.message.text === 'string' && draft.message.text.length <= 2000 && typeof draft.message.source === 'string' && draft.message.source.length <= 8000 && typeof draft.message.edited === 'boolean'
      ? { text: draft.message.text, source: draft.message.source, edited: draft.message.edited } : undefined;
    // Do not restore a lookup/manual gate or dated MOT facts from storage.
    return { details: Object.fromEntries(fields.map(field => [field, draft.details[field]])) as PartExchangeDetails, vehicleId: draft.vehicleId, delivery: draft.delivery, ...(autofill ? { autofill } : {}), ...(message ? { message } : {}) };
  } catch { return null; }
}
export function savePartExchangeDraft(key: string, data: PartExchangeDraft) {
  try { sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data })); } catch { /* Storage may be unavailable in private browsing. */ }
}
export function discardPartExchangeDraft(key: string) {
  try { sessionStorage.removeItem(key); } catch { /* The form still works without storage. */ }
}
