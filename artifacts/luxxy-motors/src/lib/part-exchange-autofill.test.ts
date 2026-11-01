import { expect, it } from 'vitest';
import { applyPartExchangeMotDetails, exchangeMileageIsEstimated, updatePartExchangeAnswer, type PartExchangeAnswers } from './part-exchange-autofill';
import type { PartExchangeMotDetailsResult } from '@/components/part-exchange-mot-details';
const answers = (): PartExchangeAnswers => ({ details: { registration: 'AB12 CDE', makeModel: '', mileage: '', condition: '', conditionNotes: '', keys: '', v5: '', serviceHistory: '', name: 'Buyer', email: 'buyer@example.test', phone: '07700900123' } });
const result = { registration: 'AB12CDE', vehicle: { make: 'HONDA', model: 'CIVIC', registrationDate: null }, mileage: '65000', mot: null } as PartExchangeMotDetailsResult;
it('fills blank values and owns only values it supplied', () => {
  const filled = applyPartExchangeMotDetails(answers(), result);
  expect(filled.details).toMatchObject({ makeModel: 'Honda Civic', mileage: '65000' }); expect(exchangeMileageIsEstimated(filled)).toBe(true);
});
it('preserves manually edited equal or blank fields on repeat checks', () => {
  let current = applyPartExchangeMotDetails(answers(), result);
  current = updatePartExchangeAnswer(current, 'mileage', '65000'); current = updatePartExchangeAnswer(current, 'makeModel', '');
  const checked = applyPartExchangeMotDetails(current, result);
  expect(checked.details.makeModel).toBe(''); expect(checked.details.mileage).toBe('65000'); expect(exchangeMileageIsEstimated(checked)).toBe(false);
});
it('clears the previous car’s answers, including manual text, when the plate changes but keeps contacts', () => {
  let current = applyPartExchangeMotDetails(answers(), result);
  current = updatePartExchangeAnswer(current, 'makeModel', 'My model'); current = updatePartExchangeAnswer(current, 'conditionNotes', 'Old car details');
  const changed = updatePartExchangeAnswer(current, 'registration', 'CD34 EFG');
  expect(changed.details).toMatchObject({ registration: 'CD34 EFG', makeModel: '', mileage: '', conditionNotes: '', name: 'Buyer', phone: '07700900123' });
  expect(changed.autofill).toBeUndefined(); expect(applyPartExchangeMotDetails(changed, result)).toBe(changed);
});
it('keeps the same car’s answers when only plate spacing/case changes and protects legacy manual values', () => {
  const current = answers(); current.details.makeModel = 'Existing model'; current.details.mileage = '12345';
  const checked = applyPartExchangeMotDetails(updatePartExchangeAnswer(current, 'registration', 'ab12cde'), result);
  expect(checked.details).toMatchObject({ makeModel: 'Existing model', mileage: '12345' }); expect(exchangeMileageIsEstimated(checked)).toBe(false);
});

it('drops an old owned estimate when a fresh identity check cannot estimate mileage, while keeping manual mileage', () => {
  const filled = applyPartExchangeMotDetails(answers(), result);
  const unavailable = { ...result, mileage: undefined };
  const refreshed = applyPartExchangeMotDetails(filled, unavailable);
  expect(refreshed.details.mileage).toBe(''); expect(exchangeMileageIsEstimated(refreshed)).toBe(false);
  const manual = updatePartExchangeAnswer(filled, 'mileage', '64000');
  expect(applyPartExchangeMotDetails(manual, unavailable).details.mileage).toBe('64000');
});


it('prefills readable provider names while preserving manually supplied names', () => {
  const mercedes={...result,vehicle:{make:'MERCEDES-BENZ',model:'A-CLASS',registrationDate:null}};
  const filled=applyPartExchangeMotDetails(answers(),mercedes);expect(filled.details.makeModel).toBe('Mercedes-Benz A-Class');expect(filled.autofill?.makeModel).toBe('Mercedes-Benz A-Class');
  const manual=updatePartExchangeAnswer(filled,'makeModel','My Mercedes A 200 AMG');expect(applyPartExchangeMotDetails(manual,mercedes).details.makeModel).toBe('My Mercedes A 200 AMG');
});
