import { expect, it } from 'vitest';
import { vehicleChecksEnabledForHost } from './vehicle-checks-rollout';

it('enables the reviewed Cazoo test demo on its canonical domain', () => {
  expect(vehicleChecksEnabledForHost('multi-choice-motors-cazoo-test.demo.luxxyexmaplenumber2.uk')).toBe(true);
  expect(vehicleChecksEnabledForHost('MULTI-CHOICE-MOTORS-CAZOO-TEST.DEMO.LUXXYEXMAPLENUMBER2.UK')).toBe(true);
});

it.each([
  'luxxymotors.uk', 'www.luxxymotors.uk', 'www.shoredrive.uk', 'shoredrive.uk',
  'luxxyexmaplenumber2.uk', 'www.luxxyexmaplenumber2.uk',
  'multichoice-motors.demo.luxxyexmaplenumber2.uk',
  'luxxy-shared-staging.onrender.com', '', 'localhost', '127.0.0.1',
  'multi-choice-motors-cazoo-test.demo.luxxyexmaplenumber2.uk.evil.example',
])('leaves other production hosts unchanged: %s', host => {
  expect(vehicleChecksEnabledForHost(host)).toBe(false);
});

it('permits local development previews without enabling other dealer domains', () => {
  expect(vehicleChecksEnabledForHost('localhost', true)).toBe(true);
  expect(vehicleChecksEnabledForHost('127.0.0.1', true)).toBe(true);
  expect(vehicleChecksEnabledForHost('[::1]', true)).toBe(true);
  expect(vehicleChecksEnabledForHost('www.shoredrive.uk', true)).toBe(false);
});
