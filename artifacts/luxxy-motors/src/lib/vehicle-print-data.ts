import type { Car } from './stock-context';
import { insuranceHistoryLabel } from './vehicle-history';
import { isUKNumberPlate, vehicleDisplayTitle } from './utils';

export interface VehiclePrintFact { label: string; value: string }
export interface VehiclePrintData {
  title: string;
  variant: string | null;
  price: string | null;
  priceNote?: string;
  facts: VehiclePrintFact[];
  history: VehiclePrintFact[];
  specificationGroups: { title: string; facts: VehiclePrintFact[] }[];
  runningCosts: VehiclePrintFact[];
  features: string[];
  description: string | null;
  sourceNotes: string[];
  photos: { src: string; caption?: string }[];
}

const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const normalise = (value: string) => value.replace(/\u0092/g, '’').replace(/\s+/g, ' ').trim();
const missing = /^(?:unknown|not (?:supplied|provided|available|known|specified)|not applicable|n\/?a|tbc|tbd|pending|contact (?:seller|dealer|dealership)|ask (?:seller|dealer|dealership)|service history not (?:provided|supplied)|[-–—]|null|undefined)$/i;
const text = (value: unknown): string | null => {
  const result = typeof value === 'string' ? normalise(value) : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
  return result && !missing.test(result) ? result : null;
};
const finance = /\b(?:finance|financing|monthly|pcp|hp payment|lease payment|monthly payment)\b/i;
const headings = new Set(['please note', 'audio and communications', 'drivers assistance', 'driver assistance', 'exterior', 'illumination', 'interior', 'performance', 'safety and security', 'valuable features', 'rare features', 'added extras', 'standard features', 'optional features']);
const serviceLabel = (value: string | null) => value ? ({ full: 'Full service history', partial: 'Partial service history', none: 'No service history', 'no history': 'No service history', 'full dealership': 'Full dealership service history', 'full (dealership)': 'Full dealership service history' }[value.toLowerCase()] || value) : null;
const featureKey = (value: string) => normalise(value).toLowerCase().replace(/[’']/g, "'").replace(/:$/, '').trim();
const valueKey = (value: string) => value.toLowerCase().replace(/[\s,]/g, '');
const comparableValue = (key: string, value: string) => ['keys', 'owners', 'seats', 'doors'].includes(key)
  ? valueKey(value).replace(/(?:keys?|owners?|seats?|doors?)$/, '') : valueKey(value);
const semanticKey = (label: string) => {
  const key = label.toLowerCase().replace(/[^a-z0-9]/g, '');
  const aliases: Record<string, string> = {
    owners: 'owners', ownerslisting: 'owners', previousowners: 'owners', numberofowners: 'owners',
    gearbox: 'transmission', transmission: 'transmission', body: 'bodytype',
    bodycolour: 'colour', color: 'colour', fueltype: 'fuel',
    milespergallon: 'averagefuel', average: 'averagefuel', combined: 'averagefuel', combinedfuelconsumption: 'averagefuel',
    taxperyear: 'tax', annualroadtax: 'tax', annualtax: 'tax', roadtax: 'tax',
    co2emissions: 'co2', coemissions: 'co2', emission: 'co2',
    keyssupplied: 'keys', numberofkeys: 'keys', keycount: 'keys',
  };
  return aliases[key] || key;
};
const rowFrom = (value: unknown): VehiclePrintFact | null => {
  const row = record(value);
  const label = text(row?.label ?? row?.name ?? row?.title);
  const valueText = text(row?.value ?? row?.description);
  return label && valueText && !finance.test(label) ? { label, value: valueText } : null;
};
const safePhotoUrl = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null;
  const url = value.trim();
  if (/^\/(?!\/)/.test(url)) return url;
  try { const parsed = new URL(url); return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? url : null; }
  catch { return null; }
};

/** A print-specific view of supplied customer details. Never fill absent fields with guesses. */
export function vehiclePrintData(car: Car, suppliedFeatures: string[] = [], suppliedDescription?: string): VehiclePrintData {
  const specs = record(car.specifications);
  const extras = record(car.sourceExtras);
  const sources: (Record<string, unknown> | null)[] = [car, specs, extras];
  const first = (keys: string[]) => {
    for (const source of sources) for (const key of keys) {
      const found = text(source?.[key]);
      if (found) return found;
    }
    return null;
  };
  const sourceNotes: string[] = [];
  const seenRows = new Map<string, VehiclePrintFact>();
  const add = (rows: VehiclePrintFact[], label: string, raw: unknown) => {
    const value = text(raw);
    if (!value || finance.test(label)) return;
    const key = semanticKey(label);
    const existing = seenRows.get(key);
    if (existing && comparableValue(key, existing.value) === comparableValue(key, value)) return;
    if (existing && key !== 'historynote') sourceNotes.push(`Supplied ${existing.label.toLowerCase()} values differ: “${existing.value}” and “${value}”.`);
    else seenRows.set(key, { label, value });
    rows.push({ label, value });
  };
  const facts: VehiclePrintFact[] = [];
  const history: VehiclePrintFact[] = [];
  const runningCosts: VehiclePrintFact[] = [];
  const year = first(['year']);
  const identity = { title: text(car.title), make: text(car.make), model: text(car.model), year: car.year };
  const displayName = identity.title || identity.make || identity.model ? vehicleDisplayTitle(identity) : '';
  const title = [year, displayName].filter(Boolean).join(' ');
  const variant = first(['variant', 'trim']);
  let price: string | null = null;
  if (typeof car.price === 'number' && Number.isFinite(car.price) && car.price >= 0) {
    try {
      price = new Intl.NumberFormat('en-GB', { style: 'currency', currency: text(car.currency)?.toUpperCase() || 'GBP', minimumFractionDigits: Number.isInteger(car.price) ? 0 : 2, maximumFractionDigits: 2 }).format(car.price);
    } catch { price = String(car.price); }
  }
  const priceType = text(car.priceType);
  const priceNote = priceType && !/^(?:cash|full|retail|on the road|otr)$/i.test(priceType) && !finance.test(priceType)
    ? /^(?:plusvat|plus[_ -]vat|exvat|ex[_ -]vat|excluding vat)$/i.test(priceType) ? 'Excludes VAT'
      : /^(?:incvat|inc[_ -]vat|including vat|vat included)$/i.test(priceType) ? 'Includes VAT' : priceType
    : undefined;

  add(facts, 'Year', year);
  const actualPlate = [car.plate, car.vrm, car.registration].map(text).find(value => value && isUKNumberPlate(value));
  if (actualPlate) add(facts, 'Registration number', actualPlate.toUpperCase());
  const band = first(['registrationBand']) || (!actualPlate ? first(['registration', 'REGISTRATION']) : null);
  if (band && !isUKNumberPlate(band)) add(facts, 'Registration band', band);
  const registered = first(['firstRegistrationDate', 'registeredDate', 'vehicleRegisteredText']);
  if (registered) add(facts, 'First registered', registered.replace(/^vehicle registered:\s*/i, ''));
  const mileage = typeof car.mileage === 'number' && Number.isFinite(car.mileage) && car.mileage >= 0
    ? `${new Intl.NumberFormat('en-GB').format(car.mileage)} miles` : first(['mileageText', 'MILEAGE']);
  add(facts, 'Mileage', mileage);
  add(facts, 'Fuel', first(['fuel', 'fuelType', 'FUELTYPE']));
  add(facts, 'Gearbox', first(['transmission', 'gearbox', 'GEARBOX']));
  add(facts, 'Body type', first(['bodyType', 'BODYTYPE']));
  const engine = first(['engineSize', 'ENGINESIZELITRES', 'engineFormatted']);
  const displacement = first(['engineCC']);
  const engineCC = displacement && Number.isFinite(Number(displacement)) && Number(displacement) > 0 ? `${displacement}cc` : null;
  add(facts, 'Engine', engine && engineCC ? `${engine} (${engineCC})` : engine || engineCC);
  add(facts, 'Doors', first(['doors', 'DOORS']));
  add(facts, 'Seats', first(['seats', 'SEATS']));
  add(facts, 'Colour', first(['colour', 'color', 'BODYCOLOUR']));
  add(facts, 'Emission class', first(['emissionClass', 'EMISSIONCLASS']));
  add(facts, 'Drivetrain', first(['drivetrain']));

  const historyExtras = record(extras?.historyExtras);
  const ownersData = record(historyExtras?.ownersData);
  const historyItems = Array.isArray(historyExtras?.historyItems) ? historyExtras.historyItems : [];
  const service = record(historyExtras?.serviceHistory);
  const serviceType = text(service?.historyType);
  const serviceTypes: Record<string, string> = { FULL: 'Full service history', FULL_DEALERSHIP: 'Full dealership service history', SOME: 'Partial service history', NO_HISTORY: 'No service history' };
  const rawServiceDescription = text(service?.description);
  const serviceDescription = rawServiceDescription && !/^service history$/i.test(rawServiceDescription) ? rawServiceDescription : null;
  const serviceValue = serviceLabel(serviceDescription || (serviceType ? serviceTypes[serviceType] : null)
    || first(['serviceHistory', 'SERVICEHISTORY']));
  const ownerValues = [text(car.owners), text(ownersData?.value), ...historyItems.map(record).filter(row => row?.key === 'OWNERS').map(row => text(row?.value)), text(specs?.OWNERS)].filter((value): value is string => !!value);
  [...new Set(ownerValues)].forEach(value => add(history, 'Owners (listing)', value));
  if (serviceValue && !/^(?:service history|unknown)$/i.test(serviceValue)) add(history, 'Service history', serviceValue);
  for (const item of historyItems) {
    const row = record(item);
    if (row?.key === 'OWNERS') continue;
    if (row?.key === 'SERVICE_HISTORY') {
      const value = text(row?.value);
      const canonicalService = serviceLabel(value);
      if (canonicalService && !/^service history$/i.test(canonicalService)) add(history, 'Service history', canonicalService);
      continue;
    }
    const fact = rowFrom(item);
    if (fact) add(history, fact.label, fact.value);
  }
  const historyArrays = [historyExtras?.additionalItems, service?.additionalItems];
  for (const array of historyArrays) if (Array.isArray(array)) for (const item of array) {
    const fact = rowFrom(item);
    if (fact) add(history, fact.label, fact.value);
    else if (typeof item === 'string') add(history, 'History note', item);
  }
  const keyCount = first(['numberOfKeys', 'keyCount']);
  add(history, 'Keys', keyCount || first(['keys']));
  add(history, 'MOT expiry', first(['motExpiry', 'motExpiryDate']));
  add(history, 'Condition', first(['conditionNotes', 'condition']));
  add(history, 'Warranty', first(['warrantyDetails', 'warranty']));
  add(history, 'Listing note', first(['attentionGrabber']));
  const inventoryStatus = text(car.inventoryStatus)?.toLowerCase();
  const statusLabels: Record<string, string> = { available: 'Available', reserved: 'Reserved', sold: 'Sold', unavailable: 'Unavailable', withdrawn: 'Withdrawn', archived: 'Archived' };
  if (text(extras?.websiteSourceStatus)?.toLowerCase() === 'missing') add(history, 'Listing status', 'No longer advertised at source — confirm availability');
  else if (inventoryStatus && statusLabels[inventoryStatus]) add(history, 'Listing status', statusLabels[inventoryStatus]);
  for (const key of ['includedItems', 'includedWithVehicle']) {
    const raw = sources.map(source => source?.[key]).find(value => value !== null && value !== undefined);
    add(history, 'Included with this car', Array.isArray(raw) ? raw.map(text).filter(Boolean).join(' · ') : raw);
  }
  const writeOff = first(['writeOffCategory']);
  const check = record(extras?.writeOffCheck);
  const explicitWriteOff = text(extras?.writeOffStatusExplicit) || (check?.status === 'PASSED' ? text(check?.label) : null);
  if (writeOff) add(history, 'Insurance history', insuranceHistoryLabel(writeOff));
  else if (explicitWriteOff && /^(?:never been written off|no (?:recorded )?write[ -]?off(?: recorded)?|clear)$/i.test(explicitWriteOff)) add(history, 'Insurance history (listing)', explicitWriteOff);

  const costs = record(extras?.runningCosts);
  if (Array.isArray(costs?.items)) costs.items.forEach(item => { const fact = rowFrom(item); if (fact) add(runningCosts, fact.label, fact.value); });
  add(runningCosts, 'Insurance group', first(['insuranceGroup']));
  const specificationGroups: VehiclePrintData['specificationGroups'] = [];
  if (Array.isArray(extras?.specCategories)) for (const item of extras.specCategories) {
    const group = record(item);
    const groupTitle = text(group?.category ?? group?.title);
    if (!groupTitle || finance.test(groupTitle) || !Array.isArray(group?.items)) continue;
    const rows: VehiclePrintFact[] = [];
    group.items.forEach(item => { const fact = rowFrom(item); if (fact) add(rows, fact.label, fact.value); });
    if (rows.length) specificationGroups.push({ title: groupTitle, facts: rows });
  }
  // Some stock sources supply a flat specifications object rather than categories.
  // Recognise customer facts explicitly, keeping scraper IDs and raw metadata out.
  const flatFacts: Record<string, { label: string; section: string }> = {};
  const recognise = (keys: string[], label: string, section: string) => keys.forEach(key => { flatFacts[key] = { label, section }; });
  recognise(['acceleration'], 'Acceleration', 'Performance');
  recognise(['acceleration0to60', '060mph', 'zerotosixtymph'], '0–60mph', 'Performance');
  recognise(['acceleration0to62', '062mph', 'zerotosixtytwomph'], '0–62mph', 'Performance');
  recognise(['topspeed', 'maximumspeed'], 'Top speed', 'Performance');
  recognise(['enginepower', 'power', 'bhp', 'horsepower'], 'Engine power', 'Performance');
  recognise(['enginetorque', 'torque'], 'Engine torque', 'Performance');
  recognise(['cylinders', 'numberofcylinders'], 'Cylinders', 'Performance');
  recognise(['valves', 'numberofvalves'], 'Valves', 'Performance');
  recognise(['height'], 'Height', 'Size and dimensions');
  recognise(['length'], 'Length', 'Size and dimensions');
  recognise(['width'], 'Width', 'Size and dimensions');
  recognise(['wheelbase'], 'Wheelbase', 'Size and dimensions');
  recognise(['groundclearance'], 'Ground clearance', 'Size and dimensions');
  recognise(['fuelcapacity', 'fueltankcapacity'], 'Fuel tank capacity', 'Size and dimensions');
  recognise(['bootspace', 'bootspacelitres'], 'Boot space', 'Size and dimensions');
  recognise(['bootspaceseatsup', 'luggagecapacityseatsup'], 'Boot space (seats up)', 'Size and dimensions');
  recognise(['bootspaceseatsdown', 'luggagecapacityseatsdown'], 'Boot space (seats down)', 'Size and dimensions');
  recognise(['minimumkerbweight'], 'Minimum kerb weight', 'Size and dimensions');
  recognise(['kerbweight'], 'Kerb weight', 'Size and dimensions');
  recognise(['co2', 'co2emissions', 'co2emission', 'emissions'], 'CO₂ emissions', 'Running costs');
  recognise(['insurancegroup'], 'Insurance group', 'Running costs');
  recognise(['insurance'], 'Insurance', 'Running costs');
  recognise(['annualtax', 'taxperyear', 'annualroadtax'], 'Tax per year', 'Running costs');
  recognise(['tax', 'roadtax'], 'Road tax', 'Running costs');
  recognise(['fuelurban', 'urbanmpg'], 'Urban', 'Running costs');
  recognise(['fuelextraurban', 'extraurbanmpg'], 'Extra Urban', 'Running costs');
  recognise(['fuelaverage', 'averagempg', 'combinedmpg', 'mpg', 'milespergallon'], 'Average', 'Running costs');
  for (const [key, value] of Object.entries(specs || {})) {
    const definition = flatFacts[key.toLowerCase().replace(/[^a-z0-9]/g, '')];
    if (!definition || !text(value)) continue;
    if (definition.section === 'Running costs') add(runningCosts, definition.label, value);
    else {
      let group = specificationGroups.find(group => group.title.toLowerCase() === definition.section.toLowerCase());
      if (!group) { group = { title: definition.section, facts: [] }; specificationGroups.push(group); }
      add(group.facts, definition.label, value);
    }
  }
  for (let index = specificationGroups.length - 1; index >= 0; index--) if (!specificationGroups[index].facts.length) specificationGroups.splice(index, 1);

  const features: string[] = [];
  const seenFeatures = new Set<string>();
  const addFeature = (raw: unknown) => {
    const value = text(typeof raw === 'string' ? raw : record(raw)?.name);
    if (!value) return;
    const key = featureKey(value);
    if (!headings.has(key) && key !== 'none' && !seenFeatures.has(key) && !finance.test(value)) { seenFeatures.add(key); features.push(value); }
  };
  for (const source of [car.features, specs?.features, extras?.features, extras?.featureList, suppliedFeatures]) if (Array.isArray(source)) source.forEach(addFeature);
  if (Array.isArray(extras?.featuresHighlights)) for (const group of extras.featuresHighlights) {
    const featureItems = record(group)?.featureItems;
    if (!Array.isArray(featureItems)) continue;
    for (const block of featureItems) {
      const items = record(block)?.items;
      if (Array.isArray(items)) items.forEach(addFeature);
    }
  }
  const description = [car.description, specs?.description, extras?.description, extras?.advertDescription, suppliedDescription].map(text).find(Boolean) || null;
  if (description) {
    const counts: Record<string, string> = { zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10' };
    const mentionedOwners = [...description.matchAll(/\b(\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:previous\s+)?owners?\b/gi)];
    for (const mention of mentionedOwners) {
      const number = counts[mention[1].toLowerCase()] || mention[1];
      if (ownerValues.length && ownerValues.every(value => value !== number)) sourceNotes.push(`Confirm owners: listing reports ${[...new Set(ownerValues)].join(' / ')}; description states “${mention[0]}”.`);
    }
    if (serviceValue && /\b(?:partial|full)\b/i.test(serviceValue)) {
      const noHistory = description.match(/[^.!?]*(?:no service history|does not come with any service history)[^.!?]*/i)?.[0]?.trim();
      if (noHistory) {
        const dealerServiceOnly = /does not come with any service history except the service we have done on the car/i.test(noHistory);
        sourceNotes.push(`Confirm service history: listing reports “${serviceValue}”; description says no history${dealerServiceOnly ? ' apart from the dealer’s service' : ''}.`);
      }
    }
  }

  const photoCandidates: VehiclePrintData['photos'] = [];
  const seenPhotos = new Set<string>();
  const addPhoto = (raw: unknown) => {
    const image = record(raw);
    const src = safePhotoUrl(typeof raw === 'string' ? raw : image?.url);
    if (!src || seenPhotos.has(src)) return;
    seenPhotos.add(src);
    photoCandidates.push({ src, ...(text(image?.caption) ? { caption: text(image?.caption)! } : {}) });
  };
  if (Array.isArray(car.images)) car.images.forEach(addPhoto);
  const hero = safePhotoUrl(car.heroImage);
  if (hero && !seenPhotos.has(hero)) photoCandidates.unshift({ src: hero });
  const front = photoCandidates.find(photo => photo.src === hero) || photoCandidates.find(photo => /^(?:front|exterior)/i.test(photo.caption || '')) || photoCandidates[0];
  const rear = photoCandidates.find(photo => /^rear(?:\s+(?:left|right|exterior))?$/i.test(photo.caption || '') && photo !== front);
  const interior = photoCandidates.find(photo => /interior front|dashboard|cabin|cockpit|interior/i.test(photo.caption || '') && photo !== front && photo !== rear);
  const photos = [front, rear, interior, ...photoCandidates].filter((photo): photo is VehiclePrintData['photos'][number] => !!photo).filter((photo, index, list) => list.findIndex(other => other.src === photo.src) === index).slice(0, 3);
  return { title, variant, price, priceNote, facts, history, specificationGroups, runningCosts, features, description, sourceNotes: [...new Set(sourceNotes)], photos };
}
