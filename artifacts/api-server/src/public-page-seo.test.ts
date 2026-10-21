import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPublicPageSeo, publicSeoOrigin, renderPublicPageSeo, type PublicSeoVehicle } from './lib/public-page-seo';
import { serveFrontend } from './lib/serve-frontend';
import { runWithTenant, type TenantContext } from './lib/tenant-context';

const origin = 'https://dealer.example.test';
const settings = { identity: { name: 'Example Motors', logoAsset: '/brand/logo.svg' }, address: { street: '10 High Street', city: 'Wembley', postcode: 'HA0 1AA' }, contact: { phone: '02000000000', email: 'sales@example.test' }, hours: [{ days: 'Sunday', times: 'Unknown' }], privateCredential: 'DO-NOT-EXPOSE', reviews: [{ rating: 5, text: 'not independently verified' }] };
const vehicle: PublicSeoVehicle = { id: 'car-one', title: 'Toyota AYGO', make: 'Toyota', model: 'AYGO', year: 2017, price: 4750, currency: 'GBP', mileage: 40000, fuel: 'Petrol', transmission: 'Manual', heroImage: 'https://images.example.test/front.jpg', inventoryStatus: 'available', writeOffCategory: 'N', specifications: { description: 'Original advert description. Category N.' }, sourceExtras: { privateNote: 'PRIVATE-NOTE' } };
const shell = '<!doctype html><html><head><title>Wrong fallback</title><meta name="description" content="fallback"><meta property="og:image" content="https://wrong.example/a.jpg"><link rel="canonical" href="https://wrong.example/"><script type="module" src="/assets/main.js"></script></head><body><div id="root"></div></body></html>';
const seo = (pathname: string, extra: object = {}) => buildPublicPageSeo({ pathname, canonicalOrigin: origin, settings, ...extra });

