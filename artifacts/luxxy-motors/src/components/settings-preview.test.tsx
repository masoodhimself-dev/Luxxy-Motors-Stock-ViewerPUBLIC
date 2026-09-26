import { expect, it } from 'vitest';
import { previewSettings } from '../../preview/settings';
import { launchChecks } from './settings-preview';
it('flags sample deployment content and simulated payments', () => {
  const checks = launchChecks(previewSettings);
  expect(checks.find(check => check.label === 'Showroom address')?.issue).toContain('sample');
  expect(checks.find(check => check.label === 'Online payments')?.issue).toContain('simulated');
});
it('does not flag disabled reservations or a genuine supplied address', () => {
  const settings = structuredClone(previewSettings);
  settings.address = { ...settings.address, street: '42 High Street', postcode: 'HA1 1AA' };
  settings.onlineReservation = { ...settings.onlineReservation!, enabled: false };
  const checks = launchChecks(settings);
  expect(checks.find(check => check.label === 'Showroom address')?.issue).toBeNull();
  expect(checks.find(check => check.label === 'Online payments')?.issue).toBeNull();
});
