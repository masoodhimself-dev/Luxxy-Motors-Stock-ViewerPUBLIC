import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDemoReview, type DemoReviewInput, type DemoReviewVehicleSource } from '@workspace/vehicle-meta';

const dealer: DemoReviewInput['dealer'] = { id: 'demo-example', name: 'Example Cars', platform: 'autotrader', sourceUrl: 'https://www.autotrader.co.uk/dealers/example-12345', status: 'draft', expiresAt: '2030-12-01T00:00:00Z', revision: 0 };
const car: DemoReviewVehicleSource = { id: 'car-one', advertId: 'ad-one', make: 'Toyota', model: 'Yaris', year: 2024, price: 12000, mileage: 0, fuel: 'Petrol', transmission: 'Manual', registration: '2024 (24 reg)', plate: 'AB24CDE', description: 'The original advert description.', images: [{ url: 'https://photos.example.test/car.jpg' }] };
const input: DemoReviewInput = { dealer, config: {}, vehicles: [car], now: '2026-11-18T12:00:00Z' };

test('demo review uses saved facts and accepts zero mileage and real plates over registration bands', () => {
  const result = buildDemoReview(input);
  assert.equal(result.stock.completeCount, 1);
  assert.deepEqual(result.stock.vehicles[0].missingFields, []);
  assert.equal(result.stock.vehicles[0].registration, 'AB24CDE');
  assert.equal(result.preview.allowed, true);
  assert.equal(result.stock.expectedCount, null);
  assert.equal(result.stock.countMatches, null);
  assert.deepEqual(result.details.missingFields, ['Logo', 'Phone number', 'Email address', 'Showroom address', 'Opening hours']);
  const incomplete = buildDemoReview({ ...input, vehicles: [{ ...car, plate: null }] });
  assert.deepEqual(incomplete.stock.vehicles[0].missingFields, ['Registration']);
});

test('missing, sentinel and generated descriptions are reported without demanding optional vehicle details', () => {
  const result = buildDemoReview({ ...input, vehicles: [{ id: 'empty', title: 'Used car', make: 'Unknown', model: 'N/A', year: null, price: 0, mileage: null, fuel: 'Not supplied', transmission: 'TBC', registration: '2024 (24 reg)', sourceExtras: { descriptionOrigin: 'generated-facts', description: 'Generated sales copy.' } }] });
  assert.deepEqual(result.stock.vehicles[0].missingFields, ['Vehicle name', 'Year', 'Price', 'Mileage', 'Fuel type', 'Gearbox', 'Registration', 'Advert description']);
  assert.equal(result.stock.noPhotosCount, 1);
  assert.equal(result.stock.completeCount, 0);
  const titleOnly = buildDemoReview({ ...input, vehicles: [{ ...car, make: null, model: null, title: 'Toyota Yaris 1.5 Hybrid', description: null, sourceExtras: { descriptionOrigin: 'staff-reviewed', description: 'Revised', originalAdvertDescriptions: ['Original description'] } }] });
  assert.deepEqual(titleOnly.stock.vehicles[0].missingFields, []);
});

test('photo totals count distinct saved HTTP links and use a hero without a gallery', () => {
  const result = buildDemoReview({ ...input, vehicles: [{ ...car, heroImage: 'https://photos.example.test/car.jpg', images: [
    { url: 'https://photos.example.test/car.jpg' }, { url: ' https://photos.example.test/car.jpg ' },
    { url: 'https://photos.example.test/car-2.jpg' }, { url: 'javascript:alert(1)' }, { url: 'data:image/jpeg;base64,x' },
    { url: 'https://secret@photos.example.test/private.jpg' },
  ] }, { ...car, id: 'hero-only', images: [], heroImage: 'http://photos.example.test/hero.jpg' }] });
  assert.equal(result.stock.photosCount, 3);
  assert.equal(result.stock.vehicles[0].photoCount, 2);
  assert.equal(result.stock.vehicles[1].photoCount, 1);
  assert.equal(result.stock.noPhotosCount, 0);
});

test('expired and inactive demos can be reviewed while preview eligibility matches private preview', () => {
  for (const status of ['draft', 'active']) assert.equal(buildDemoReview({ ...input, dealer: { ...dealer, status } }).preview.allowed, true);
  assert.equal(buildDemoReview({ ...input, dealer: { ...dealer, status: 'suspended' } }).preview.allowed, false);
  const result = buildDemoReview({ ...input, dealer: { ...dealer, expiresAt: '2026-11-17T00:00:00Z' }, latestImport: { expectedCount: 2, scrapedAt: '2026-11-18T10:00:00Z', receivedAt: '2026-11-18T10:00:02Z' } });
  assert.equal(result.preview.allowed, false);
  assert.match(result.preview.reason!, /expired/);
  assert.equal(result.stock.countMatches, false);
  assert.equal(result.stock.collectedAt, '2026-11-18T10:00:00Z');
});

test('effective logo and published details win over retained import metadata without mutating inputs', () => {
  const current: DemoReviewInput = { ...input, hasSavedLogo: true, config: {
    identity: { logoAsset: '/api/demo-logo' }, contact: { phone: '020 1111 2222', email: 'current@example.test' },
    address: { street: '1 Test Road', city: 'London', postcode: 'AB1 2CD' },
    hours: [{ days: 'Monday - Sunday', times: 'By appointment' }], presentation: { teamIntroduction: 'Current copy', includedItems: ['Current offer'] },
  }, businessDetails: { dealershipDetails: { sourceUrl: dealer.sourceUrl, checkedAt: '2026-11-18T10:00:00Z',
    email: 'old@example.test', about: 'Old copy', openingHours: { days: [{ day: 1, status: 'closed' }] }, includedItems: ['Old offer'] } } };
  const before = structuredClone(current);
  const result = buildDemoReview(current);
  assert.equal(result.details.hasLogo, true);
  assert.deepEqual(result.details.missingFields, []);
  assert.equal(result.details.editableDetails?.email, 'current@example.test');
  assert.equal(result.details.editableDetails?.about, 'Current copy');
  assert.deepEqual(result.details.editableDetails?.includedItems, ['Current offer']);
  assert.deepEqual(current, before);
  assert.equal(buildDemoReview({ ...current, config: { ...current.config, identity: { logoAsset: '' } } }).details.hasLogo, false, 'removed logos stay removed');
});
