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
  });
});

describe('showroomPageMeta and enquiryPageMeta', () => {
  it('names the town and the stock count on the showroom', () => {
    const meta = showroomPageMeta(dealer, { count: 31 });

    expect(meta.title).toBe('Used cars for sale in Harrow | Luxxy Motors');
    expect(meta.description).toContain('31 used cars');
  });

  it('names the vehicle being enquired about', () => {
    const meta = enquiryPageMeta(dealer, { heading: 'Book a test drive', vehicleName: 'Ford Fiesta' });

    expect(meta.title).toBe('Book a test drive: Ford Fiesta | Luxxy Motors');
    expect(meta.description).toContain('Ford Fiesta');
  });
});

describe('applyPageMeta', () => {
  beforeEach(() => {
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
});
