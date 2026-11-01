import { expect, it } from 'vitest';
import type { Car } from '@/lib/stock-context';
import { buildPartExchangeMessage, partExchangeWhatsAppMessage, partExchangeMotSummary, type PartExchangeDetails } from './part-exchange';
const details: PartExchangeDetails = { registration: ' ab12 cde ', makeModel: 'Ford Focus', mileage: '0', condition: 'Good', keys: '1 key', v5: 'Replacement requested', serviceHistory: 'Not sure', conditionNotes: '', name: ' Test Buyer ', phone: '07700 900123', email: '' };
it('prepares the friendly enquiry with actual current and selected vehicles, retaining zero mileage and uncertain paperwork', () => {
  const message = buildPartExchangeMessage(details, { id: 'stock-1', title: 'Audi A3', plate: 'XY19 ABC' } as Car, 'Example Motors');
  for (const value of ['Hi Example Motors', 'I have a Ford Focus (AB12 CDE)', 'interested in your Audi A3 (XY19 ABC)', 'Could you give me a valuation?', 'Current mileage: 0 miles', '1 key', 'Replacement requested', 'Not sure']) expect(message).toContain(value);
  expect(message).not.toMatch(/stock-1|Stock reference|Name:|Phone:|Email:|Not provided|attach photos/);
});
it('keeps contacts separate in the editable body but attaches their current values to the explicit WhatsApp message', () => {
  const message = buildPartExchangeMessage(details, { id: 'stock-2', title: 'Mercedes', registration: '2018 (68 reg)' } as Car, 'Example Motors');
  expect(message).not.toContain('(2018');
  expect(message).not.toContain('Advertised price:');
  const whatsapp = partExchangeWhatsAppMessage(message, { ...details, name: 'New name', email: 'new@example.test' });
  expect(whatsapp).toContain('Name: New name'); expect(whatsapp).toContain('Phone: 07700 900123'); expect(whatsapp).toContain('Email: new@example.test');
});
it('labels estimated mileage explicitly and never invents an MOT date', () => {
  const message = buildPartExchangeMessage(details, { title: 'Actual car' } as Car, 'Example', { mileageEstimated: true });
  expect(message).toContain('Estimated mileage: 0 miles'); expect(message).not.toContain('MOT due');
  expect(partExchangeMotSummary({ dueDate: '2027-02-31', firstTest: false, lastPassedDate: null, lastTestDate: null, latestTestResult: null, checkedAt: '2026-11-01T10:00:00Z' })).toBeNull();
});
it('keeps a later failed MOT neutral rather than presenting a previous expiry as current', () => {
  expect(partExchangeMotSummary({ dueDate: '2027-10-20', firstTest: false, lastPassedDate: '2026-10-20', lastTestDate: '2026-10-22', latestTestResult: 'FAILED', checkedAt: '2026-11-01T10:00:00Z' })).toBe('MOT record needs checking.');
});
