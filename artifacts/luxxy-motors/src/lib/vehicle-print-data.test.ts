import { expect, it } from 'vitest';
import type { Car } from './stock-context';
import { vehiclePrintData } from './vehicle-print-data';
const car = (data: object) => data as Car;

it('omits missing details and source placeholders without assuming history or registration', () => {
  const data = vehiclePrintData(car({ id: 'missing', title: null, year: null, price: null, mileage: null, registration: '2016 (66 reg)', keys: 'Contact seller', sourceExtras: { serviceHistory: 'Service history', historyExtras: { serviceHistory: { historyType: 'UNKNOWN', description: 'Service history not provided' }, historyItems: [{ key: 'KEYS', label: 'Keys', value: 'Contact seller' }] } } }));
  expect(data.price).toBeNull();
  expect(data.title).toBe('');
  expect(data.history).toEqual([]);
  expect(data.facts).toEqual([{ label: 'Registration band', value: '2016 (66 reg)' }]);
  expect(data.description).toBeNull();
  expect(data.features).toEqual([]);
  expect(data.photos).toEqual([]);
});

it('keeps every genuine feature including nested added extras without truncation or headings', () => {
  const longFeature = 'A genuine supplied feature '.repeat(12).trim();
  const description = 'Full supplied description '.repeat(80).trim();
  const data = vehiclePrintData(car({ features: ['Interior', 'Heated seats'], specifications: { features: ['HEATED SEATS', 'Bluetooth'] }, sourceExtras: { advertDescription: description, featureList: ['Please note:', 'Panoramic roof'], featuresHighlights: [{ title: 'Added extras', featureItems: [{ items: [{ name: 'Panoramic roof' }, { name: longFeature }] }] }] } }), ['Unknown', 'Cruise control']);
  expect(data.features).toEqual(['Heated seats', 'Bluetooth', 'Panoramic roof', 'Cruise control', longFeature]);
  expect(data.description).toBe(description);
});

it('retains all customer specification groups and running costs, deduplicating matching repeated facts', () => {
  const data = vehiclePrintData(car({ seats: 5, owners: 2, sourceExtras: { runningCosts: { items: [{ label: 'Tax per year', value: '£0' }, { label: 'Average', value: '61.4mpg' }, { label: 'Insurance group', value: '11E' }] }, insuranceGroup: '11E', specCategories: [{ category: 'Performance', items: [{ name: 'Miles per gallon', value: '61.4mpg' }, { name: 'Engine power', value: '99BHP' }] }, { category: 'Size and dimensions', items: [{ name: 'Seats', value: '5' }, { name: 'Boot space (seats up)', value: '316L' }] }, { category: 'Finance', items: [{ name: 'Monthly payment', value: '£100' }] }], historyExtras: { ownersData: { value: '2' }, serviceHistory: { historyType: 'NO_HISTORY', description: 'No service history', additionalItems: [{ label: 'Last service', value: 'September 2026' }] }, historyItems: [{ key: 'OWNERS', label: 'Owners', value: '2' }, { key: 'SERVICE_HISTORY', label: 'Service history', value: 'None' }] } } }));
  expect(data.runningCosts).toEqual([{ label: 'Tax per year', value: '£0' }, { label: 'Average', value: '61.4mpg' }, { label: 'Insurance group', value: '11E' }]);
  expect(data.specificationGroups).toEqual([{ title: 'Performance', facts: [{ label: 'Engine power', value: '99BHP' }] }, { title: 'Size and dimensions', facts: [{ label: 'Boot space (seats up)', value: '316L' }] }]);
  expect(data.history).toEqual([{ label: 'Owners (listing)', value: '2' }, { label: 'Service history', value: 'No service history' }, { label: 'Last service', value: 'September 2026' }]);
  expect(data.sourceNotes).toEqual([]);
});

it('preserves supplied description and flags contradictory ownership and service information', () => {
  const description = '6 Owners. Please be aware this vehicle does not come with any service history except the service we have done on the car.';
  const data = vehiclePrintData(car({ owners: 7, sourceExtras: { advertDescription: description, historyExtras: { ownersData: { value: '7' }, serviceHistory: { historyType: 'SOME', description: 'Partial service history' } } } }));
  expect(data.description).toBe(description);
  expect(data.history).toContainEqual({ label: 'Owners (listing)', value: '7' });
  expect(data.sourceNotes).toHaveLength(2);
  expect(data.sourceNotes).toEqual(['Confirm owners: listing reports 7; description states “6 Owners”.', 'Confirm service history: listing reports “Partial service history”; description says no history apart from the dealer’s service.']);
});

