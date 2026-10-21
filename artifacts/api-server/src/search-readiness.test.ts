import assert from 'node:assert/strict';
import test from 'node:test';
import { searchReadiness } from './lib/search-readiness';

const settings = { identity: { name: 'Test Motors' }, contact: { phone: '02000000000' }, address: { street: 'A showroom', city: 'London', postcode: 'HA0 0AA' }, hours: [{ days: 'Monday–Saturday', times: '08:00–18:00' }, { days: 'Sunday', times: 'Closed' }] };
test('readiness reports published field presence without inventing external verification', () => {
  const result = searchReadiness(settings, 'https://dealer.example.test', false, new Date('2026-10-21T12:00:00Z'));
  assert.equal(result.status, 'ready_to_submit'); assert.ok(result.checks.every(check => check.ready));
  assert.ok(Object.values(result.externalChecks).every(value => value === 'unconfirmed'));
  assert.equal(result.sitemapUrl, 'https://dealer.example.test/sitemap.xml');
  assert.equal(result.generatedAt, '2026-10-21T12:00:00.000Z');
});
test('blank or malformed fields remain to review, and unknown days are not invented as closed', () => {
  const result = searchReadiness({ identity: { name: ' ' }, hours: [{ days: 'Sunday', times: '' }] }, 'https://dealer.example.test');
  assert.equal(result.status, 'needs_details'); assert.ok(result.checks.every(check => !check.ready));
  assert.equal(searchReadiness({ ...settings, hours: null }, 'https://dealer.example.test').checks.find(check => check.code === 'hours')?.ready, false);
});
test('demo exclusion takes precedence over complete content and source fields remain untouched', () => {
  const before = JSON.stringify(settings);
  assert.equal(searchReadiness(settings, 'https://demo.example.test', true).status, 'demo_excluded');
  assert.equal(JSON.stringify(settings), before);
});
test('sample addresses and unconfirmed hours do not pass readiness', () => {
  const result = searchReadiness({ ...settings, address: { ...settings.address, street: '12 Example Road (sample)' }, hours: [{ days: 'Sunday', times: 'Unknown' }] }, 'https://dealer.example.test');
  assert.equal(result.status, 'needs_details');
  assert.equal(result.checks.find(check => check.code === 'address')?.ready, false);
  assert.equal(result.checks.find(check => check.code === 'hours')?.ready, false);
});
test('opening-hour readiness requires all seven days with no overlaps or ambiguous labels', () => {
  for (const hours of [
    [{ days: 'Monday', times: '08:00–18:00' }],
    [{ days: 'Daily', times: '08:00–18:00' }, { days: 'Monday', times: 'Closed' }],
    [{ days: 'Weekish', times: '08:00–18:00' }],
    [{ days: 'Monday–Saturday', times: '08:00–18:00' }, { days: 'Sunday', times: 'Unknown' }],
  ]) {
    const result = searchReadiness({ ...settings, hours }, 'https://dealer.example.test');
    assert.equal(result.checks.find(check => check.code === 'hours')?.ready, false);
  }
  const appointment = searchReadiness({ ...settings, hours: [{ days: 'Every day', times: 'By appointment only' }] }, 'https://dealer.example.test');
  assert.equal(appointment.checks.find(check => check.code === 'hours')?.ready, true);
});
