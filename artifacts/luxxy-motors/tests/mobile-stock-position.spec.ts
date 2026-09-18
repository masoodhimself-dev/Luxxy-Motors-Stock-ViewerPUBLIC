import { expect, test, type Page } from '@playwright/test';
import { dealerConfig } from '../src/config/dealer';

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

const mobileViewports = [320, 375, 390, 402] as const;

const longCopyMobileViewports = [
  // Dealer copy and a long headline can add several lines at the narrowest supported phone width.
  { width: 320, maxFirstCardTop: 1950 },
  { width: 375, maxFirstCardTop: 1800 },
  { width: 402, maxFirstCardTop: 1750 },
] as const;

const crossRouteHomeDestinations = [
  { label: 'Home', headingId: 'home-heading' },
  { label: 'Why Buy From Us', headingId: 'about-heading' },
  { label: 'Warranty', headingId: 'warranty-heading' },
  { label: 'Delivery', headingId: 'delivery-heading' },
  { label: 'Part Exchange', headingId: 'part-exchange-heading' },
] as const;
const longDealerCopySettings = {
  ...dealerConfig,
  hero: {
    ...dealerConfig.hero,
    copy:
      'Find a quality used car with confidence, from a dealer who keeps buying straightforward',
    announcement:
      'Independent used-car specialists helping drivers choose with confidence across Harrow, west London and the surrounding areas',
    subcopy:
      'Every vehicle is carefully selected, honestly described and prepared for a straightforward purchase, with clear answers and time to make the right decision.',
  },
};

const stockWithoutHeroImages = {
  ...stock,
  cars: stock.cars.map((car) => ({
    ...car,
    heroImage: null,
    images: [],
  })),
};

const stockWithBrokenHeroImage = {
  ...stock,
  cars: stock.cars.map((car) => ({
    ...car,
    heroImage: '/broken-featured-image.jpg',
    images: [],
  })),
};

const stockWithSimilarCar = {
  ...stock,
  count: 2,
  cars: [
    stock.cars[0],
    {
      ...stock.cars[0],
      id: 'similar-mobile-layout-car',
      advertId: 'similar-mobile-layout-car',
    },
  ],
};

const stockWithMultipleCars = {
  ...stock,
  count: 5,
  cars: Array.from({ length: 5 }, (_, index) => ({
    ...stock.cars[0],
    id: `mobile-layout-car-${index}`,
    advertId: `mobile-layout-car-${index}`,
  })),
};
async function mockHomeData(
  page: Page,
  stockResponse: typeof stock,
  settingsResponse?: typeof longDealerCopySettings,
) {
  await page.route('**/api/stock', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(stockResponse),
    }),
  );
  await page.route('**/api/dealer-settings', (route) =>
    route.fulfill({
      status: settingsResponse ? 200 : 500,
      contentType: 'application/json',
      body: JSON.stringify(settingsResponse ?? {}),
    }),
  );
  await page.route('**/api/recent-handovers', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ schemaVersion: 1, handovers: [] }),
    }),
  );
  await page.route('**/api/enquiries/availability*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ date: '2099-01-01', timezone: 'Europe/London', slots: [] }),
    }),
  );
}

async function assertNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));

  expect(
    dimensions.documentWidth,
    `document width ${dimensions.documentWidth}px exceeds viewport width ${dimensions.viewportWidth}px`,
  ).toBeLessThanOrEqual(dimensions.viewportWidth);
}

test('keeps the first stock card near the search on mobile', async ({
  page,
}) => {
  for (const width of mobileViewports) {
    await page.setViewportSize({ width, height: 874 });
    await mockHomeData(page, stock);

    await page.goto('/');

    const firstCard = page.getByTestId('card-vehicle-mobile-layout-car');
    await expect(firstCard).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    const firstCardTop = (await firstCard.boundingBox())?.y;
    expect(firstCardTop).toBeDefined();
    expect(firstCardTop!).toBeLessThanOrEqual(1050);
  }
});

for (const width of mobileViewports) {
  test(`keeps the first ${width}px stock card near the search without photos`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 874 });
    await mockHomeData(page, stockWithoutHeroImages);

    await page.goto('/');

    const firstCard = page.getByTestId('card-vehicle-mobile-layout-car');
    await expect(firstCard).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    const firstCardTop = (await firstCard.boundingBox())?.y;
    expect(firstCardTop).toBeDefined();
    expect(firstCardTop!).toBeLessThanOrEqual(1050);
  });
}

for (const width of mobileViewports) {
  test(`keeps the ${width}px homepage within the viewport while searching`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 874 });
    await mockHomeData(page, stock);

    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);

    await expect(page.getByTestId('input-showroom-search')).toBeVisible();
    await expect(page.getByRole('button', { name: 'View matching cars' })).toBeVisible();
    await assertNoHorizontalOverflow(page);

    await page.getByTestId('input-showroom-search').fill('BMW');
    await page.getByRole('button', { name: 'View matching cars' }).click();
    await assertNoHorizontalOverflow(page);
  });
}

