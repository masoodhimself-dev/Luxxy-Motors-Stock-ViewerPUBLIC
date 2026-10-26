import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { previewSettings } from '../../preview/settings';
import type { DealerFeatures } from '@/lib/dealer-features';
import type { Car, StockData } from '@/lib/stock-context';
import { customerPreviewDocument, renderCustomerPagePreview, type PreviewPage } from './customer-page-preview-renderer';

const features: DealerFeatures = { features: { testDriveBookings: true, testDriveDeclarations: true, staffAiDrafts: false, customerEmails: true, publicEnquiries: true, partExchange: true }, evaluatedAt: '2026-10-25T12:00:00Z' };
const car = (id: string, model: string) => ({ id, advertId: id, title: `Ford ${model}`, make: 'Ford', model, year: 2022, price: 7850, currency: 'GBP', mileage: 26000, fuel: 'Petrol', transmission: 'Automatic', heroImage: 'https://photos.example.test/front.jpg', images: [{ url: 'https://photos.example.test/front.jpg', caption: 'Front of the car' }, { url: 'https://photos.example.test/rear.jpg', caption: 'Rear of the car' }], specifications: null, sourceExtras: null, inventoryStatus: 'available' } as unknown as Car);
const stock: StockData = { schemaVersion: 1, dealerName: 'Published dealer', dealerLocation: 'London', count: 2, scrapedAt: '2026-10-25T12:00:00Z', cars: [car('one', 'Fiesta'), car('two', 'Focus')] };
const draft = () => {
  const settings = structuredClone(previewSettings);
  settings.identity.name = 'Unpublished Example Motors';
  settings.identity.logoText = 'Unpublished Example Motors';
  settings.hero.copy = 'A draft headline for our current cars';
  settings.presentation = { ...settings.presentation, showHeroDescription: true, reviewsEnabled: false, websiteCopy: { contactTitle: 'Talk to our draft team', warrantyDetailsHeading: 'Our draft policy guidance' } };
  settings.warranty = { enabled: true, title: 'Draft warranty cover', description: 'The actual dealer policy description.', ctaLabel: 'Ask about warranty' };
  settings.hours = [{ days: 'Monday – Sunday', times: '10:00 – 17:30' }];
  settings.featuredVehicleIds = ['two'];
  return settings;
};

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => vi.restoreAllMocks());