it('prints supplied cash price with pence and VAT qualifier, and an actual valid UK plate only', () => {
  const data = vehiclePrintData(car({ title: '2020 MG MG HS', make: 'MG', model: 'MG HS', year: 2020, price: 12345.67, currency: 'GBP', priceType: 'PLUS_VAT', plate: 'AB20 CDE', registrationBand: '20 reg', mileage: 0, engineSize: '1.5L', engineCC: 1498 }));
  expect(data.title).toBe('2020 MG HS');
  expect(data.price).toBe('£12,345.67');
  expect(data.priceNote).toBe('Excludes VAT');
  expect(data.facts).toContainEqual({ label: 'Registration number', value: 'AB20 CDE' });
  expect(data.facts).toContainEqual({ label: 'Mileage', value: '0 miles' });
  expect(data.facts).toContainEqual({ label: 'Engine', value: '1.5L (1498cc)' });
  expect(vehiclePrintData(car({ plate: 'Not supplied', registrationBand: '20 reg' })).facts).toEqual([{ label: 'Registration band', value: '20 reg' }]);
});

it('selects supplied exterior, rear and interior photos while rejecting unsafe URLs and duplicates', () => {
  const data = vehiclePrintData(car({ heroImage: 'https://images.test/front.jpg', images: [{ url: 'https://images.test/front.jpg', caption: 'Front Right' }, { url: 'https://images.test/left.jpg', caption: 'Front Left' }, { url: 'https://images.test/rear.jpg', caption: 'Rear' }, { url: 'javascript:alert(1)', caption: 'Interior Front' }, { url: 'https://images.test/interior.jpg', caption: 'Interior Front' }] }));
  expect(data.photos).toEqual([{ src: 'https://images.test/front.jpg', caption: 'Front Right' }, { src: 'https://images.test/rear.jpg', caption: 'Rear' }, { src: 'https://images.test/interior.jpg', caption: 'Interior Front' }]);
});

it('includes unique flat specification facts without dumping arbitrary source metadata', () => {
  const data = vehiclePrintData(car({ specifications: { TOP_SPEED: '115mph', ENGINE_POWER: '99BHP', FUEL_AVERAGE: '61.4mpg', TAX: '£20', INSURANCE_GROUP: '11E', HEIGHT: '1,484mm', BOOT_SPACE_SEATS_UP: '316L', generationId: '123456', arbitraryMetadata: 'internal source record', MONTHLY_PAYMENT: '£99' }, sourceExtras: { writeOffStatusExplicit: true, writeOffCheck: { status: 'UNKNOWN', label: 'Unknown' } } }));
  expect(data.specificationGroups).toEqual([{ title: 'Performance', facts: [{ label: 'Top speed', value: '115mph' }, { label: 'Engine power', value: '99BHP' }] }, { title: 'Size and dimensions', facts: [{ label: 'Height', value: '1,484mm' }, { label: 'Boot space (seats up)', value: '316L' }] }]);
  expect(data.runningCosts).toEqual([{ label: 'Average', value: '61.4mpg' }, { label: 'Road tax', value: '£20' }, { label: 'Insurance group', value: '11E' }]);
  expect(data.history).toEqual([]);
  expect(JSON.stringify(data)).not.toMatch(/123456|arbitrary|£99/);
});

it('prioritises missing source listings without implying sold or assuming availability', () => {
  expect(vehiclePrintData(car({ inventoryStatus: 'available', sourceExtras: { websiteSourceStatus: 'missing' } })).history).toEqual([{ label: 'Listing status', value: 'No longer advertised at source — confirm availability' }]);
  expect(vehiclePrintData(car({ inventoryStatus: 'reserved' })).history).toEqual([{ label: 'Listing status', value: 'Reserved' }]);
  expect(vehiclePrintData(car({ inventoryStatus: 'sold' })).history).toEqual([{ label: 'Listing status', value: 'Sold' }]);
  expect(vehiclePrintData(car({})).history).toEqual([]);
});

it('uses supplied make and model when the original title is a placeholder', () => {
  expect(vehiclePrintData(car({ title: 'Not supplied', make: 'Ford', model: 'Focus', year: 2015 })).title).toBe('2015 Ford Focus');
  expect(vehiclePrintData(car({ title: 'Unknown', make: 'N/A', model: 'Focus', year: 2015 })).title).toBe('2015 Focus');
  expect(vehiclePrintData(car({ title: 'Not provided', make: 'Unknown', model: 'Contact seller' })).title).toBe('');
});
