import type { PartExchangeMotDetailsResult } from '@/components/part-exchange-mot-details';
import type { PartExchangeDetails } from './part-exchange';
import { dvsaVehicleName } from './dvsa-vehicle-name';

export type PartExchangeAutofill = { registration: string; makeModel?: string; mileage?: string; manualMakeModel?: boolean; manualMileage?: boolean };
export type PartExchangeAnswers = { details: PartExchangeDetails; autofill?: PartExchangeAutofill };
export const normaliseExchangeRegistration = (value: string) => value.toUpperCase().replace(/[\s-]/g, '');

/** A different registration starts a different car; retain contact details only. */
export function updatePartExchangeAnswer(current: PartExchangeAnswers, key: keyof PartExchangeDetails, value: string): PartExchangeAnswers {
  const details = { ...current.details, [key]: value };
  if (key === 'registration' && normaliseExchangeRegistration(value) !== normaliseExchangeRegistration(current.details.registration)) {
    return { details: { ...details, makeModel: '', mileage: '', condition: '', conditionNotes: '', keys: '', v5: '', serviceHistory: '' } };
  }
  if (key === 'makeModel' || key === 'mileage') {
    const autofill: PartExchangeAutofill = { ...current.autofill, registration: normaliseExchangeRegistration(details.registration) };
    delete autofill[key];
    if (key === 'makeModel') autofill.manualMakeModel = true;
    else autofill.manualMileage = true;
    return { details, autofill };
  }
  return { ...current, details };
}

/** Repeat checks may refresh our values, never the customer's manual answers. */
export function applyPartExchangeMotDetails(current: PartExchangeAnswers, lookup: PartExchangeMotDetailsResult): PartExchangeAnswers {
  const registration = normaliseExchangeRegistration(current.details.registration);
  if (registration !== lookup.registration) return current;
  const details = { ...current.details }, autofill: PartExchangeAutofill = { ...current.autofill, registration };
  const name = dvsaVehicleName(lookup.vehicle);
  if (name && !autofill.manualMakeModel && (!details.makeModel.trim() || details.makeModel === autofill.makeModel)) { details.makeModel = name; autofill.makeModel = name; }
  if (!autofill.manualMileage && (!details.mileage.trim() || details.mileage === autofill.mileage)) {
    if (lookup.mileage !== undefined) { details.mileage = lookup.mileage; autofill.mileage = lookup.mileage; }
    else if (autofill.mileage !== undefined) { details.mileage = ''; delete autofill.mileage; }
  }
  return { details, autofill };
}
export function exchangeMileageIsEstimated({ details, autofill }: PartExchangeAnswers) {
  return Boolean(autofill?.mileage !== undefined && !autofill.manualMileage && autofill.registration === normaliseExchangeRegistration(details.registration) && details.mileage === autofill.mileage);
}
