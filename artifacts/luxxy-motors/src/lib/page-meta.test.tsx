import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyPageMeta,
  DEFAULT_PAGE_META,
  enquiryPageMeta,
  resetPageMeta,
  showroomPageMeta,
  vehiclePageMeta,
} from '@/lib/page-meta';
import type { Car } from '@/lib/stock-context';

const dealer = {
  identity: { name: 'Luxxy Motors' },
  address: { city: 'Harrow', region: 'London' },
};

const car = {
  id: 'fiesta-1',
  title: 'Ford Fiesta',
  variant: '1.4 Zetec 5dr',
  make: 'Ford',
  model: 'Fiesta',
  year: 2009,
  price: 4995,
  currency: 'GBP',
  mileage: 90000,
  fuel: 'Petrol',
  transmission: 'Manual',
  heroImage: 'https://cdn.example.com/fiesta-front.jpg',
  images: [{ url: 'https://cdn.example.com/fiesta-interior.jpg', caption: 'Interior' }],
} as unknown as Car;

function content(selector: string) {
  const element = document.head.querySelector(selector);
  return element?.getAttribute('content') ?? element?.getAttribute('href') ?? null;
}

describe('vehiclePageMeta', () => {
  it('describes the vehicle by year, make, model, price and mileage', () => {
    const meta = vehiclePageMeta(car, dealer);

    expect(meta.title).toBe('2009 Ford Fiesta — £4,995 | Luxxy Motors');
    expect(meta.description).toContain('2009 Ford Fiesta 1.4 Zetec 5dr');
    expect(meta.description).toContain('Luxxy Motors, Harrow');
    expect(meta.description).toContain('£4,995');
    expect(meta.description).toContain('90,000 miles');
    expect(meta.image).toBe('https://cdn.example.com/fiesta-front.jpg');
  });

  it('falls back to the first photograph when no hero is set', () => {
    const meta = vehiclePageMeta({ ...car, heroImage: null } as Car, dealer);
    expect(meta.image).toBe('https://cdn.example.com/fiesta-interior.jpg');
  });

  it('does not invent a price when the vehicle has none', () => {
    const meta = vehiclePageMeta({ ...car, price: null } as unknown as Car, dealer);

    expect(meta.title).toBe('2009 Ford Fiesta — Price on application | Luxxy Motors');
    expect(meta.description).not.toContain('£');
    expect(meta.description).not.toMatch(/appointment|delivery/i);
  });
});

describe('showroomPageMeta and enquiryPageMeta', () => {
  it('names the town and the stock count on the showroom', () => {
    const meta = showroomPageMeta(dealer, { count: 31 });

    expect(meta.title).toBe('Used cars for sale in Harrow | Luxxy Motors');
    expect(meta.description).toContain('31 used cars');
    expect(meta.description).not.toMatch(/delivery|appointment/i);
  });

  it('names the vehicle being enquired about', () => {
    const meta = enquiryPageMeta(dealer, { heading: 'Book a Test Drive', vehicleName: 'Ford Fiesta' });

    expect(meta.title).toBe('Book a Test Drive: Ford Fiesta | Luxxy Motors');
    expect(meta.description).toContain('Ford Fiesta');
  });
});

