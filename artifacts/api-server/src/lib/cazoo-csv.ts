import { createHash } from 'node:crypto';

/** The official export is a separate source format, not a browser-capture payload. */
export const CAZOO_CSV_COLUMNS = [
  'Feed_ID', 'Vehicle_ID', 'FullRegistration', 'Colour', 'FuelType', 'Year',
  'Mileage', 'Bodytype', 'Doors', 'Make', 'Model', 'Variant', 'EngineSize',
  'Price', 'PreviousPrice', 'Transmission', 'PictureRefs', 'ServiceHistory',
  'PreviousOwners', 'Description', 'FourWheelDrive', 'Options', 'Comments',
  'New', 'Used', 'Site', 'Origin', 'V5', 'Condition', 'ExDemo',
  'FranchisedApproved', 'TradePrice', 'TradePriceExtra', 'ServiceHistoryCheck', 'DID',
] as const;

export type CazooCsvOptions = {
  dealerId: string;
  /** The configured Cazoo dealer reference, e.g. 75497 or cazoo-75497. */
  expectedRetailerId: string;
  expectedFeedId?: string;
  dealerName: string;
  dealerLocation?: string | null;
  /** The remote file's observed modification time; never invent a capture date. */
  capturedAt: string | Date;
  maxBytes?: number;
  maxVehicles?: number;
};

export type CazooCsvWarning = {
  code: string;
  message: string;
  vehicleId?: string;
  field?: string;
  row?: number;
};

export type CazooCsvCar = {
  advertId: string;
  title: string | null;
  variant: string | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  year: number | null;
  price: number | null;
  priceType: string | null;
  currency: string | null;
  mileage: number | null;
  mileageText: string | null;
  registration: string | null;
  registrationBand: string | null;
  plate: string | null;
  vrm: string | null;
  vrmVerified: boolean | null;
  fuel: string | null;
  transmission: string | null;
  bodyType: string | null;
  engineSize: string | null;
  engineCC: number | null;
  doors: number | null;
  seats: number | null;
  colour: string | null;
  emissionClass: string | null;
  drivetrain: string | null;
  owners: number | null;
  writeOffCategory: string | null;
  advertUrl: string | null;
  dealerName: string | null;
  dealerLocation: string | null;
  imageCount: number | null;
  heroImage: string | null;
  images: Array<{ url: string; caption: string | null }>;
  specifications: Record<string, unknown> | null;
  sourceExtras: Record<string, unknown>;
};

export type CazooCsvResult = {
  cars: CazooCsvCar[];
  warnings: CazooCsvWarning[];
  metadata: {
    dealerId: string;
    retailerId: string;
    feedId: string;
    capturedAt: string;
    count: number;
    sha256: string;
    columns: string[];
    descriptionColumn: 'Options';
  };
};

export class CazooCsvError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly row?: number,
    public readonly field?: string,
  ) {
    super(message);
    this.name = 'CazooCsvError';
  }
}

const MAX_FIELD_CHARS = 256_000;
const MAX_COLUMNS = 100;
const MAX_PHOTOS = 100;
const fail = (code: string, message: string, row?: number, field?: string): never => {
  throw new CazooCsvError(code, message, row, field);
};

/** Bounded RFC4180 reader: quoted commas, escaped quotes and embedded newlines. */
function csvRows(text: string, maxVehicles: number): string[][] {
  const rows: string[][] = [];
  let fields: string[] = [], field = '', state: 'start' | 'plain' | 'quoted' | 'closed' = 'start';
  let pendingRecord = false;
  const finishField = () => {
    fields.push(field);
    if (fields.length > MAX_COLUMNS) fail('column_limit', 'The CSV has too many columns.', rows.length + 1);
    field = '';
    state = 'start';
  };
  const finishRecord = () => {
    finishField();
    rows.push(fields);
    if (rows.length > maxVehicles + 1) fail('vehicle_limit', 'The CSV exceeds the vehicle limit.');
    fields = [];
    pendingRecord = false;
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (state === 'quoted') {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else state = 'closed';
      } else field += char;
    } else if (char === ',') {
      finishField();
      pendingRecord = true;
    } else if (char === '\n' || char === '\r') {
      finishRecord();
      if (char === '\r' && text[i + 1] === '\n') i++;
    } else if (state === 'closed') {
      fail('malformed_csv', 'Unexpected text after a closing CSV quote.', rows.length + 1);
    } else if (char === '"') {
      if (state !== 'start') fail('malformed_csv', 'A CSV quote must start a field.', rows.length + 1);
      state = 'quoted';
      pendingRecord = true;
    } else {
      field += char;
      state = 'plain';
      pendingRecord = true;
    }
    if (field.length > MAX_FIELD_CHARS) fail('field_limit', 'A CSV field exceeds the size limit.', rows.length + 1);
  }
  if (state === 'quoted') fail('malformed_csv', 'The CSV ends inside a quoted field.', rows.length + 1);
  if (pendingRecord || fields.length || field) finishRecord();
  return rows;
}