test('stable public routes have route-specific, canonical, query-free metadata', () => {
  assert.match(seo('/').title, /Used cars for sale in Wembley/);
  assert.equal(seo('/stock').title, 'Browse Stock | Example Motors');
  assert.match(seo('/contact').description, /opening hours/);
  assert.match(seo('/warranty').title, /^Warranty information/);
  assert.equal(seo('/index.html').canonical, `${origin}/`);
  assert.equal(seo('/stock/').canonical, `${origin}/stock`);
  assert.equal(seo('/stock').robots, 'index, follow');
  assert.equal(seo('/').image, `${origin}/brand/logo.svg`);
});
test('canonical origins reject paths, credentials, ports, non-HTTPS and untrusted forms', () => {
  for (const value of ['http://dealer.test', 'https://user:pass@dealer.test', 'https://dealer.test/path', 'https://dealer.test?x=1', 'https://dealer.test:4000', '//dealer.test', 'https://localhost']) assert.equal(publicSeoOrigin(value), null);
  assert.equal(publicSeoOrigin('https://dealer.example.test/'), origin);
  assert.equal(seo('/', { canonicalOrigin: 'javascript:alert(1)' }).canonical, null);
});
test('vehicle uses public price, image, mileage and recorded category without private data or ratings', () => {
  const result = seo('/vehicle/car-one', { vehicle });
  assert.equal(result.status, 200); assert.match(result.title, /£4,750/);
  assert.equal(result.image, vehicle.heroImage); assert.equal(result.canonical, `${origin}/vehicle/car-one`);
  const car = result.structuredData.find(value => value['@type'] === 'Car')!;
  assert.equal(car.description, (vehicle.specifications as Record<string, unknown>)?.description);
  assert.deepEqual(car.mileageFromOdometer, { '@type': 'QuantitativeValue', value: 40000, unitCode: 'SMI' });
  assert.equal((car.offers as Record<string, unknown>).availability, 'https://schema.org/InStock');
  const json = JSON.stringify(result); assert.doesNotMatch(json, /DO-NOT-EXPOSE|PRIVATE-NOTE|aggregateRating|review|vehicleIdentificationNumber/);
  const crumbs = result.structuredData.find(value => value['@type'] === 'BreadcrumbList')!;
  assert.equal((crumbs.itemListElement as unknown[]).length, 3);
});
test('reserved, unavailable and missing prices never claim immediate stock or invent a price', () => {
  const reserved = seo('/vehicle/car-one', { vehicle: { ...vehicle, inventoryStatus: 'reserved' } });
  assert.equal((reserved.structuredData.find(value => value['@type'] === 'Car')!.offers as Record<string, unknown>).availability, 'https://schema.org/Reserved');
  for (const price of [null, 0, -1, Number.NaN]) {
    const value = seo('/vehicle/car-one', { vehicle: { ...vehicle, price } });
    assert.equal(value.structuredData.find(value => value['@type'] === 'Car')?.offers, undefined);
  }
  for (const status of ['sold', 'hidden', 'archived']) assert.equal(seo('/vehicle/car-one', { vehicle: { ...vehicle, inventoryStatus: status } }).status, 404);
  assert.equal(seo('/vehicle/missing').status, 404);
  assert.equal(seo('/vehicle/missing').canonical, null);
});
test('dealer schema excludes unknown/sample location, absent contacts, invented hours and ratings', () => {
  const result = seo('/', { settings: { identity: { name: 'Dealer' }, address: { street: 'Sample Street', city: 'Exampletown' }, hours: [{ days: 'Monday', times: 'By appointment' }] } });
  const dealer = result.structuredData[0]; assert.equal(dealer['@type'], 'AutoDealer');
  for (const property of ['address', 'telephone', 'email', 'openingHours', 'openingHoursSpecification', 'geo', 'aggregateRating']) assert.equal(dealer[property], undefined);
});
test('opening hours only use confirmed simple ranges and explicit closure, leaving unknown days absent', () => {
  const result = seo('/', { settings: { ...settings, hours: [{ days: 'Monday - Saturday', times: '8am - 6pm' }, { days: 'Sunday', times: 'Closed' }] } });
  assert.deepEqual(result.structuredData[0].openingHoursSpecification, [
    { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(day => `https://schema.org/${day}`), opens: '08:00', closes: '18:00' },
    { '@type': 'OpeningHoursSpecification', dayOfWeek: ['https://schema.org/Sunday'], opens: '00:00', closes: '00:00' },
  ]);
  for (const times of ['By appointment', 'Unknown', '09:00 - 12:00, 13:00 - 17:00', '22:00 - 03:00', '25:00 - 26:00']) assert.equal(seo('/', { settings: { ...settings, hours: [{ days: 'Monday', times }] } }).structuredData[0].openingHoursSpecification, undefined);
  assert.equal(seo('/', { settings: { ...settings, hours: [{ days: 'Monday', times: '08:00 - 18:00' }, { days: 'Monday', times: 'Closed' }] } }).structuredData[0].openingHoursSpecification, undefined);
});
test('private/capability routes and demos remain noindex and emit no structured data', () => {
  for (const path of ['/portal', '/platform', '/my-purchase/private-token', '/viewing/private-token', '/enquire', '/saved', '/unknown']) {
    const result = seo(path); assert.match(result.robots, /^noindex/); assert.equal(result.canonical, null); assert.deepEqual(result.structuredData, []);
  }
  const demo = seo('/vehicle/car-one', { vehicle, demo: true });
  assert.match(demo.robots, /^noindex/); assert.deepEqual(demo.structuredData, []);
});
test('markup replaces owned metadata exactly once and hostile text cannot escape JSON or HTML', () => {
  const hostile = '</script><script>alert("x")</script> & </title>';
  const result = seo('/vehicle/car-one', { settings: { ...settings, identity: { name: hostile } }, vehicle: { ...vehicle, specifications: { description: hostile } } });
  const first = renderPublicPageSeo(shell, result), second = renderPublicPageSeo(first, result);
  assert.equal(second, first); assert.equal((first.match(/<title>/g) ?? []).length, 1);
  assert.equal((first.match(/rel="canonical"/g) ?? []).length, 1);
  assert.equal((first.match(/type="application\/ld\+json"/g) ?? []).length, 1);
  assert.doesNotMatch(first, /<script>alert/); assert.doesNotMatch(first, /wrong\.example/);
  const json = first.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/)![1];
  assert.equal(JSON.parse(json)['@graph'][0].name, hostile);
  assert.ok(first.includes('<body><div id="root"></div></body>'));
  assert.ok(first.includes('src="/assets/main.js"'));
});
test('head rendering preserves body SVG titles, metadata and scripts for the independent SSR renderer', () => {
  const body = '<body><svg><title>Accessible car icon</title></svg><script type="application/json">{"public":"body data"}</script></body>';
  const page = shell.replace('<body><div id="root"></div></body>', body);
  assert.ok(renderPublicPageSeo(page, seo('/')).includes(body));
});
test('HTTP metadata reads tenant data for each request, fresh prices, correct 404s, and no private lookup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'luxxy-seo-'));
  await writeFile(join(directory, 'index.html'), shell);
  let price = 4750; const lookups: string[] = [];
  const app = express();
  app.use((req, _res, next) => {
    const dealerId = req.get('x-test-dealer') || 'dealer-one';
    const tenant: TenantContext = { dealerId, canonicalOrigin: dealerId === 'dealer-two' ? 'https://second.example.test' : origin, platform: 'autotrader', retailerId: 'fictional', sourceUrl: 'https://market.example.test', demo: dealerId === 'demo' };
    runWithTenant(tenant, next);
  });
  serveFrontend(app, directory, { loadPageData: async (path, tenant) => {
    lookups.push(`${tenant!.dealerId}:${path}`);
    return { settings: { ...settings, identity: { name: tenant!.dealerId } }, vehicle: tenant!.dealerId === 'dealer-one' && path === '/vehicle/car-one' ? { ...vehicle, price } : null };
  } });
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    let response = await fetch(`${base}/vehicle/car-one?tracking=secret`), html = await response.text();
    assert.equal(response.status, 200); assert.match(html, /£4,750/); assert.match(html, /https:\/\/dealer\.example\.test\/vehicle\/car-one/); assert.doesNotMatch(html, /tracking=secret/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    price = 4500; html = await (await fetch(`${base}/vehicle/car-one`)).text(); assert.match(html, /£4,500/); assert.doesNotMatch(html, /£4,750/);
    response = await fetch(`${base}/vehicle/car-one`, { headers: { 'x-test-dealer': 'dealer-two' } }); html = await response.text();
    assert.equal(response.status, 404); assert.doesNotMatch(html, /Toyota|4,500|4,750/); assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
    response = await fetch(`${base}/stock`, { headers: { 'x-test-dealer': 'dealer-two' } }); html = await response.text(); assert.match(html, /https:\/\/second\.example\.test\/stock/); assert.doesNotMatch(html, /https:\/\/dealer\.example\.test/);
    const before = lookups.length; response = await fetch(`${base}/my-purchase/private-token`); html = await response.text(); assert.equal(lookups.length, before); assert.doesNotMatch(html, /private-token|application\/ld\+json/);
    response = await fetch(`${base}/stock`, { headers: { 'x-test-dealer': 'demo' } }); html = await response.text(); assert.match(response.headers.get('x-robots-tag')!, /noindex/); assert.doesNotMatch(html, /application\/ld\+json/);
    response = await fetch(`${base}/assets/missing.js`); assert.equal(response.status, 404); assert.doesNotMatch(await response.text(), /<html/);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); await rm(directory, { recursive: true, force: true }); }
});
