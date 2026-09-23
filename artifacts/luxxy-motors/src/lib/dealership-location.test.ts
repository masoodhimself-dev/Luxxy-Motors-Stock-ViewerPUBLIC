import { describe, expect, it } from 'vitest';
import { dealershipLocation } from './dealership-location';

describe('dealership location', () => {
  it('uses the saved map link for a supplied real address', () => {
    expect(dealershipLocation({ street: ' 20 Station Road ', city: 'Harrow', postcode: 'HA1 1AA', mapsUrl: 'https://maps.google.com/?q=Harrow' })).toEqual({ lines: ['20 Station Road', 'Harrow', 'HA1 1AA'], isSample: false, directions: 'https://maps.google.com/?q=Harrow' });
  });
  it('does not direct visitors to sample addresses', () => {
    expect(dealershipLocation({ street: '12 Example Road (sample address)', mapsUrl: 'https://maps.google.com' }).directions).toBeNull();
  });
  it('rejects invalid and executable links and handles absent settings', () => {
    for (const mapsUrl of ['javascript:alert(1)', 'data:text/html,test', 'not a url']) expect(dealershipLocation({ mapsUrl }).directions).toBeNull();
    expect(dealershipLocation(undefined)).toEqual({ lines: [], isSample: false, directions: null });
  });
});