function wholeNumber(value: string, field: string, row: number, min: number, max: number, required = false): number | null {
  const raw = value.trim();
  if (!raw) {
    if (required) fail('missing_value', `A value is required for ${field}.`, row, field);
    return null;
  }
  if (!/^\d+$/.test(raw)) fail('invalid_number', `${field} must be a whole number.`, row, field);
  const number = Number(raw);
  if (!Number.isSafeInteger(number) || number < min || number > max)
    fail('invalid_number', `${field} is outside the accepted range.`, row, field);
  return number;
}

function requiredText(value: string, field: string, row: number, max = 300): string {
  const clean = value.trim();
  if (!clean || clean.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(clean))
    fail('invalid_text', `${field} is missing or invalid.`, row, field);
  return clean;
}

const fuelNames: Record<string, string> = {
  petrol: 'Petrol', diesel: 'Diesel', electric: 'Electric',
  'petrol/electric hybrid': 'Petrol Hybrid', 'diesel/electric hybrid': 'Diesel Hybrid',
  'petrol parallel phev': 'Petrol Plug-in Hybrid', 'diesel parallel phev': 'Diesel Plug-in Hybrid',
};
const bodyNames: Record<string, string> = {
  hatchback: 'Hatchback', estate: 'Estate', saloon: 'Saloon', coupe: 'Coupé',
  'coupé': 'Coupé', mpv: 'MPV', suv: 'SUV', convertible: 'Convertible', van: 'Van', pickup: 'Pickup',
};

function photoList(value: string, row: number): CazooCsvCar['images'] {
  if (!value.trim()) return [];
  const entries = value.split(',').map(url => url.trim());
  if (entries.length > MAX_PHOTOS) fail('photo_limit', 'A vehicle has more than 100 photos.', row, 'PictureRefs');
  const seen = new Set<string>();
  return entries.map(raw => {
    if (!raw || raw.length > 2048 || /[\s\\]/.test(raw))
      fail('invalid_photo', 'A photo URL is empty or invalid.', row, 'PictureRefs');
    let url: URL;
    try { url = new URL(raw); }
    catch { return fail('invalid_photo', 'A photo URL is invalid.', row, 'PictureRefs'); }
    if (url.protocol !== 'https:' || url.hostname !== 'cdn.images.autoexposure.co.uk'
      || url.username || url.password || url.hash || (url.port && url.port !== '443') || url.pathname === '/')
      fail('invalid_photo', 'A photo URL is outside the approved HTTPS image host.', row, 'PictureRefs');
    if (seen.has(raw)) fail('duplicate_photo', 'A vehicle has duplicate photo URLs.', row, 'PictureRefs');
    seen.add(raw);
    // Keep the observed URL, ordering and cache-busting query exactly as supplied.
    return { url: raw, caption: null };
  });
}

