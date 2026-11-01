import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browseReturnHref, readBrowseSession, rememberStockPosition, saveBrowseSession } from './browse-session';

function tenant(origin: string) {
  const meta = document.createElement('meta');
  meta.name = 'luxxy-canonical-origin';
  meta.content = origin;
  meta.setAttribute('data-page-meta', '');
  meta.setAttribute('data-browse-test', '');
  document.head.append(meta);
}

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState({}, '', '/stock');
});
afterEach(() => {
  document.querySelectorAll('[data-browse-test]').forEach(element => element.remove());
  vi.restoreAllMocks();
});

describe('stock return state', () => {
  it('retains the complete Multi-Choice search URL when a card records its position', () => {
    tenant('https://multichoicemotors.co.uk');
    const href = '/stock?make=BMW%2CAudi&colour=Blue&engine=1.5&mileage=50000&sort=price-asc&page=3';
    window.history.replaceState({}, '', href);
    saveBrowseSession({ stockHref: href, visibleCount: 36 });
    const link = document.createElement('a');
    link.setAttribute('data-stock-link', 'chosen-car');
    link.setAttribute('data-browse-test', '');
    document.body.append(link);
    rememberStockPosition('chosen-car');
    expect(readBrowseSession()).toMatchObject({ stockHref: href, visibleCount: 36, vehicleId: 'chosen-car' });
    window.history.replaceState({}, '', '/vehicle/chosen-car');
    expect(browseReturnHref()).toBe(href);
  });

  it('keeps another dealership on its own legacy filter return contract', () => {
    tenant('https://shoredrive.uk');
    sessionStorage.setItem('luxxy.browse.v1', JSON.stringify({ stockHref: '/stock?colour=Blue&page=3', filters: { make: 'Ford', model: 'Fiesta', maxPrice: '6000' } }));
    const url = new URL(browseReturnHref(), window.location.origin);
    expect(url.pathname).toBe('/stock');
    expect(Object.fromEntries(url.searchParams)).toEqual({ make: 'Ford', model: 'Fiesta', maxPrice: '6000' });
  });

  it.each(['https://other.example/stock?make=BMW', '//other.example/stock', '/portal?section=sales', '/stock/../portal', '/stock#external'])('never turns an invalid saved return path into a navigation destination: %s', stockHref => {
    tenant('https://multichoicemotors.co.uk');
    sessionStorage.setItem('luxxy.browse.v1', JSON.stringify({ stockHref, filters: { make: 'BMW' } }));
    expect(browseReturnHref()).toBe('/stock?make=BMW');
  });

  it('keeps browsing usable when remembered state is malformed or storage is unavailable', () => {
    tenant('https://multichoicemotors.co.uk');
    sessionStorage.setItem('luxxy.browse.v1', '{broken');
    expect(readBrowseSession()).toEqual({});
    expect(browseReturnHref()).toBe('/stock');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
    expect(() => saveBrowseSession({ stockHref: '/stock?make=BMW' })).not.toThrow();
    expect(browseReturnHref()).toBe('/stock');
  });
});