describe('applyPageMeta', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
    document.head.querySelectorAll('[data-public-page-seo]').forEach(element => element.remove());
    document.head.querySelectorAll('[data-page-meta]').forEach((element) => element.remove());
    resetPageMeta();
  });

  it('writes title, description, canonical and social tags', () => {
    applyPageMeta(vehiclePageMeta(car, dealer));

    expect(document.title).toBe('2009 Ford Fiesta — £4,995 | Luxxy Motors');
    expect(content('meta[name="description"]')).toContain('2009 Ford Fiesta');
    expect(content('meta[property="og:title"]')).toBe('2009 Ford Fiesta — £4,995 | Luxxy Motors');
    expect(content('meta[property="og:image"]')).toBe('https://cdn.example.com/fiesta-front.jpg');
    expect(content('meta[property="og:type"]')).toBe('article');
    expect(content('meta[name="twitter:card"]')).toBe('summary_large_image');
    expect(content('meta[name="twitter:image"]')).toBe('https://cdn.example.com/fiesta-front.jpg');
    expect(content('link[rel="canonical"]')).toBe(`${window.location.origin}${window.location.pathname}`);
  });

  it('resolves a relative preview image against the current origin', () => {
    applyPageMeta({ ...vehiclePageMeta(car, dealer), image: '/uploads/hero.jpg' });

    expect(content('meta[property="og:image"]')).toBe(`${window.location.origin}/uploads/hero.jpg`);
  });

  it('drops the vehicle photograph when the showroom defaults come back', () => {
    applyPageMeta(vehiclePageMeta(car, dealer));
    resetPageMeta();

    expect(document.title).toBe(DEFAULT_PAGE_META.title);
    expect(content('meta[property="og:image"]')).toBeNull();
    expect(content('meta[name="twitter:card"]')).toBe('summary');
    expect(content('meta[property="og:type"]')).toBe('website');
  });
  it('retains the configured canonical origin on an alias and drops filter and tracking queries', () => {
    const canonical = document.createElement('meta'); canonical.name = 'luxxy-canonical-origin'; canonical.content = 'https://preferred.example.test'; canonical.setAttribute('data-page-meta', ''); document.head.append(canonical);
    window.history.replaceState({}, '', '/stock?make=Toyota&tracking=private');
    applyPageMeta({ ...showroomPageMeta(dealer), url: 'https://untrusted.example/stock?tracking=private' });
    expect(content('link[rel="canonical"]')).toBe('https://preferred.example.test/stock');
    expect(content('meta[property="og:url"]')).toBe('https://preferred.example.test/stock');
  });

  it('keeps initial JSON-LD on the same car and removes it when navigating to a different page', () => {
    const script = document.createElement('script'); script.type = 'application/ld+json'; script.setAttribute('data-public-page-seo', '/vehicle/first'); script.textContent = '{"@type":"Car","name":"first"}'; document.head.append(script);
    window.history.replaceState({}, '', '/vehicle/first'); applyPageMeta(vehiclePageMeta(car, dealer));
    expect(script.isConnected).toBe(true);
    window.history.replaceState({}, '', '/vehicle/second'); applyPageMeta(vehiclePageMeta(car, dealer));
    expect(script.isConnected).toBe(false);
  });

  it('never gives a private capability URL a canonical and restores public indexing only on live sites', () => {
    const indexing = document.createElement('meta'); indexing.name = 'luxxy-site-indexing'; indexing.content = 'index'; indexing.setAttribute('data-page-meta', ''); document.head.append(indexing);
    window.history.replaceState({}, '', '/viewing/private-token'); applyPageMeta(showroomPageMeta(dealer));
    expect(content('link[rel="canonical"]')).toBeNull(); expect(content('meta[property="og:url"]')).toBeNull(); expect(content('meta[name="robots"]')).toMatch(/^noindex/);
    window.history.replaceState({}, '', '/stock'); applyPageMeta(showroomPageMeta(dealer));
    expect(content('meta[name="robots"]')).toBe('index, follow');
    indexing.content = 'noindex'; applyPageMeta(showroomPageMeta(dealer)); expect(content('meta[name="robots"]')).toMatch(/^noindex/);
  });

  it('excludes an unavailable vehicle reached through SPA navigation even on a live site', () => {
    const indexing = document.createElement('meta'); indexing.name = 'luxxy-site-indexing'; indexing.content = 'index'; indexing.setAttribute('data-page-meta', ''); document.head.append(indexing);
    const script = document.createElement('script'); script.type = 'application/ld+json'; script.setAttribute('data-public-page-seo', '/vehicle/missing'); document.head.append(script);
    window.history.replaceState({}, '', '/vehicle/missing');
    applyPageMeta({ title: 'Vehicle not in stock', description: 'Browse our current cars.', indexable: false });
    expect(content('link[rel="canonical"]')).toBeNull();
    expect(content('meta[property="og:url"]')).toBeNull();
    expect(content('meta[name="robots"]')).toMatch(/^noindex/);
    expect(script.isConnected).toBe(false);
    window.history.replaceState({}, '', '/stock'); applyPageMeta(showroomPageMeta(dealer));
    expect(content('meta[name="robots"]')).toBe('index, follow');
  });

});
