import { describe, expect, it } from 'vitest';
import { getVehicleContactMessage } from './cta-helpers';
import type { Car } from './stock-context';

describe('vehicle contact message', () => {
  const car = { id: 'car-1', title: 'BMW 3 Series', registration: '2024 (24 REG)', registrationBand: '2024 (24 REG)', year: 2024, plate: 'NV24 LNZ' } as Car;
  it('includes the real plate instead of treating the year band as a registration', () => {
    const message = getVehicleContactMessage(car, 'ask about this car');
    expect(message).toContain('Registration: NV24 LNZ');
    expect(message).not.toContain('Registration: 2024');
    expect(message).toContain('/share/vehicle/car-1');
  });
  it('accepts the VRM field and labels a year-only fallback honestly', () => {
    expect(getVehicleContactMessage({ ...car, plate: null, vrm: 'NV24 LNZ' }, 'ask')).toContain('Registration: NV24 LNZ');
    const message = getVehicleContactMessage({ ...car, plate: null }, 'ask');
    expect(message).toContain('Registration year: 2024 (24 REG)');
    expect(message).not.toContain('Registration:');
  });
});