/** Pure conversion only. It never writes stock, contacts providers, or infers history claims. */
export function parseCazooCsv(input: string | Uint8Array, options: CazooCsvOptions): CazooCsvResult {
  const maxBytes = options.maxBytes ?? 10 * 1024 * 1024;
  const maxVehicles = options.maxVehicles ?? 2000;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 100 * 1024 * 1024
    || !Number.isSafeInteger(maxVehicles) || maxVehicles < 1 || maxVehicles > 10_000)
    fail('invalid_configuration', 'The CSV limits are invalid.');
  if (!options.dealerId?.trim() || !options.dealerName?.trim())
    fail('invalid_configuration', 'A dealership ID and name are required.');
  const retailerMatch = /^(?:cazoo-)?(\d+)$/.exec(options.expectedRetailerId);
  if (!retailerMatch) return fail('invalid_configuration', 'The configured Cazoo dealer reference is invalid.');
  const expectedDid = retailerMatch[1];
  if (options.expectedFeedId != null && !/^AETA\d+$/.test(options.expectedFeedId))
    fail('invalid_configuration', 'The configured export feed reference is invalid.');
  const captured = options.capturedAt instanceof Date ? options.capturedAt : new Date(options.capturedAt);
  const timestamp = typeof options.capturedAt === 'string'
    ? /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.exec(options.capturedAt) : null;
  const calendar = timestamp ? new Date(Date.UTC(Number(timestamp[1]), Number(timestamp[2]) - 1, Number(timestamp[3]))) : null;
  if (!Number.isFinite(captured.getTime()) || (typeof options.capturedAt === 'string'
    && (!timestamp || calendar?.getUTCFullYear() !== Number(timestamp[1])
      || calendar?.getUTCMonth() !== Number(timestamp[2]) - 1 || calendar?.getUTCDate() !== Number(timestamp[3])
      || Number(timestamp[4]) > 23 || Number(timestamp[5]) > 59 || Number(timestamp[6]) > 59)))
    fail('invalid_configuration', 'An observed file modification timestamp with timezone is required.');
  const capturedAt = captured.toISOString();
  const byteLength = typeof input === 'string' ? Buffer.byteLength(input, 'utf8') : input.byteLength;
  if (!byteLength) fail('empty_csv', 'The CSV is empty.');
  if (byteLength > maxBytes) fail('size_limit', 'The CSV exceeds the size limit.');
  const bytes = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return fail('invalid_encoding', 'The CSV must use valid UTF-8.'); }
  const rows = csvRows(text.replace(/^\uFEFF/, ''), maxVehicles);
  if (rows.length < 2) fail('empty_stock', 'The CSV contains no vehicles; an empty feed requires separate review.');
  const headers = rows[0].map(value => value.trim());
  if (headers.some(header => !header) || new Set(headers.map(header => header.toLowerCase())).size !== headers.length)
    fail('invalid_headers', 'CSV headers must be non-empty and unique.');
  const missing = CAZOO_CSV_COLUMNS.filter(header => !headers.includes(header));
  if (missing.length) fail('missing_headers', `Required CSV headers are missing: ${missing.join(', ')}.`);
  const warnings: CazooCsvWarning[] = [];
  const unknown = headers.filter(header => !(CAZOO_CSV_COLUMNS as readonly string[]).includes(header));
  if (unknown.length) warnings.push({ code: 'unknown_columns', message: 'Additional CSV columns were ignored; review the changed export format.' });
  const ids = new Set<string>(), registrations = new Set<string>();
  let feedId = options.expectedFeedId ?? '';
  const cars = rows.slice(1).map((fields, index): CazooCsvCar => {
    const row = index + 2;
    if (fields.length !== headers.length) fail('uneven_row', 'A CSV row has a different number of fields from the header.', row);
    const values = Object.fromEntries(headers.map((header, column) => [header, fields[column]]));
    if (values.DID.trim() !== expectedDid) fail('wrong_dealer', 'The CSV dealer reference does not match this dealership.', row, 'DID');
    const rowFeed = values.Feed_ID.trim();
    if (!/^AETA\d+$/.test(rowFeed)) fail('invalid_feed', 'The export feed reference is invalid.', row, 'Feed_ID');
    if (!feedId) feedId = rowFeed;
    if (rowFeed !== feedId) fail('wrong_feed', 'The CSV contains an unexpected export feed reference.', row, 'Feed_ID');
    const advertId = values.Vehicle_ID.trim();
    if (!/^AETV\d+$/.test(advertId)) fail('invalid_vehicle_id', 'The export vehicle reference is invalid.', row, 'Vehicle_ID');
    if (ids.has(advertId)) fail('duplicate_vehicle', 'The CSV contains a duplicate vehicle reference.', row, 'Vehicle_ID');
    ids.add(advertId);
    const registration = values.FullRegistration.trim().toUpperCase().replace(/\s+/g, '');
    if (!/^(?=.*[A-Z])(?=.*\d)[A-Z\d]{2,7}$/.test(registration))
      fail('invalid_registration', 'A supplied registration is missing or malformed.', row, 'FullRegistration');
    if (registrations.has(registration)) fail('duplicate_registration', 'The CSV contains a duplicate registration.', row, 'FullRegistration');
    registrations.add(registration);
    const warn = (code: string, message: string, field?: string) => warnings.push({ code, message, vehicleId: advertId, row, ...(field ? { field } : {}) });
    const make = requiredText(values.Make, 'Make', row), model = requiredText(values.Model, 'Model', row);
    const year = wholeNumber(values.Year, 'Year', row, 1900, 2100, true)!;
    const mileage = wholeNumber(values.Mileage, 'Mileage', row, 0, 5_000_000, true)!;
    const price = wholeNumber(values.Price, 'Price', row, 1, 10_000_000, true)!;
    if (values.PreviousPrice.trim()) wholeNumber(values.PreviousPrice, 'PreviousPrice', row, 1, 10_000_000);
    const rawFuel = requiredText(values.FuelType, 'FuelType', row);
    const fuel = fuelNames[rawFuel.toLowerCase()] ?? rawFuel;
    if (!fuelNames[rawFuel.toLowerCase()]) warn('unknown_fuel', 'An unrecognised fuel label was kept as supplied.', 'FuelType');
    const rawBody = values.Bodytype.trim();
    const bodyType = bodyNames[rawBody.toLowerCase()] ?? (rawBody || null);
    const engine = wholeNumber(values.EngineSize, 'EngineSize', row, 1, 20_000);
    const electric = fuel === 'Electric';
    if (electric && engine != null) warn('electric_engine_ignored', 'Engine capacity is not applicable to a fully electric vehicle.', 'EngineSize');
    if (!electric && engine != null && engine < 100) fail('invalid_number', 'Combustion engine capacity is implausibly small.', row, 'EngineSize');
    const engineCC = electric ? null : engine;
    const doors = wholeNumber(values.Doors, 'Doors', row, 1, 10);
    const previousOwners = wholeNumber(values.PreviousOwners, 'PreviousOwners', row, 0, 50);
    if (previousOwners != null) warn('owners_unconfirmed', 'PreviousOwners is not published until Cazoo confirms whether it means previous keepers or total owners.', 'PreviousOwners');
    if (values.ServiceHistory.trim()) warn('service_history_unconfirmed', 'ServiceHistory codes are not interpreted as a public history claim.', 'ServiceHistory');
    if (values.V5.trim()) warn('v5_unconfirmed', 'V5 codes are not interpreted as a public document-status claim.', 'V5');
    for (const flag of ['New', 'Used', 'ExDemo', 'FranchisedApproved', 'V5']) {
      if (values[flag].trim() && !/^[YN]$/i.test(values[flag].trim())) fail('invalid_flag', 'An export flag has an unrecognised value.', row, flag);
    }
    if (values.Used.trim().toUpperCase() !== 'Y' || values.New.trim().toUpperCase() !== 'N')
      fail('unsupported_condition', 'This adapter accepts used vehicle stock only.', row);
    const description = values.Options.trim().replace(/\\r\\n|\\n|\\r/g, '\n');
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(description)) fail('invalid_text', 'The vehicle description contains invalid control characters.', row, 'Options');
    if (!description) warn('missing_description', 'This export has no dealer description in Options.', 'Options');
    if (values.Description.trim() || values.Comments.trim())
      warn('unmapped_description_column', 'Description or Comments is populated; review it before changing the agreed Options mapping.');
    const images = photoList(values.PictureRefs, row);
    if (!images.length) warn('missing_photos', 'The export supplies no photos for this vehicle.', 'PictureRefs');
    const transmission = values.Transmission.trim();
    const normalTransmission = /^(automatic|manual)$/i.test(transmission)
      ? transmission[0].toUpperCase() + transmission.slice(1).toLowerCase() : transmission || null;
    return {
      advertId, title: `${year} ${make} ${model}`, variant: values.Variant.trim() || null,
      make, model, trim: null, year, price, priceType: 'retail', currency: 'GBP', mileage,
      mileageText: `${mileage.toLocaleString('en-GB')} miles`, registration,
      registrationBand: null, plate: registration, vrm: registration, vrmVerified: false,
      fuel, transmission: normalTransmission, bodyType,
      engineSize: engineCC == null ? null : `${(engineCC / 1000).toFixed(1)}L`, engineCC,
      doors, seats: null, colour: values.Colour.trim() || null, emissionClass: null,
      drivetrain: null, owners: null, writeOffCategory: null, advertUrl: null,
      dealerName: options.dealerName.trim(), dealerLocation: options.dealerLocation?.trim() || null,
      imageCount: images.length, heroImage: images[0]?.url ?? null, images,
      specifications: description ? { description } : null,
      sourceExtras: {
        sourcePlatform: 'cazoo', officialFeed: true, officialCazooVehicleId: advertId,
        sourceCapture: { method: 'cazoo-official-csv', capturedAt },
        ...(description ? { description, advertDescription: description, descriptionOrigin: 'cazoo-official-csv' } : {}),
      },
    };
  });
  return {
    cars, warnings,
    metadata: {
      dealerId: options.dealerId.trim(), retailerId: options.expectedRetailerId,
      feedId, capturedAt, count: cars.length, sha256: createHash('sha256').update(bytes).digest('hex'),
      columns: headers, descriptionColumn: 'Options',
    },
  };
}
