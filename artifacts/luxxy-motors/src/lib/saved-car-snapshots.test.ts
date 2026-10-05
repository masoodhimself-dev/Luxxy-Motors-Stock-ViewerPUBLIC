import { beforeEach, expect, it } from 'vitest';
import { rememberSavedCar, readSavedSnapshots, forgetSavedSnapshots, savedPriceReduction } from './saved-car-snapshots';
import type { Car } from './stock-context';
beforeEach(() => localStorage.clear());
it('retains the saved identity and only reports a genuine same-currency reduction', () => {
 const car = { id: 'car', title: 'Ford Focus', price: 5000, currency: 'GBP', heroImage: null, images: [] } as unknown as Car;
 rememberSavedCar(car); const snapshot = readSavedSnapshots().car;
 expect(snapshot.title).toContain('Ford Focus');
 expect(savedPriceReduction(snapshot, { ...car, price: 4800 })).toBe(200);
 expect(savedPriceReduction(snapshot, { ...car, price: 5200 })).toBeNull();
 expect(savedPriceReduction(snapshot, { ...car, price: 4800, currency: 'EUR' })).toBeNull();
 expect(savedPriceReduction(undefined, car)).toBeNull();
 forgetSavedSnapshots(['car']); expect(readSavedSnapshots()).toEqual({});
});
it('ignores malformed stored data', () => {
 localStorage.setItem('luxxy.saved-car-snapshots.v1', '{'); expect(readSavedSnapshots()).toEqual({});
 localStorage.setItem('luxxy.saved-car-snapshots.v1', JSON.stringify({ bad: { price: 2 } })); expect(readSavedSnapshots()).toEqual({});
});
it('retains supplied plates on new saves and reads existing snapshots without adding a plate', () => {
 const car = { id: 'plated', title: 'Ford Focus', plate: 'AB12 CDE', price: 5000, currency: 'GBP', images: [] } as unknown as Car;
 rememberSavedCar(car);
 expect(readSavedSnapshots().plated.registration).toBe('AB12 CDE');
 rememberSavedCar({ ...car, id: 'missing', plate: null, year: 2012, registrationBand: '2012 (12 reg)' });
 expect(readSavedSnapshots().missing.registration).toBeUndefined();
 const legacy = { title: 'Earlier saved car', photo: '', price: 4000, currency: 'GBP', status: 'available', savedAt: '2026-09-01T10:00:00Z' };
 localStorage.setItem('luxxy.saved-car-snapshots.v1', JSON.stringify({ legacy }));
 expect(readSavedSnapshots().legacy).toEqual(legacy);
});
