import { afterEach, expect, it } from 'vitest';
import { publicDealershipOrigin } from './public-dealership-url';
import { getVehicleShareUrl } from './cta-helpers';
import { shortlistUrl } from './customer-convenience';
import type { Car } from './stock-context';

const live = 'https://multichoicemotors.co.uk';
const demo = 'https://multi-choice-motors-cazoo-test.demo.luxxyexmaplenumber2.uk';
const documentAt = (current: string, configured?: string) => ({
  querySelector: () => configured ? { content: configured } : null,
  location: { origin: current },
}) as unknown as Document;

afterEach(() => document.querySelectorAll('[data-origin-test]').forEach(element => element.remove()));

it.each([demo, 'https://www.multichoicemotors.co.uk', 'http://127.0.0.1:4285', 'http://192.168.1.24:4286', 'https://luxxy-shared-staging.onrender.com'])('uses the verified live domain for new links while visiting %s', current => {
  expect(publicDealershipOrigin(documentAt(current, live))).toBe(live);
});

it.each([demo, 'https://luxxy-shared-staging.onrender.com'])('recovers a live domain from stale demo or hosted-preview metadata %s', configured => {
  expect(publicDealershipOrigin(documentAt(live, configured))).toBe(live);
});

it('keeps a genuine demo target for demos and local previews instead of inventing a live domain', () => {
  expect(publicDealershipOrigin(documentAt(demo, demo))).toBe(demo);
  expect(publicDealershipOrigin(documentAt('http://localhost:4285', demo))).toBe(demo);
});

it.each(['https://other.uk/path', 'https://other.uk/?token=secret', 'https://other.uk/#private', 'https://user:secret@other.uk', 'http://other.uk', 'invalid'])('does not use malformed or capability-bearing configured origins: %s', configured => {
  expect(publicDealershipOrigin(documentAt(live, configured))).toBe(live);
});

it('uses the same configured public domain for vehicle and shortlist sharing', () => {
  const meta = document.createElement('meta');
  meta.name = 'luxxy-canonical-origin'; meta.content = live;
  meta.setAttribute('data-page-meta', ''); meta.setAttribute('data-origin-test', ''); document.head.append(meta);
  expect(getVehicleShareUrl({ id: 'actual-vehicle' } as Car)).toBe(`${live}/share/vehicle/actual-vehicle`);
  expect(shortlistUrl(['actual-vehicle'])).toBe(`${live}/saved?cars=actual-vehicle`);
});
