import { customerFeaturePolicy } from '@workspace/vehicle-meta';
import { expect, it } from 'vitest';
import { previewSettings } from '../../preview/settings';
import { launchChecks } from './settings-preview';
it('flags sample deployment content and unverified payment readiness', () => {
  const checks = launchChecks(previewSettings);
  expect(checks.find(check => check.label === 'Showroom address')?.issue).toContain('sample');
  if (customerFeaturePolicy.onlineCardReservations) expect(checks.find(check => check.label === 'Online payments')?.issue).toContain('does not verify');
  else expect(checks.find(check => check.label === 'Online payments')).toBeUndefined();
});
it('does not flag disabled reservations or a genuine supplied address', () => {
  const settings = structuredClone(previewSettings);
  settings.address = { ...settings.address, street: '42 High Street', postcode: 'HA1 1AA' };
  settings.onlineReservation = { ...settings.onlineReservation!, enabled: false };
  const checks = launchChecks(settings);
  expect(checks.find(check => check.label === 'Showroom address')?.issue).toBeNull();
  expect(checks.find(check => check.label === 'Online payments')?.issue ?? null).toBeNull();
});

it('does not ask for unused showroom photography and distinguishes unknown hours', () => {
  const settings = structuredClone(previewSettings);
  settings.hours = [{days:'Monday – Saturday',times:'08:00 – 18:00'}];
  settings.presentation = {...settings.presentation,showroomImageUrl:''};
  const checks = launchChecks(settings);
  expect(checks.some(check => check.label === 'Dealership photography')).toBe(false);
  expect(checks.find(check => check.label === 'Opening hours')?.issue).toContain('unknown');
});
