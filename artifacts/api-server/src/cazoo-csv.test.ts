import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { ImportGrokStockBody } from '@workspace/api-zod';
import { CAZOO_CSV_COLUMNS, CazooCsvError, parseCazooCsv, type CazooCsvOptions } from './lib/cazoo-csv';

const options: CazooCsvOptions = {
  dealerId: 'dealer-multi-choice', expectedRetailerId: 'cazoo-75497',
  expectedFeedId: 'AETA22820', dealerName: 'Multi-Choice Motors',
  dealerLocation: 'Hayes', capturedAt: '2026-10-29T10:12:00Z',
};
const row = (overrides: Record<string, string> = {}): Record<string, string> => ({
  ...Object.fromEntries(CAZOO_CSV_COLUMNS.map(header => [header, ''])),
  Feed_ID: 'AETA22820', Vehicle_ID: 'AETV12345678', FullRegistration: 'ab12 cde',
  Colour: 'Grey', FuelType: 'Petrol', Year: '2018', Mileage: '55000',
  Bodytype: 'HATCHBACK', Doors: '5', Make: 'Volkswagen', Model: 'Golf',
  Variant: '1.5 TSI SE Nav DSG', EngineSize: '1498', Price: '7990',
  Transmission: 'Automatic',
  PictureRefs: 'https://cdn.images.autoexposure.co.uk/AETA22820/AETV12345678_1.jpg?t=20261029101200,https://cdn.images.autoexposure.co.uk/AETA22820/AETV12345678_2.jpg?t=20261029101200',
  ServiceHistory: '0', PreviousOwners: '0',
  Options: 'Dealer supplied description. Full service history and MOT until October 2027.',
  New: 'N', Used: 'Y', V5: 'N', ExDemo: 'N', FranchisedApproved: 'N', DID: '75497',
  ...overrides,
});
const quote = (value: string) => /[,"\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
function csv(rows: Record<string, string>[] = [row()], columns: readonly string[] = CAZOO_CSV_COLUMNS): string {
  return [columns.join(','), ...rows.map(values => columns.map(header => quote(values[header] ?? '')).join(','))].join('\r\n') + '\r\n';
}
function rejected(input: string | Uint8Array, code: string, overrides: Partial<CazooCsvOptions> = {}) {
  assert.throws(() => parseCazooCsv(input, { ...options, ...overrides }), error => error instanceof CazooCsvError && error.code === code);
}

test('official CSV maps supplied facts to the exact existing stock contract without guessed data', () => {
  const input = csv();
  const result = parseCazooCsv(input, options), car = result.cars[0];
  assert.equal(car.advertId, 'AETV12345678');
  assert.equal(car.title, '2018 Volkswagen Golf');
  assert.equal(car.registration, 'AB12CDE');
  assert.equal(car.plate, 'AB12CDE');
  assert.equal(car.vrm, 'AB12CDE');
  assert.equal(car.vrmVerified, false);
  assert.equal(car.price, 7990);
  assert.equal(car.currency, 'GBP');
  assert.equal(car.mileage, 55000);
  assert.equal(car.bodyType, 'Hatchback');
  assert.equal(car.engineCC, 1498);
  assert.equal(car.engineSize, '1.5L');
  assert.equal(car.imageCount, 2);
  assert.equal(car.heroImage, car.images[0].url);
  for (const field of ['trim', 'registrationBand', 'seats', 'emissionClass', 'drivetrain', 'owners', 'writeOffCategory', 'advertUrl'] as const)
    assert.equal(car[field], null);
  assert.deepEqual(car.specifications, { description: row().Options });
  assert.equal(car.sourceExtras.officialFeed, true);
  assert.equal(car.sourceExtras.officialCazooVehicleId, car.advertId);
  assert.equal(car.sourceExtras.sourcePlatform, 'cazoo');
  assert.equal(car.sourceExtras.description, row().Options);
  assert.equal(car.sourceExtras.features, undefined);
  assert.equal(car.sourceExtras.sourceReport, undefined);
  assert.deepEqual(car.sourceExtras.sourceCapture, { method: 'cazoo-official-csv', capturedAt: '2026-10-29T10:12:00.000Z' });
  assert.equal(result.metadata.count, 1);
  assert.equal(result.metadata.sha256, createHash('sha256').update(input).digest('hex'));
  assert.equal(result.metadata.feedId, 'AETA22820');
  assert.equal(result.metadata.dealerId, options.dealerId);
  assert.ok(ImportGrokStockBody.safeParse({ schemaVersion: 1, runId: 'offline-test', source: 'grok', retailerId: options.expectedRetailerId, dealerName: options.dealerName, scrapedAt: result.metadata.capturedAt, complete: true, expectedAdvertCount: 1, count: 1, failedAdvertIds: [], errors: [], cars: result.cars }).success);
});

test('UTF-8 BOM, quoted multiline descriptions, escaped quotes and observed photo URL queries survive', () => {
  const description = 'First line, with a comma\r\nSecond line: "quoted text".\nThird line.';
  const input = '\uFEFF' + csv([row({ Options: description })]);
  const result = parseCazooCsv(Buffer.from(input), options);
  assert.equal(result.cars[0].sourceExtras.description, description);
  assert.deepEqual(result.cars[0].images.map(image => image.url), row().PictureRefs.split(','));
  assert.equal(result.metadata.sha256, createHash('sha256').update(Buffer.from(input)).digest('hex'));
});

test('literal newline escapes in dealer descriptions are displayed as newlines without interpreting HTML', () => {
  const result = parseCazooCsv(csv([row({ Options: 'First\\nSecond\\r\\n<script>unchanged text</script>' })]), options);
  assert.equal(result.cars[0].sourceExtras.description, 'First\nSecond\n<script>unchanged text</script>');
});

test('export Feed_ID is checked separately from DID and all rows must match the configured dealer', () => {
  assert.equal(parseCazooCsv(csv(), { ...options, expectedRetailerId: '75497' }).metadata.retailerId, '75497');
  rejected(csv([row({ DID: '99999' })]), 'wrong_dealer');
  rejected(csv([row({ DID: 'AETA22820' })]), 'wrong_dealer');
  rejected(csv([row({ Feed_ID: 'AETA99999' })]), 'wrong_feed');
  rejected(csv([row({ Feed_ID: '75497' })]), 'invalid_feed');
  rejected(csv([row(), row({ Vehicle_ID: 'AETV99999999', FullRegistration: 'ZZ99ZZZ', Feed_ID: 'AETA99999' })]), 'wrong_feed', { expectedFeedId: undefined });
});

test('duplicate IDs and registrations fail the entire feed instead of choosing a record', () => {
  rejected(csv([row(), row({ FullRegistration: 'CD34EFG' })]), 'duplicate_vehicle');
  rejected(csv([row(), row({ Vehicle_ID: 'AETV99999999', FullRegistration: ' AB12CDE ' })]), 'duplicate_registration');
  rejected(csv([row({ Vehicle_ID: '80238245' })]), 'invalid_vehicle_id');
  rejected(csv([row({ FullRegistration: 'not a registration' })]), 'invalid_registration');
  rejected(csv([row({ FullRegistration: '' })]), 'invalid_registration');
  assert.equal(parseCazooCsv(csv([row({ FullRegistration: 'IXZ7475' })]), options).cars[0].plate, 'IXZ7475');
});

test('duplicate, missing and blank headers and uneven rows are rejected', () => {
  rejected(csv([row()], CAZOO_CSV_COLUMNS.filter(header => header !== 'DID')), 'missing_headers');
  rejected(csv([row()], [...CAZOO_CSV_COLUMNS, 'DID']), 'invalid_headers');
  rejected(csv([row()], [...CAZOO_CSV_COLUMNS, 'did']), 'invalid_headers');
  rejected(csv([row()], [...CAZOO_CSV_COLUMNS, '']), 'invalid_headers');
  rejected(csv().replace(/\r\n$/, ',extra\r\n'), 'uneven_row');
  rejected(csv().replace(/\r\n$/, '\r\n\r\n'), 'uneven_row');
});

test('unknown export columns are ignored with a review warning rather than entering public source extras', () => {
  const result = parseCazooCsv(csv([row({ InternalSecret: 'never publish' })], [...CAZOO_CSV_COLUMNS, 'InternalSecret']), options);
  assert.ok(result.warnings.some(warning => warning.code === 'unknown_columns'));
  assert.ok(!JSON.stringify(result.cars).includes('never publish'));
});

test('malformed quote sequences fail before any vehicle can be returned', () => {
  rejected(csv().replace('Grey', 'Gr"ey'), 'malformed_csv');
  rejected(csv().replace('Grey', '"Grey"suffix'), 'malformed_csv');
  rejected(csv().replace('Grey', '"Grey'), 'malformed_csv');
});

test('numeric fields reject exponent notation, partial values, negatives, fractions and unsafe ranges', () => {
  for (const [field, value] of [
    ['Price', '7990abc'], ['Price', '7,990'], ['Price', '7.99e3'], ['Price', '-1'],
    ['Price', '7990.50'], ['Price', '9007199254740992'], ['Price', '0'],
    ['Mileage', 'unknown'], ['Mileage', '55000.5'], ['Year', '2018.0'],
    ['Year', '0'], ['Doors', '5 doors'], ['Doors', '0'], ['EngineSize', '1.5'],
    ['PreviousOwners', '-1'], ['PreviousPrice', '2000junk'],
  ]) rejected(csv([row({ [field]: value })]), 'invalid_number');
  rejected(csv([row({ Price: '' })]), 'missing_value');
  rejected(csv([row({ Mileage: '' })]), 'missing_value');
  assert.equal(parseCazooCsv(csv([row({ Mileage: '0' })]), options).cars[0].mileage, 0);
});

test('fully electric engine sentinels never display a 1cc engine; hybrids retain supplied capacity', () => {
  const electric = parseCazooCsv(csv([row({ FuelType: 'Electric', EngineSize: '1', Doors: '' })]), options);
  assert.equal(electric.cars[0].engineCC, null);
  assert.equal(electric.cars[0].engineSize, null);
  assert.equal(electric.cars[0].doors, null);
  assert.ok(electric.warnings.some(warning => warning.code === 'electric_engine_ignored'));
  assert.equal(parseCazooCsv(csv([row({ FuelType: 'Petrol/Electric Hybrid' })]), options).cars[0].fuel, 'Petrol Hybrid');
  assert.equal(parseCazooCsv(csv([row({ FuelType: 'Petrol Parallel Phev' })]), options).cars[0].fuel, 'Petrol Plug-in Hybrid');
  rejected(csv([row({ EngineSize: '1' })]), 'invalid_number');
});

test('uncertain owners, service-history and V5 codes never become public claims', () => {
  const result = parseCazooCsv(csv([row({ PreviousOwners: '0', ServiceHistory: '0', V5: 'N', TradePrice: '1234', Site: 'private/internal' })]), options);
  assert.equal(result.cars[0].owners, null);
  for (const code of ['owners_unconfirmed', 'service_history_unconfirmed', 'v5_unconfirmed'])
    assert.ok(result.warnings.some(warning => warning.code === code && warning.vehicleId === 'AETV12345678'));
  const publicData = JSON.stringify(result.cars);
  assert.ok(!publicData.includes('TradePrice'));
  assert.ok(!publicData.includes('private/internal'));
  assert.equal(result.cars[0].sourceExtras.serviceHistory, undefined);
  assert.equal(result.cars[0].sourceExtras.v5, undefined);
});

test('empty descriptions and photos produce explicit authoritative absences without generated fallbacks', () => {
  const result = parseCazooCsv(csv([row({ Options: '', PictureRefs: '', PreviousOwners: '', Description: 'Different export column' })]), options);
  assert.equal(result.cars[0].specifications, null);
  assert.equal(result.cars[0].sourceExtras.description, undefined);
  assert.equal(result.cars[0].sourceExtras.features, undefined);
  assert.equal(result.cars[0].heroImage, null);
  assert.deepEqual(result.cars[0].images, []);
  assert.equal(result.cars[0].imageCount, 0);
  assert.ok(result.warnings.some(warning => warning.code === 'missing_description'));
  assert.ok(result.warnings.some(warning => warning.code === 'missing_photos'));
  assert.ok(result.warnings.some(warning => warning.code === 'unmapped_description_column'));
});

test('photo host validation rejects schemes, lookalike domains, credentials, fragments and duplicate links', () => {
  for (const url of [
    'http://cdn.images.autoexposure.co.uk/car.jpg', 'https://cdn.images.autoexposure.co.uk.evil.invalid/car.jpg',
    'https://127.0.0.1/car.jpg', 'file:///tmp/car.jpg', 'https://secret@cdn.images.autoexposure.co.uk/car.jpg',
    'https://cdn.images.autoexposure.co.uk:444/car.jpg', 'https://cdn.images.autoexposure.co.uk/car.jpg#secret',
    'https://cdn.images.autoexposure.co.uk/car image.jpg', 'https://cdn.images.autoexposure.co.uk/',
    'https://cdn.images.autoexposure.co.uk/car.jpg,',
  ]) rejected(csv([row({ PictureRefs: url })]), 'invalid_photo');
  const photo = 'https://cdn.images.autoexposure.co.uk/a.jpg';
  rejected(csv([row({ PictureRefs: `${photo},${photo}` })]), 'duplicate_photo');
  rejected(csv([row({ PictureRefs: Array.from({ length: 101 }, (_, index) => `${photo}?t=${index}`).join(',') })]), 'photo_limit');
});

test('byte, field, row and encoding limits fail closed, including an empty stock file', () => {
  rejected('', 'empty_csv');
  rejected(CAZOO_CSV_COLUMNS.join(','), 'empty_stock');
  rejected(csv(), 'size_limit', { maxBytes: 10 });
  rejected(csv([row(), row({ Vehicle_ID: 'AETV99999999', FullRegistration: 'CD34EFG' })]), 'vehicle_limit', { maxVehicles: 1 });
  rejected(Buffer.from([0xff, 0xff]), 'invalid_encoding');
  rejected(csv([row({ Options: 'x'.repeat(256001) })]), 'field_limit');
  rejected(csv(), 'invalid_configuration', { maxBytes: -1 });
  rejected(csv(), 'invalid_configuration', { maxVehicles: 0 });
});

test('source timestamps are caller-observed, deterministic and never replaced with the current time', () => {
  const a = parseCazooCsv(csv(), options), b = parseCazooCsv(csv(), options);
  assert.deepEqual(a, b);
  assert.equal(parseCazooCsv(csv(), { ...options, capturedAt: '2026-10-29T11:12:00+01:00' }).metadata.capturedAt, a.metadata.capturedAt);
  rejected(csv(), 'invalid_configuration', { capturedAt: '2026-10-29' });
  rejected(csv(), 'invalid_configuration', { capturedAt: '2026-02-30T10:12:00Z' });
  rejected(csv(), 'invalid_configuration', { capturedAt: '2026-10-29T24:00:00Z' });
  rejected(csv(), 'invalid_configuration', { capturedAt: 'yesterday' });
  rejected(csv(), 'invalid_configuration', { capturedAt: new Date(NaN) });
});

test('non-used stock and malformed flags require review rather than silently changing stock state', () => {
  rejected(csv([row({ Used: 'N', New: 'Y' })]), 'unsupported_condition');
  rejected(csv([row({ Used: 'maybe' })]), 'invalid_flag');
  rejected(csv([row({ V5: 'unknown' })]), 'invalid_flag');
});
