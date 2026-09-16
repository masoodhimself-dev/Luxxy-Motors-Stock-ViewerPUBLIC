import type { Car, StockData } from '../src/lib/stock-context';

const examples = [
  { make: 'BMW', model: '1 Series', variant: '118i M Sport · Sample vehicle', price: 12995, year: 2020, mileage: 32400, transmission: 'Automatic' },
  { make: 'Volkswagen', model: 'Golf', variant: '1.4 TSI SE · Sample vehicle', price: 8995, year: 2018, mileage: 48200, transmission: 'Manual' },
  { make: 'Mercedes-Benz', model: 'A Class', variant: 'A180 AMG Line · Sample vehicle', price: 14995, year: 2021, mileage: 28750, transmission: 'Automatic' },
  { make: 'Ford', model: 'Fiesta', variant: '1.0 EcoBoost Zetec · Sample vehicle', price: 4995, year: 2015, mileage: 68100, transmission: 'Manual' },
];

export const previewStock: StockData = {
  schemaVersion: 1, dealerName: 'Luxxy Motors', dealerLocation: 'Harrow', count: examples.length, scrapedAt: null,
  cars: examples.map((example, index): Car => ({
    id: `preview-${index + 1}`, advertId: `preview-${index + 1}`,
    title: `${example.make} ${example.model}`, trim: null, priceType: 'cash', currency: 'GBP',
    mileageText: null, registration: null, registrationBand: null, plate: null, vrm: null, vrmVerified: null,
    fuel: 'Petrol', bodyType: 'Hatchback', engineSize: null, engineCC: null, doors: 5, seats: 5,
    colour: null, emissionClass: null, drivetrain: null, owners: null, writeOffCategory: null, advertUrl: null,
    dealerName: 'Luxxy Motors', dealerLocation: 'Harrow', imageCount: 0, heroImage: null, images: [],
    specifications: null, sourceExtras: null, ...example,
  })),
};
