import { expect, test, type Page } from '@playwright/test';

const stock = {
  schemaVersion: 1,
  dealerName: 'Luxxy Motors',
  dealerLocation: 'Harrow',
  count: 1,
  scrapedAt: null,
  cars: [
    {
      id: 'mobile-layout-car',
      advertId: 'mobile-layout-car',
      title: 'BMW 1 Series',
      variant: null,
      make: 'BMW',
      model: '1 Series',
      trim: null,
      year: 2022,
      price: 12995,
      priceType: 'fixed',
      currency: 'GBP',
      mileage: 30000,
      mileageText: null,
      registration: null,
      registrationBand: null,
      plate: null,
      vrm: null,
      vrmVerified: null,
      fuel: 'Petrol',
      transmission: 'Automatic',
      bodyType: 'Hatchback',
      engineSize: null,
      engineCC: null,
      doors: 5,
      seats: 5,
      colour: 'Black',
      emissionClass: null,
      drivetrain: null,
      owners: null,
      writeOffCategory: null,
      advertUrl: null,
      dealerName: 'Luxxy Motors',
      dealerLocation: 'Harrow',
      imageCount: 1,
      heroImage:
        'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="800" height="450"%3E%3Crect width="800" height="450" fill="%2318272b"/%3E%3C/svg%3E',
      images: [],
      specifications: null,
      sourceExtras: null,
    },
  ],
};

const stockWithoutHeroImages = {
  ...stock,
  cars: stock.cars.map((car) => ({
    ...car,
    heroImage: null,
    images: [],
  })),
};

async function mockHomeData(
  page: Page,
  stockResponse: typeof stock,
) {
  await page.route('**/api/stock', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stockResponse) }),
  );
  await page.route('**/api/dealer-settings', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
  );
  await page.route('**/api/recent-handovers', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ schemaVersion: 1, handovers: [] }),
    }),
  );
}

test('keeps the first stock card near the approved mobile position', async ({
  page,
}) => {
  await page.setViewportSize({ width: 402, height: 874 });
  await mockHomeData(page, stock);

  await page.goto('/');

  const firstCard = page.getByTestId('card-vehicle-mobile-layout-car');
  await expect(firstCard).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  const firstCardTop = (await firstCard.boundingBox())?.y;
  expect(firstCardTop).toBeDefined();
  expect(firstCardTop!).toBeGreaterThanOrEqual(1320);
  expect(firstCardTop!).toBeLessThanOrEqual(1500);
});

test('keeps the first stock card near the approved mobile position without hero images', async ({
  page,
}) => {
  await page.setViewportSize({ width: 402, height: 874 });
  await mockHomeData(page, stockWithoutHeroImages);

  await page.goto('/');

  await expect(page.getByTestId('empty-featured-forecourt')).toBeVisible();
  const firstCard = page.getByTestId('card-vehicle-mobile-layout-car');
  await expect(firstCard).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  const firstCardTop = (await firstCard.boundingBox())?.y;
  expect(firstCardTop).toBeDefined();
  expect(firstCardTop!).toBeGreaterThanOrEqual(1320);
  expect(firstCardTop!).toBeLessThanOrEqual(1500);
});