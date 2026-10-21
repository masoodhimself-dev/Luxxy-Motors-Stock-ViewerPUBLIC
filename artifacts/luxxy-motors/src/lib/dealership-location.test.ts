import { describe, expect, it } from 'vitest';
import { dealershipLocation } from './dealership-location';

describe('dealership location', () => {
  it('uses the saved map link for a supplied real address', () => {
    expect(dealershipLocation({ street: ' 20 Station Road ', city: 'Harrow', postcode: 'HA1 1AA', mapsUrl: 'https://maps.google.com/?q=Harrow' })).toEqual({ lines: ['20 Station Road', 'Harrow', 'HA1 1AA'], isSample: false, directions: 'https://maps.google.com/?q=Harrow' });
  });
  it('does not direct visitors to sample addresses', () => {
    expect(dealershipLocation({ street: '12 Example Road (sample address)', mapsUrl: 'https://maps.google.com' }).directions).toBeNull();
  });
  it('builds the same directions link from a confirmed address without a saved map URL', () => {
    const location = dealershipLocation({ street: 'Rear of 176 Rayners Lane', city: 'London', postcode: 'HA2 8LY' });
    expect(location.directions).toBe('https://www.google.com/maps/search/?api=1&query=Rear%20of%20176%20Rayners%20Lane%2C%20London%2C%20HA2%208LY');
  });
  it('does not make a town or incomplete street address appear to be a showroom', () => {
    expect(dealershipLocation({ city: 'London', postcode: 'HA2 8LY' }).directions).toBeNull();
    expect(dealershipLocation({ street: 'A Road' }).directions).toBeNull();
  });
  it('rejects invalid and executable links and handles absent settings', () => {
    for (const mapsUrl of ['javascript:alert(1)', 'data:text/html,test', 'not a url']) expect(dealershipLocation({ mapsUrl }).directions).toBeNull();
    expect(dealershipLocation(undefined)).toEqual({ lines: [], isSample: false, directions: null });
  });
});
