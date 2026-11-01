import { beforeEach, expect, it, vi } from 'vitest';
import { lookupPartExchangeCar, readPartExchangeMotDetails } from './part-exchange-lookup';
const api = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@workspace/api-client-react', () => ({ customFetch: (...args: unknown[]) => api.fetch(...args) }));
const reply = () => ({ status: 'estimated', registration: 'YS67LMK', vehicle: { make: 'MERCEDES-BENZ', model: 'A-CLASS', registrationDate: '2017-09-01' }, estimate: { mileage: 88000, lastTestDate: '2026-10-02', lastTestMileage: 87000, annualMiles: 9000 }, mot: { dueDate: '2027-10-01', latestTestResult: 'PASSED', checkedAt: '2026-11-01T10:00:00Z', lastReading: { date: '2026-10-02', mileage: 87000, unit: 'MI' } } });
beforeEach(() => api.fetch.mockReset());
it('normalises a valid registration and validates the read-only API response', async () => {
  api.fetch.mockResolvedValue(reply()); const controller = new AbortController();
  const result = await lookupPartExchangeCar('ys67 lmk', controller.signal);
  expect(api.fetch).toHaveBeenCalledWith('/api/mot-mileage-estimate?registration=YS67LMK', { signal: controller.signal });
  expect(result).toMatchObject({ registration: 'YS67LMK', mileage: '88000', vehicle: { make: 'MERCEDES-BENZ' }, mot: { dueDate: '2027-10-01', lastReading: { mileage: 87000, unit: 'MI' } } });
});
it('rejects invalid plates before a request and mismatched identities after a request', async () => {
  await expect(lookupPartExchangeCar('YS')).rejects.toThrow('Invalid registration'); expect(api.fetch).not.toHaveBeenCalled();
  expect(() => readPartExchangeMotDetails(reply(), 'AB12CDE')).toThrow('Unmatched car');
  expect(() => readPartExchangeMotDetails({ ...reply(), vehicle: {} }, 'YS67LMK')).toThrow('No vehicle identity');
});
it('does not create invented mileage or dates from malformed provider facts', () => {
  const value = { ...reply(), estimate: { mileage: 88023, lastTestMileage: -10, annualMiles: Infinity }, mot: { dueDate: '2027-02-30', checkedAt: 'not-a-date', latestTestResult: 'maybe' } };
  expect(readPartExchangeMotDetails(value, 'YS67LMK')).toMatchObject({ mot: null });
  expect(readPartExchangeMotDetails(value, 'YS67LMK')).not.toHaveProperty('mileage');
});
it('allows vehicle identity with unavailable mileage and a genuine first MOT date', () => {
  const value = { ...reply(), status: 'unavailable', estimate: null, mot: { dueDate: '2027-09-01', firstTest: true, checkedAt: '2026-11-01T10:00:00Z' } };
  const result = readPartExchangeMotDetails(value, 'YS67LMK');
  expect(result.mileage).toBeUndefined(); expect(result.mot).toMatchObject({ firstTest: true, dueDate: '2027-09-01' });
});
it('propagates cancellation and provider failures rather than returning unverified data', async () => {
  api.fetch.mockRejectedValueOnce(new DOMException('Aborted', 'AbortError'));
  await expect(lookupPartExchangeCar('YS67LMK', new AbortController().signal)).rejects.toHaveProperty('name', 'AbortError');
  api.fetch.mockRejectedValueOnce(Error('Unavailable'));
  await expect(lookupPartExchangeCar('YS67LMK')).rejects.toThrow('Unavailable');
});
