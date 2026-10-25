import { describe, expect, it } from 'vitest';
import { getVehicleContactMessage, getWhatsAppHref } from './cta-helpers';
import type { Car } from './stock-context';

describe('vehicle contact message', () => {
  const car = { id: 'car-1', title: 'BMW 3 Series', registration: '2024 (24 REG)', registrationBand: '2024 (24 REG)', year: 2024, plate: 'NV24 LNZ' } as Car;
  it('includes the real plate instead of treating the year band as a registration', () => {
    const message = getVehicleContactMessage(car, 'ask about this car');
    expect(message).toContain('Registration: NV24 LNZ');
    expect(message).not.toContain('Registration: 2024');
    expect(message).toContain('BMW 3 Series');
    expect(message).not.toContain('Vehicle reference');
    expect(message).not.toContain('car-1');
  });
  it('accepts the VRM field and labels a year-only fallback honestly', () => {
    expect(getVehicleContactMessage({ ...car, plate: null, vrm: 'NV24 LNZ' }, 'ask')).toContain('Registration: NV24 LNZ');
    const message = getVehicleContactMessage({ ...car, plate: null }, 'ask');
    expect(message).toContain('Year / plate: 2024 (24 REG)');
    expect(message).not.toContain('Registration:');
    expect(getVehicleContactMessage({ ...car, plate: null, registrationBand: null }, 'ask')).toContain('Year / plate: 2024 (24 REG)');
  });
});

describe('dealer WhatsApp settings', () => {
  it.each(['07700 900123', '+44 7700 900123', '0044 7700 900123', '+44 (0)7700 900123', '447700900123'])('uses international digits for %s', whatsapp => {
    const config = { identity: { name: 'Example Motors' }, contact: { whatsapp } };
    expect(getWhatsAppHref(undefined, config)).toBe('https://wa.me/447700900123');
    const message = 'Hello & thanks\nPlease tell me more.';
    const href = new URL(getWhatsAppHref(message, config)!);
    expect(href.pathname).toBe('/447700900123');
    expect(href.searchParams.get('text')).toBe(message);
  });

  it.each(['', '12345', '07700 900123 ext 4', '++447700900123', '7700900123'])('does not expose a broken link for %s', whatsapp => {
    expect(getWhatsAppHref(undefined, { identity: { name: 'Example Motors' }, contact: { whatsapp } })).toBeUndefined();
  });
});

it('uses natural enquiry copy, pounds and line breaks without sending a localhost link', () => {
  const message = getVehicleContactMessage({ id: 'preview-2', title: '2026 MG HS', price: 13255, currency: 'GBP' } as Car, 'get more information about this vehicle');
  expect(message).toContain('2026 MG HS · £13,255');
  expect(message).toContain('Is it still available?');
  expect(message).toContain('\n\n');
  expect(message).not.toContain('127.0.0.1');
  expect(message).not.toContain('localhost');
  expect(message).not.toContain('preview-2');
});
