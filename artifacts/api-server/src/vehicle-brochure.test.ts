import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { brochureDetails, brochureFilename, brochurePhotos, renderVehicleBrochure, type BrochureVehicle } from './lib/vehicle-brochure';
import { brochureOrigin, createBrochureHandler } from './lib/vehicle-brochure-handler';
import { imageDimensions, isPublicImageAddress, permittedBrochureImage } from './lib/vehicle-brochure-images';

const vehicle: BrochureVehicle = {
  id: 'test-car', title: '2015 Jeep Renegade', make: 'Jeep', model: 'Renegade', year: 2015,
  price: 4973, currency: 'GBP', mileage: 71600, fuel: 'Diesel', transmission: 'Manual',
  heroImage: 'https://m.atcdn.co.uk/front.jpg',
  images: [{ url: 'https://m.atcdn.co.uk/rear.jpg', caption: 'Rear view' }, { url: 'https://m.atcdn.co.uk/front.jpg', caption: 'Front view' }],
};

function contentStreams(pdf: Buffer) {
  const source = pdf.toString('latin1');
  return [...source.matchAll(/<<([\s\S]*?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g)]
    .map((match) => {
      try { return match[1].includes('/FlateDecode') ? inflateSync(Buffer.from(match[2], 'latin1')).toString('latin1') : match[2]; }
      catch { return ''; }
    }).join('\n');
}

test('public details preserve zero values, supplied history and missing buyer information', () => {
  const details = brochureDetails({ ...vehicle, mileage: 0, owners: 0, writeOffCategory: 'CAT S', specifications: { numberOfKeys: 0, description: 'Supplied description', features: ['Heated seats'] } });
  assert.equal(details.specs.find(([key]) => key === 'Mileage')?.[1], '0 miles');
  assert.equal(details.specs.find(([key]) => key === 'Previous owners')?.[1], '0');
  assert.equal(details.buyer.find(([key]) => key === 'Keys')?.[1], '0 keys');
  assert.equal(details.buyer.find(([key]) => key === 'Warranty')?.[1], '');
  assert.equal(details.history, 'CAT S');
  assert.equal(details.description, 'Supplied description');
  assert.deepEqual(details.features, ['Heated seats']);
  assert.equal(brochureDetails({ ...vehicle, writeOffCategory: 'S' }).history, 'Category S');
});

test('gallery is deduplicated with the supplied hero and original caption first', () => {
  assert.deepEqual(brochurePhotos(vehicle), [
    { url: 'https://m.atcdn.co.uk/front.jpg', caption: 'Front view' },
    { url: 'https://m.atcdn.co.uk/rear.jpg', caption: 'Rear view' },
  ]);
  assert.match(brochureFilename({ ...vehicle, title: 'Car "\r\nattachment; bad' }), /^[a-zA-Z0-9-]+\.pdf$/);
});

test('PDF contains long descriptions, features, category notes, pagination and honest missing-photo text', () => {
  const pdf = renderVehicleBrochure({
    vehicle: { ...vehicle, description: 'Description line. '.repeat(900) + 'DESCRIPTION END', features: ['First feature', 'Last feature'], writeOffCategory: 'CAT N' },
    dealer: { name: 'Test Motors', phone: '020 7000 0000' },
    photos: brochurePhotos(vehicle), totalPhotos: 2, vehicleUrl: 'https://example.com/vehicle/test-car', preview: true,
  });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok((pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length >= 4);
  const text = contentStreams(pdf);
  for (const value of ['DESCRIPTION END', 'First feature', 'Last feature', 'CAT N', 'Photograph unavailable', 'Please ask our team', 'ARCHIVED STOCK']) assert.ok(text.includes(value), value);
  assert.ok(pdf.toString('latin1').includes('https://example.com/vehicle/test-car'));
});

test('image allowlist rejects unsafe protocols, credentials, IPs, ports and lookalike domains', () => {
  for (const url of ['http://m.atcdn.co.uk/a.jpg', 'https://m.atcdn.co.uk.evil.test/a.jpg', 'https://user:pass@m.atcdn.co.uk/a.jpg', 'https://127.0.0.1/a.jpg', 'https://m.atcdn.co.uk:444/a.jpg', 'file:///etc/passwd']) assert.equal(permittedBrochureImage(url), null, url);
  assert.ok(permittedBrochureImage('https://m.atcdn.co.uk/a.jpg'));
  assert.ok(permittedBrochureImage('https://images.dealer.example/car.jpg', 'images.dealer.example'));
  assert.equal(permittedBrochureImage('https://other.example/car.jpg', 'images.dealer.example'), null);
});

test('DNS addresses reject local and private networks before the pinned image request', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.1.1', '192.168.2.1', '169.254.169.254', '100.64.0.1', '192.0.2.1', '198.51.100.1', '203.0.113.1', '::1', '::ffff:127.0.0.1', 'fd00::1', 'fe80::1', '2001:db8::1', '2001::1', '2002:7f00:1::']) assert.equal(isPublicImageAddress(address), false, address);
  assert.equal(isPublicImageAddress('1.1.1.1'), true);
  assert.equal(isPublicImageAddress('2606:4700::1111'), true);
});

test('image headers reject missing or oversized dimensions', () => {
  const png = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
  png.writeUInt32BE(1024, 16); png.writeUInt32BE(768, 20);
  assert.deepEqual(imageDimensions(png), { format: 'PNG', width: 1024, height: 768 });
  png.writeUInt32BE(50_000, 16);
  assert.equal(imageDimensions(png), null);
  assert.equal(imageDimensions(Buffer.from('not a photograph')), null);
});

test('handler checks live visibility before reusing a PDF and returns safe inline headers', async () => {
  let visible = true, reads = 0, loads = 0;
  const generate = createBrochureHandler({
    findVehicle: async () => { reads++; return visible ? vehicle : null; },
    readDealer: async () => ({ name: 'Test Motors' }),
    loadPhotos: async (photos) => { loads++; return photos; },
  });
  const first = await generate(vehicle.id, 'https://example.com');
  assert.equal(first.status, 200);
  assert.equal(first.headers['Content-Type'], 'application/pdf');
  assert.match(first.headers['Content-Disposition'], /^inline; filename=".*\.pdf"$/);
  assert.equal(first.headers['Cache-Control'], 'no-store');
  assert.deepEqual((await generate(vehicle.id, 'https://example.com')).body, first.body);
  assert.equal(loads, 1);
  visible = false;
  assert.equal((await generate(vehicle.id, 'https://example.com')).status, 404);
  assert.equal(reads, 3);
  assert.equal((await generate('../secret', 'https://example.com')).status, 400);
  assert.equal(reads, 3);
});

test('PDF cache changes when public stock price changes; failures return a retryable message', async () => {
  let price = 4973;
  const generate = createBrochureHandler({ findVehicle: async () => ({ ...vehicle, price }), readDealer: async () => ({ name: 'Test Motors' }), loadPhotos: async (photos) => photos });
  const first = await generate(vehicle.id, 'https://example.com');
  price = 4500;
  const second = await generate(vehicle.id, 'https://example.com');
  assert.notDeepEqual(first.body, second.body);
  const failed = createBrochureHandler({ findVehicle: async () => { throw new Error('internal private detail'); }, readDealer: async () => ({ name: 'Test Motors' }) });
  const result = await failed(vehicle.id, 'https://example.com');
  assert.equal(result.status, 503);
  assert.ok(!String(result.body).includes('internal private detail'));
});

test('concurrent document work is bounded and an invalid host is never put in a PDF link', async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const generate = createBrochureHandler({ findVehicle: async () => { await pending; return vehicle; }, readDealer: async () => ({ name: 'Test Motors' }), loadPhotos: async (photos) => photos });
  const first = generate('a', ''), second = generate('b', '');
  assert.equal((await generate('c', '')).status, 503);
  release(); await Promise.all([first, second]);
  assert.equal(brochureOrigin('evil.com/path'), '');
  assert.equal(brochureOrigin('example.com'), 'https://example.com');
  assert.equal(brochureOrigin('127.0.0.1:4175'), 'http://127.0.0.1:4175');
});
