import { describe, expect, it } from 'vitest';
import type { Car } from '@/lib/stock-context';
import { buildPartExchangeMessage, type PartExchangeDetails } from './part-exchange';

const details: PartExchangeDetails = {
  registration: ' ab12 cde ', makeModel: 'Ford Focus', mileage: '0', condition: 'Good',
  keys: '1 key', v5: 'Replacement requested', serviceHistory: 'Not sure', conditionNotes: '',
  name: ' Test Buyer ', phone: '07700 900123', email: '',
};
describe('part exchange WhatsApp summary', () => {
  it('keeps the full vehicle and contact brief, including zero mileage and uncertain documents', () => {
    const message = buildPartExchangeMessage(details, { id: 'stock-1', title: 'Audi A3', price: 15000, year: 2019, plate: 'XY19 ABC' } as Car, 'Example Motors');
    for (const value of ['Example Motors', 'Registration: AB12 CDE', 'Mileage: 0 miles', '1 key', 'Replacement requested', 'Not sure', 'Audi A3', 'stock-1', 'Registration: XY19 ABC', 'Name: Test Buyer', '07700 900123']) expect(message).toContain(value);
    expect(message).not.toContain('Email:');
    expect(message).toContain('other details: Not provided');
    expect(message).toContain('attach photos');
  });
  it('does not present an age band as a registration plate or invent missing prices', () => {
    const message = buildPartExchangeMessage({ ...details, email: 'buyer@example.com' }, { id: 'stock-2', title: 'Mercedes', registration: '2018 (68 reg)', price: null } as Car, 'Example Motors');
    expect(message).not.toContain('Registration: 2018');
    expect(message).not.toContain('Advertised price:');
    expect(message).toContain('Email: buyer@example.com');
  });
});
