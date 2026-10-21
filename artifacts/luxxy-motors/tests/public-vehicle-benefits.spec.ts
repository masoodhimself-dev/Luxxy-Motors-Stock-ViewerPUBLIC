import { expect, test } from '@playwright/test';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Isolated fictional public stock only');
test.use({ reducedMotion: 'reduce', serviceWorkers: 'block' });

for (const width of [390, 820, 1440]) test(`public vehicle benefits, explanations and equipment at ${width}px`, async ({ page, request }) => {
  await page.setViewportSize({ width, height: 1000 });
  const baseline = await (await request.get('/api/stock')).json();
  const photo = 'https://images.example.com/benefit-photo.jpg';
  const car = {
    ...baseline.cars[0], id: 'fictional-public-benefits', advertId: 'fictional-public-benefits', title: 'Ford Fiesta', make: 'Ford', model: 'Fiesta',
    year: 2016, price: 5995, currency: 'GBP', mileage: 24000, fuel: 'Petrol', emissionClass: 'Euro 6', owners: 2,
    heroImage: photo, images: [{ url: photo, caption: 'Front exterior' }], imageCount: 1, inventoryStatus: 'available', specifications: null,
    sourceExtras: { description: 'Supplied fictional description for the responsive layout test.', serviceHistory: 'Full service history',
      features: ['Body-coloured door handles', 'Alloy wheels', 'Chrome grille', 'Rear wiper', 'Tinted glass', 'Manual seats', 'Cloth upholstery', 'Roof aerial', 'Rear Parking Sensors', 'Apple CarPlay', 'Heated Front Seats', 'ISOFIX child-seat mounts'],
      runningCosts: { title: 'Running costs', items: [{ label: 'Tax per year', value: '£20' }, { label: 'Insurance group', value: '11E' }] } },
  };
  const unknown = { ...car, id: 'fictional-public-unknown', advertId: 'fictional-public-unknown', title: 'Unknown supplied facts', mileage: null, fuel: null, emissionClass: null, owners: null, sourceExtras: null };
  const writes: string[] = [], errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(photo, route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><rect width="800" height="600" fill="#e4e9ed"/><text x="400" y="300" text-anchor="middle" font-size="30">Fictional vehicle photo</text></svg>' }));
  await page.route('**/api/**', route => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) { writes.push(route.request().url()); return route.abort('blockedbyclient'); }
    if (new URL(route.request().url()).pathname === '/api/stock') return route.fulfill({ json: { ...baseline, cars: [car, unknown], count: 2 } });
    return route.continue();
  });
  await page.goto('/stock');
  const card = page.getByTestId(`card-vehicle-${car.id}`);
  const highlights = card.getByRole('list', { name: 'Vehicle highlights' });
  await expect(highlights.getByRole('listitem')).toHaveCount(4);
  await expect(highlights).toContainText('ULEZ compliant');
  await expect(highlights).toContainText('24,000 miles · low mileage');
  await expect(highlights).toContainText('£20 road tax per year');
  await expect(highlights).toContainText('Insurance group 11E');
  await expect(highlights.locator('svg')).toHaveCount(0);
  await expect(page.getByTestId(`card-vehicle-${unknown.id}`).getByRole('list', { name: 'Vehicle highlights' })).toHaveCount(0);
  await highlights.getByRole('button', { name: 'Insurance group 11E', exact: true }).click();
  await expect(page.getByRole('tooltip')).toContainText(/your premium depends on your circumstances/i);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await card.screenshot({ path: `/tmp/public-benefit-card-${width}.png` });

  await page.goto(`/vehicle/${car.id}`);
  const summary = page.locator('.vehicle-summary');
  await expect(summary.getByRole('list', { name: 'Vehicle highlights' }).getByRole('listitem')).toHaveCount(6);
  await expect(summary.getByRole('link', { name: 'Check with TfL' })).toHaveAttribute('href', 'https://tfl.gov.uk/modes/driving/ultra-low-emission-zone/ulez-vrm-checker');
  await expect(summary).toContainText('Check this car’s registration before driving in the zone.');
  await expect(summary).not.toContainText('below average');
  const equipment = page.locator('.vehicle-features-section');
  const shown = equipment.locator('> .vehicle-equipment-list');
  await expect(shown).toContainText('Apple CarPlay');
  await expect(shown).toContainText('Rear Parking Sensors');
  await expect(shown).toContainText('Heated Front Seats');
  await equipment.getByText('View all 12 features', { exact: true }).click();
  await expect(equipment).toContainText('Roof aerial');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await summary.screenshot({ path: `/tmp/public-benefit-detail-${width}.png` });
  await page.goto('/saved?cars=' + encodeURIComponent(car.id));
  await expect(page.getByTestId(`compact-vehicle-${car.id}`).getByRole('list', { name: 'Vehicle highlights' })).toContainText('Insurance group 11E');
  await expect(page.locator('.saved-car-list details')).toHaveCount(0);
  await page.getByRole('link', {name:'View vehicle',exact:true}).click();
  await expect(page.locator('.vehicle-features-section')).toContainText('Apple CarPlay');
  expect(writes).toEqual([]); expect(errors).toEqual([]);
});
