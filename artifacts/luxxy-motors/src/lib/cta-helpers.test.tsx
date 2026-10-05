import { describe, expect, it } from 'vitest';
import { getVehicleContactMessage } from './cta-helpers';
import type { Car } from './stock-context';

describe('vehicle contact message', () => {
  const car = { id: 'car-1', title: 'BMW 3 Series', registration: '2024 (24 REG)', registrationBand: '2024 (24 REG)', year: 2024, plate: 'NV24 LNZ' } as Car;
  it('includes the real plate instead of treating the year band as a registration', () => {
    const message = getVehicleContactMessage(car, 'ask about this car');
    expect(message).toContain('Registration: NV24 LNZ');
    expect(message).not.toContain('Registration: 2024');
    expect(message).toContain('Vehicle reference: car-1');
  });
  it('accepts the VRM field and labels a year-only fallback honestly', () => {
    expect(getVehicleContactMessage({ ...car, plate: null, vrm: 'NV24 LNZ' }, 'ask')).toContain('Registration: NV24 LNZ');
    const message = getVehicleContactMessage({ ...car, plate: null }, 'ask');
    expect(message).toContain('Year / plate: 2024 (24 REG)');
    expect(message).not.toContain('Registration:');
    expect(getVehicleContactMessage({ ...car, plate: null, registrationBand: null }, 'ask')).toContain('Year / plate: 2024 (24 REG)');
  });
});

it('uses natural enquiry copy, pounds and line breaks without sending a localhost link', () => {
  const message = getVehicleContactMessage({ id: 'preview-2', title: '2026 MG HS', price: 13255, currency: 'GBP' } as Car, 'get more information about this vehicle');
  expect(message).toContain('2026 MG HS · £13,255');
  expect(message).toContain('Is it still available?');
  expect(message).toContain('\n\n');
  expect(message).not.toContain('127.0.0.1');
  expect(message).not.toContain('localhost');
});