describe('unpublished actual customer-page snapshots', () => {
  it.each(['classic', 'premium', 'focused'] as const)('previews %s across all three pages using the draft without changing published data', websiteTemplate => {
    const settings = draft();
    settings.presentation = { ...settings.presentation, websiteTemplate };
    const before = structuredClone(settings);
    for (const page of ['home', 'stock', 'vehicle'] as const) {
      const html = renderCustomerPagePreview({ settings, stock, features, page, viewportWidth: 834, vehicleId: 'one' });
      expect(html).toContain(`data-website-template="${websiteTemplate}"`);
      expect(html).toContain(page === 'home' ? settings.hero.copy : 'Ford Fiesta');
      expect(html).not.toContain('Georgia');
    }
    expect(settings).toEqual(before);
  });

  it.each<PreviewPage>(['home', 'stock', 'vehicle', 'contact', 'warranty'])('renders %s from the draft and current public stock without requests, effects or device history', page => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Preview must not request anything'));
    const getStorage = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Preview must not read personal history'); });
    const setStorage = vi.spyOn(Storage.prototype, 'setItem');
    const events = vi.spyOn(window, 'dispatchEvent');
    const title = document.title;
    const body = document.body.getAttribute('style');
    const settings = draft();
    const before = structuredClone({ settings, stock, features });
    const html = renderCustomerPagePreview({ settings, stock, features, page, viewportWidth: 390, vehicleId: 'one' });
    expect({ settings, stock, features }).toEqual(before);
    expect(html).toContain('Unpublished Example Motors');
    expect(html).not.toContain('Published dealer');
    if (page === 'home') expect(html).toContain('A draft headline for our current cars');
    if (page === 'contact') { expect(html).toContain('Talk to our draft team'); expect(html).toContain('10:00 – 17:30'); }
    if (page === 'warranty') { expect(html).toContain('Draft warranty cover'); expect(html).toContain('Our draft policy guidance'); }
    if (page === 'vehicle') {
      expect(html).toContain('Ford Fiesta');
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      const photo = parsed.querySelector<HTMLImageElement>('img.gallery-photo');
      expect(photo).not.toBeNull();
      expect(photo?.getAttribute('src')).toBe('https://photos.example.test/front.jpg');
      expect(photo?.style.opacity).toBe('1');
      expect(photo?.getAttribute('loading')).toBe('eager');
      expect(html).not.toContain('Loading photo');
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(getStorage).not.toHaveBeenCalled();
    expect(setStorage).not.toHaveBeenCalled();
    expect(events).not.toHaveBeenCalled();
    expect(document.title).toBe(title);
    expect(document.body.getAttribute('style')).toBe(body);
  });

  it('honours actual featured order, service switches and responsive search markup', () => {
    const settings = draft();
    const input = { settings, stock, features, page: 'home' as const };
    const phone = new DOMParser().parseFromString(renderCustomerPagePreview({ ...input, viewportWidth: 390 }), 'text/html');
    const desktop = new DOMParser().parseFromString(renderCustomerPagePreview({ ...input, viewportWidth: 1440 }), 'text/html');
    expect(phone.querySelector('.hero-search-primary-fields [aria-label="Search model"]')).toBeNull();
    expect(desktop.querySelector('.hero-search-primary-fields [aria-label="Search model"]')).not.toBeNull();
    const stockLinks = Array.from(phone.querySelectorAll('a[href^="/vehicle/"]'));
    expect(stockLinks[0]?.getAttribute('href')).toBe('/vehicle/two');
    expect(phone.body.textContent).toContain('Draft warranty cover');
    settings.warranty.enabled = false;
    expect(renderCustomerPagePreview({ ...input, viewportWidth: 820 })).not.toContain('Draft warranty cover');
  });

  it('does not invent platform access or serialize other settings/cache fields', () => {
    const settings = Object.assign(draft(), { apiKey: 'PRIVATE-MUST-NOT-APPEAR' });
    const html = renderCustomerPagePreview({ settings, stock, features: { ...features, features: { ...features.features, partExchange: false } }, page: 'home', viewportWidth: 820 });
    expect(html).not.toContain('PRIVATE-MUST-NOT-APPEAR');
    expect(html).not.toContain('Value my car');
  });
});

it('removes navigation, scripts, embeds and form actions in a script-free document', () => {
  const document = customerPreviewDocument('<a href="https://example.test" target="_blank" onclick="send()">Link</a><form action="/send"><input autofocus name="customer"><button formaction="/send">Send</button><select><option>Choice</option></select></form><script>send()</script><iframe src="https://example.test"></iframe><video autoplay src="https://example.test/a.mp4"></video>', 'body{color:navy}');
  const parsed = new DOMParser().parseFromString(document, 'text/html');
  expect(parsed.querySelectorAll('script,iframe,video,[href],[action],[formaction],[onclick],[autofocus]')).toHaveLength(0);
  expect(parsed.querySelectorAll('input:disabled,button:disabled,select:disabled')).toHaveLength(3);
  expect(parsed.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')).toContain("connect-src 'none'");
  expect(parsed.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')).toContain("form-action 'none'");
});

it('preserves native information disclosures and visible horizontal overflow without enabling actions', () => {
  const document = customerPreviewDocument('<details><summary>Specifications</summary><p>Full vehicle information</p><a href="/contact">Contact us</a><button>Send</button></details>', '');
  const parsed = new DOMParser().parseFromString(document, 'text/html');
  const summary = parsed.querySelector('summary');
  expect(summary).not.toBeNull();
  expect(summary?.hasAttribute('aria-disabled')).toBe(false);
  expect(summary?.hasAttribute('disabled')).toBe(false);
  expect(summary?.hasAttribute('tabindex')).toBe(false);
  expect(parsed.querySelector('details p')?.textContent).toBe('Full vehicle information');
  expect(parsed.querySelector('button')?.hasAttribute('disabled')).toBe(true);
  expect(parsed.querySelector('a')?.hasAttribute('href')).toBe(false);
  expect(document).not.toContain('body{overflow-x:hidden}');
  expect(document).not.toContain('textarea,summary{pointer-events:none');
});
