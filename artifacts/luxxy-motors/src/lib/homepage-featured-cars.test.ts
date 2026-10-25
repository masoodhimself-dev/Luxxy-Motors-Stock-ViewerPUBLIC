import { describe, expect, it } from 'vitest';
import type { Car } from './stock-context';
import { homepageFeaturedCars } from './homepage-featured-cars';

const car = (id: string, overrides: Partial<Car> = {}): Car => ({
  id,
  title: `Example ${id}`,
  price: 10000,
  currency: 'GBP',
  inventoryStatus: 'available',
  heroImage: `https://photos.example.test/${id}.jpg`,
  images: [],
  sourceExtras: null,
  ...overrides,
}) as Car;
const ids = (cars: readonly Car[]) => cars.map(item => item.id);

describe('homepage featured cars', () => {
  it('starts with the most expensive photographed available car and introduces lower and middle prices', () => {
    const cars = [4, 2, 9, 6, 1, 8, 3, 5, 7].map(value => car(`price-${value}`, { price: value * 10000 }));
    const featured = homepageFeaturedCars(cars);
    expect(ids(featured).slice(0, 3)).toEqual(['price-9', 'price-1', 'price-5']);
    expect(new Set(ids(featured))).toEqual(new Set(ids(cars)));
    expect(featured).toHaveLength(cars.length);
  });

  it('uses the next suitable car when the highest-priced car has no photo', () => {
    expect(ids(homepageFeaturedCars([
      car('no-photo', { price: 90000, heroImage: null }),
      car('middle', { price: 10000 }),
      car('best-photo', { price: 50000 }),
      car('reserved', { price: 100000, inventoryStatus: 'reserved' }),
    ]))).toEqual(['best-photo', 'middle']);
  });

  it('keeps staff selections first in their chosen order and ignores duplicates or stale IDs', () => {
    const cars = [car('expensive', { price: 50000 }), car('staff-second'), car('staff-first', { price: 5000 }), car('other', { price: 20000 })];
    const featured = homepageFeaturedCars(cars, ['staff-first', 'stale', 'staff-second', 'staff-first']);
    expect(ids(featured).slice(0, 2)).toEqual(['staff-first', 'staff-second']);
    expect(ids(featured).slice(2)).toEqual(['expensive', 'other']);
    expect(featured).toHaveLength(4);
  });

  it('retains manual cars without a photo or advertised price', () => {
    const noPhoto = car('manual-no-photo', { price: 5000, heroImage: null });
    const noPrice = car('manual-poa', { price: null, heroImage: null });
    expect(ids(homepageFeaturedCars([car('automatic'), noPhoto, noPrice], ['manual-poa', 'manual-no-photo']))).toEqual([
      'manual-poa', 'manual-no-photo', 'automatic',
    ]);
  });

  it('keeps manually selected reserved stock last and never adds reserved stock automatically', () => {
    const cars = [
      car('reserved-first', { inventoryStatus: 'reserved', price: 90000 }),
      car('available-manual', { price: 5000 }),
      car('automatic', { price: 20000 }),
      car('reserved-second', { inventoryStatus: 'reserved' }),
      car('reserved-unselected', { inventoryStatus: 'reserved', price: 100000 }),
    ];
    expect(ids(homepageFeaturedCars(cars, ['reserved-second', 'available-manual', 'reserved-first']))).toEqual([
      'available-manual', 'automatic', 'reserved-second', 'reserved-first',
    ]);
  });

  it.each(['sold', 'hidden', 'archived', 'withdrawn'])('excludes %s cars even when staff selected them', inventoryStatus => {
    const unavailable = car('unavailable', { inventoryStatus, price: 100000 });
    expect(ids(homepageFeaturedCars([unavailable, car('available')], ['unavailable']))).toEqual(['available']);
  });

  it.each([undefined, null, ''])('accepts legacy availability %s for automatic selection', inventoryStatus => {
    expect(ids(homepageFeaturedCars([car('legacy', { inventoryStatus }), car('lower', { price: 5000 })]))).toEqual(['legacy', 'lower']);
  });

  it.each([
    { sourceStatus: 'missing' },
    { sourceStatus: 'withdrawn' },
    { sourceExtras: { websiteSourceStatus: 'missing' } },
    { sourceExtras: { websiteSourceStatus: 'withdrawn' } },
  ])('does not automatically promote explicitly missing or withdrawn source stock: %j', source => {
    expect(ids(homepageFeaturedCars([car('missing', { price: 100000, ...source }), car('available')]))).toEqual(['available']);
  });

  it('preserves a staff choice still present in public stock during a missing-source review', () => {
    const staffChoice = car('staff-choice', { sourceExtras: { websiteSourceStatus: 'missing' } });
    expect(ids(homepageFeaturedCars([car('automatic', { price: 20000 }), staffChoice], ['staff-choice']))).toEqual(['staff-choice', 'automatic']);
  });

  it.each([
    'https://photos.example.test/placeholder.jpg',
    'https://photos.example.test/no-image.svg',
    'https://photos.example.test/no_photo.png',
    '/assets/image-not-available.png',
    'javascript:alert(1)',
    'data:image/svg+xml,<svg></svg>',
    '   ',
  ])('does not treat an unusable or placeholder thumbnail as a vehicle photo: %s', heroImage => {
    expect(ids(homepageFeaturedCars([car('bad-thumbnail', { price: 100000, heroImage }), car('available')]))).toEqual(['available']);
  });

  it.each([
    'https://photos.example.test/front.jpg',
    'http://photos.example.test/front.jpg',
    '/assets/vehicle-front.jpg',
    './assets/vehicle-front.jpg',
  ])('accepts an ordinary supplied photo URL without fetching it: %s', heroImage => {
    expect(ids(homepageFeaturedCars([car('photographed', { heroImage })]))).toEqual(['photographed']);
  });

  it('uses the existing gallery thumbnail fallback for both string and object images', () => {
    const first = car('string-photo', { heroImage: null, price: 20000, images: ['https://photos.example.test/string.jpg'] });
    const second = car('object-photo', { heroImage: null, images: [{ url: '/assets/side.jpg', caption: 'Exterior side' }] });
    expect(ids(homepageFeaturedCars([second, first]))).toEqual(['string-photo', 'object-photo']);
  });

  it('does not assume a positive image count means a usable photo exists', () => {
    expect(homepageFeaturedCars([car('count-only', { heroImage: null, imageCount: 20, images: [] })])).toEqual([]);
  });

  it('appends photo cars with unknown or invalid prices in stable input order', () => {
    const cars = [
      car('poa', { price: null }),
      car('negative', { price: -1000 }),
      car('priced-low', { price: 5000 }),
      car('zero', { price: 0 }),
      car('not-a-number', { price: Number.NaN }),
      car('priced-high', { price: 20000 }),
      car('infinite', { price: Number.POSITIVE_INFINITY }),
    ];
    expect(ids(homepageFeaturedCars(cars))).toEqual(['priced-high', 'priced-low', 'poa', 'negative', 'zero', 'not-a-number', 'infinite']);
  });

  it('preserves input order when all photographed cars have the same price', () => {
    const cars = ['first', 'second', 'third', 'fourth', 'fifth'].map(id => car(id));
    expect(ids(homepageFeaturedCars(cars))).toEqual(ids(cars));
    expect(ids(homepageFeaturedCars(cars))).toEqual(ids(homepageFeaturedCars(cars)));
  });

  it('retains source order within equal-price groups while mixing price ranges', () => {
    const cars = [
      car('high-first', { price: 30000 }), car('low-first', { price: 5000 }),
      car('high-second', { price: 30000 }), car('middle-first', { price: 15000 }),
      car('low-second', { price: 5000 }), car('middle-second', { price: 15000 }),
    ];
    const featured = ids(homepageFeaturedCars(cars));
    expect(featured[0]).toBe('high-first');
    for (const group of ['high', 'low', 'middle']) {
      expect(featured.indexOf(`${group}-first`)).toBeLessThan(featured.indexOf(`${group}-second`));
    }
    expect(featured).toHaveLength(cars.length);
  });

  it('does not mutate stock records, the supplied stock array or manual choices', () => {
    const first = Object.freeze(car('first', { price: 10000 }));
    const second = Object.freeze(car('second', { price: 20000 }));
    const cars = Object.freeze([first, second]);
    const manual = Object.freeze(['first', 'first']);
    const featured = homepageFeaturedCars(cars, manual);
    expect(cars).toEqual([first, second]);
    expect(manual).toEqual(['first', 'first']);
    expect(featured).not.toBe(cars);
    expect(featured[0]).toBe(first);
    expect(featured[1]).toBe(second);
  });

  it('handles empty stock and stock without any eligible automatic or manual choices', () => {
    expect(homepageFeaturedCars([])).toEqual([]);
    expect(homepageFeaturedCars([car('no-photo', { heroImage: null }), car('reserved', { inventoryStatus: 'reserved' })])).toEqual([]);
  });
});