test('moves keyboard focus to results after stock-opening controls use Enter or Space', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 874 });

  for (const key of ['Enter', 'Space'] as const) {
    await mockHomeData(page, stock);
    await page.goto('/');
    const resultsHeading = page.locator('#vehicle-results-heading');

    const matchingCars = page.getByRole('button', { name: 'View matching cars' });
    await matchingCars.focus();
    await page.keyboard.press(key);
    await expect(resultsHeading).toBeFocused();

    await page.goto('/');
    const quickFilter = page.getByTestId('button-quick-automatic');
    await quickFilter.focus();
    await page.keyboard.press(key);
    await expect(resultsHeading).toBeFocused();
  }

  for (const key of ['Enter', 'Space'] as const) {
    // Each case starts a new browsing session; showing all stock now persists on return.
    await page.evaluate(() => sessionStorage.removeItem("luxxy.browse.v1"));
    await mockHomeData(page, stockWithMultipleCars);
    await page.goto('/');
    const resultsHeading = page.locator('#vehicle-results-heading');
    const viewAll = page.getByTestId('button-view-all-vehicles');
    await viewAll.focus();
    await page.keyboard.press(key);
    await expect(resultsHeading).toBeFocused();
  }
});

test('moves keyboard focus to the stock heading after cross-route navigation', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 874 });
  await mockHomeData(page, stock);
  await page.goto('/enquire?type=viewing');

  const enquiryStockLink = page.getByTestId('link-browse-stock-from-enquiry');
  await expect(enquiryStockLink).toHaveAttribute('href', '/#stock');
  await enquiryStockLink.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Latest arrivals' })).toBeFocused();
});

for (const { label, headingId } of crossRouteHomeDestinations) {
  test(`moves keyboard focus to the ${label} heading after cross-route navigation`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 874 });
    await mockHomeData(page, stock);
    await page.goto('/find-my-car');

    const menuButton = page.getByRole('button', { name: 'Open navigation menu' });
    await expect(menuButton).toBeVisible();
    await menuButton.press('Enter');

    const destination = page
      .getByRole('navigation', { name: 'Mobile navigation' })
      .getByRole('button', { name: label, exact: true });
    await destination.focus();
    await destination.press('Enter');

    await expect(page.locator(`#${headingId}`)).toBeFocused();
  });
}

test('scrolls to a homepage section without requiring focus to move on same-page activation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 874 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockHomeData(page, stock);
  await page.goto('/');

  const menuButton = page.getByRole('button', { name: 'Open navigation menu' });
  await menuButton.press('Enter');

  const aboutLink = page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('button', {
    name: 'Why Buy From Us',
    exact: true,
  });
  await aboutLink.focus();
  await aboutLink.press('Enter');

  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await expect(page.locator('#about-heading')).not.toBeFocused();
});

for (const width of [768, 1024]) {
  test(`saved cars row layout avoids horizontal overflow on ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await mockHomeData(page, stockWithSimilarCar);
    await page.goto('/');
    // Setup a saved car to ensure row layout renders something
    await page.evaluate(() => {
      window.localStorage.setItem('luxxy.saved-cars.v1', JSON.stringify(['mobile-layout-car']));
    });
    await page.goto('/saved');
    await expect(page.getByTestId('row-vehicle-mobile-layout-car')).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });
}

for (const width of [320, 390, 768, 1024, 1440]) {
  test(`showroom controls and vehicle details fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockHomeData(page, stockWithMultipleCars);
    await page.goto('/');
    const firstCard = page.getByTestId('card-vehicle-mobile-layout-car-0');
    await expect(firstCard).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await assertNoHorizontalOverflow(page);
    if (width === 390) expect((await firstCard.boundingBox())!.y).toBeLessThan(900);

    const search = page.getByTestId('input-showroom-search');
    expect(await search.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
    await page.getByRole('button', { name: 'Advanced search' }).click();
    await expect(page.getByRole('combobox', { name: 'Make', exact: true })).toBeVisible();
    await assertNoHorizontalOverflow(page);
    await page.getByRole('button', { name: 'Advanced search' }).click();

    for (const control of [page.getByTestId('button-quick-automatic'), page.getByTestId('button-stock-view-cards'), page.getByTestId('button-save-mobile-layout-car-0')]) {
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await page.getByTestId('button-stock-view-compact').click();
    await expect(page.getByTestId('compact-vehicle-mobile-layout-car-0')).toBeVisible();
    await assertNoHorizontalOverflow(page);

    await page.goto('/vehicle/mobile-layout-car-0');
    await expect(page.getByRole('heading', { name: 'BMW 1 Series', level: 1, exact: true })).toBeVisible();
    await assertNoHorizontalOverflow(page);
    if (width < 1024) {
      const bar = page.getByTestId('mobile-conversion-bar');
      await expect(bar).toBeVisible();
      const bounds = (await bar.boundingBox())!;
      expect(bounds.x).toBe(0);
      expect(bounds.width).toBe(width);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(900);
      await expect(bar.getByRole('link', { name: 'Call about this vehicle' })).toBeVisible();
    }
  });
}
