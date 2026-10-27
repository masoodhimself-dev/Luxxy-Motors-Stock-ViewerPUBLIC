import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { clearCustomerTestStorage, readCustomerStorage, removeCustomerStorage, writeCustomerStorage } from './customer-test-storage';
import { readBrowseSession, saveBrowseSession } from './browse-session';
import { recentVehicles, rememberVehicle, clearRecentVehicles } from './customer-convenience';
import { readSavedSnapshots, rememberSavedCar, forgetSavedSnapshots, savedPriceReduction } from './saved-car-snapshots';
import { clearTestCustomerShortlist } from './test-customer-shortlist-storage';
import { usePageMeta } from '@/hooks/use-page-meta';
import type { Car } from './stock-context';

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); delete document.documentElement.dataset.testModeSession; });
afterEach(() => { delete document.documentElement.dataset.testModeSession; clearCustomerTestStorage('test-a'); clearCustomerTestStorage('test-b'); vi.restoreAllMocks(); });

it('keeps browser values and each practice session separate, including after clearing', () => {
  localStorage.setItem('preference', 'real');
  document.documentElement.dataset.testModeSession = 'test-a';
  expect(readCustomerStorage(localStorage, 'preference')).toBeNull();
  writeCustomerStorage(localStorage, 'preference', 'practice');
  expect(localStorage.getItem('preference')).toBe('real');
  document.documentElement.dataset.testModeSession = 'test-b';
  expect(readCustomerStorage(localStorage, 'preference')).toBeNull();
  writeCustomerStorage(localStorage, 'preference', 'other');
  document.documentElement.dataset.testModeSession = 'test-a';
  expect(readCustomerStorage(localStorage, 'preference')).toBe('practice');
  removeCustomerStorage(localStorage, 'preference');
  expect(localStorage.getItem('preference')).toBe('real');
  document.documentElement.dataset.testModeSession = 'test-b';
  expect(readCustomerStorage(localStorage, 'preference')).toBe('other');
  clearCustomerTestStorage('test-b');
  expect(readCustomerStorage(localStorage, 'preference')).toBeNull();
});

it('does not read or change the customer’s real browse, viewed and saved snapshots', () => {
  rememberVehicle('real-car');
  saveBrowseSession({ showAll: true, visibleCount: 19 });
  const car = { id:'real-car', title:'Real car', images:[], price:1000, currency:'GBP' } as Car;
  rememberSavedCar(car);
  const before = { recent: localStorage.getItem('luxxy.recent-vehicles.v1'), saved: localStorage.getItem('luxxy.saved-car-snapshots.v1'), browse: sessionStorage.getItem('luxxy.browse.v1') };
  document.documentElement.dataset.testModeSession = 'test-a';
  expect(recentVehicles()).toEqual([]); expect(readBrowseSession()).toEqual({}); expect(readSavedSnapshots()).toEqual({});
  rememberVehicle('practice-car'); saveBrowseSession({ visibleCount: 12 }); rememberSavedCar({ ...car, id:'practice-car', title:'Practice car' });
  expect(recentVehicles()).toEqual(['practice-car']); expect(readBrowseSession().visibleCount).toBe(12); expect(readSavedSnapshots()['practice-car']).toBeDefined();
  clearRecentVehicles(); forgetSavedSnapshots();
  expect(localStorage.getItem('luxxy.recent-vehicles.v1')).toBe(before.recent);
  expect(localStorage.getItem('luxxy.saved-car-snapshots.v1')).toBe(before.saved);
  expect(sessionStorage.getItem('luxxy.browse.v1')).toBe(before.browse);
});

it('does not replace the portal document title or metadata during a customer practice view', () => {
  document.title = 'Staff portal';
  document.documentElement.dataset.testModeSession = 'test-a';
  const { unmount } = renderHook(() => usePageMeta({ title:'Vehicle', description:'Customer-facing car' }));
  expect(document.title).toBe('Staff portal');
  unmount();
  expect(document.title).toBe('Staff portal');
});

it('accepts an explicit test namespace before the test guard is installed', () => {
  rememberSavedCar({ id:'real', title:'Real car', images:[], price:1000, currency:'GBP' } as Car, null);
  const before=localStorage.getItem('luxxy.saved-car-snapshots.v1');
  rememberSavedCar({ id:'practice', title:'Practice car', images:[], price:1000, currency:'GBP' } as Car, 'test-a');
  expect(Object.keys(readSavedSnapshots('test-a'))).toEqual(['practice']);
  expect(localStorage.getItem('luxxy.saved-car-snapshots.v1')).toBe(before);
});

it('retains practice snapshots across a simulated reload for price comparisons, isolated from real and other sessions', () => {
  const car={id:'car',title:'Ford Focus',images:[],price:5000,currency:'GBP'} as Car;
  rememberSavedCar({...car,price:7000},null);
  const live=localStorage.getItem('luxxy.saved-car-snapshots.v1');
  rememberSavedCar(car,'test-a');
  rememberSavedCar({...car,price:9000},'test-b');
  // Guard teardown drops the in-memory cache, as a page reload would.
  clearCustomerTestStorage('test-a');
  const snapshot=readSavedSnapshots('test-a').car;
  expect(snapshot.price).toBe(5000);
  expect(savedPriceReduction(snapshot,{...car,price:4500})).toBe(500);
  expect(readSavedSnapshots('test-b').car.price).toBe(9000);
  expect(localStorage.getItem('luxxy.saved-car-snapshots.v1')).toBe(live);
  forgetSavedSnapshots(['car'],'test-a');
  clearCustomerTestStorage('test-a');
  expect(readSavedSnapshots('test-a')).toEqual({});
  expect(readSavedSnapshots('test-b').car.price).toBe(9000);
  clearTestCustomerShortlist('test-b'); clearCustomerTestStorage('test-b');
  expect(readSavedSnapshots('test-b')).toEqual({});
  expect(localStorage.getItem('luxxy.saved-car-snapshots.v1')).toBe(live);
});
