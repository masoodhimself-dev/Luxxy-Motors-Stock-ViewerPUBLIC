import { isUKNumberPlate } from '@workspace/vehicle-meta';
import { normaliseExchangeRegistration, updatePartExchangeAnswer } from './part-exchange-autofill';
import { partExchangeDraftKey, readPartExchangeDraft, savePartExchangeDraft } from './part-exchange-draft';
import type { PartExchangeDetails } from './part-exchange';

/** Carry an explicitly entered plate into the existing short-lived tab draft.
 * This does not look up, submit, or verify a car. The enquiry still starts with
 * Find my car and its normal review/send controls. */
export function prepareHomepagePartExchange(value: string): boolean {
  const registration = normaliseExchangeRegistration(value);
  if (registration.length > 20 || !isUKNumberPlate(registration)) return false;
  const key = partExchangeDraftKey(), previous = readPartExchangeDraft(key);
  const empty: PartExchangeDetails = { registration: '', makeModel: '', mileage: '', condition: '', conditionNotes: '', keys: '', v5: '', serviceHistory: '', name: '', phone: '', email: '' };
  const answers = updatePartExchangeAnswer({ details: previous?.details ?? empty, autofill: previous?.autofill }, 'registration', registration);
  savePartExchangeDraft(key, {
    ...answers,
    vehicleId: previous?.vehicleId ?? '',
    delivery: previous?.delivery ?? 'website',
    ...(previous?.message ? { message: previous.message } : {}),
  });
  return true;
}
