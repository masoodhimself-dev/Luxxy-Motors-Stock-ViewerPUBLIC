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

const mobileViewports = [
  // The 320px layout wraps the opening copy and controls most; allow ~84px above
  // the measured position for font/rendering variance without hiding regressions.
  { width: 320, maxFirstCardTop: 1575 },
  // These widths share the same control layout; allow ~77px above the measured
  // position so a new wrapped line or spacing block still fails the check.
  { width: 375, maxFirstCardTop: 1500 },
  { width: 402, maxFirstCardTop: 1500 },
] as const;

const longCopyMobileViewports = [
  // Dealer copy and a long headline can add several lines at the narrowest supported phone width.
  { width: 320, maxFirstCardTop: 1950 },
  { width: 375, maxFirstCardTop: 1800 },
  { width: 402, maxFirstCardTop: 1750 },
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

async function assertHeroControlsAreFullyVisible(page: Page) {
  const controls = [
    {
      locator: page.getByTestId('button-hero-primary'),
      name: 'primary hero control',
    },
    {
      locator: page.getByTestId('link-hero-find-my-car'),
      name: 'secondary hero control',
    },
  ];
  const viewportWidth = page.viewportSize()?.width;

  expect(viewportWidth).toBeDefined();

  for (const { locator, name } of controls) {
    await expect(locator, name).toBeVisible();
    await expect(locator, name).toBeEnabled();

    const box = await locator.boundingBox();
    expect(box, `${name} should have a measurable hit area`).not.toBeNull();
    expect(box!.width, `${name} should have a non-zero width`).toBeGreaterThan(0);
    expect(box!.height, `${name} should have a non-zero height`).toBeGreaterThan(0);
    expect(box!.x, `${name} should not be clipped on the left`).toBeGreaterThanOrEqual(0);
    expect(
      box!.x + box!.width,
      `${name} should not be clipped on the right at ${viewportWidth}px`,
    ).toBeLessThanOrEqual(viewportWidth!);
  }

  await expect(page.getByTestId('link-hero-find-my-car')).toHaveAttribute('href', '/find-my-car');
}

async function assertKeyboardFocusIsVisible(locator: ReturnType<Page['getByTestId']>) {
  const focusStyle = await locator.evaluate((element) => {
    const styles = window.getComputedStyle(element);
    return {
      outlineStyle: styles.outlineStyle,
      outlineWidth: styles.outlineWidth,
      boxShadow: styles.boxShadow,
    };
  });

  expect(
    (focusStyle.outlineStyle !== 'none' && focusStyle.outlineWidth !== '0px') ||
      focusStyle.boxShadow !== 'none',
    'focused hero control should have a visible focus indicator',
  ).toBe(true);
}

async function tabToHeroPrimary(page: Page) {
  const primary = page.getByTestId('button-hero-primary');

  for (let tabPresses = 0; tabPresses < 100; tabPresses += 1) {
    await page.keyboard.press('Tab');
    if (await primary.evaluate((element) => document.activeElement === element)) {
      return;
    }
  }

  throw new Error('Keyboard navigation did not reach the primary hero control');
}

test('keeps the first stock card near the approved mobile position', async ({
  page,
}) => {
  for (const { width, maxFirstCardTop } of mobileViewports) {
    await page.setViewportSize({ width, height: 874 });
    await mockHomeData(page, stock);

    await page.goto('/');

    const firstCard = page.getByTestId('card-vehicle-mobile-layout-car');
    await expect(firstCard).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    const firstCardTop = (await firstCard.boundingBox())?.y;
    expect(firstCardTop).toBeDefined();
    expect(firstCardTop!).toBeGreaterThanOrEqual(1320);
    expect(firstCardTop!).toBeLessThanOrEqual(maxFirstCardTop);
  }
});

for (const { width, maxFirstCardTop } of mobileViewports) {
  test(`keeps the first stock card near the approved ${width}px position without hero images`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 874 });
    await mockHomeData(page, stockWithoutHeroImages);

    await page.goto('/');

    await expect(page.getByTestId('empty-featured-forecourt')).toBeVisible();
    const firstCard = page.getByTestId('card-vehicle-mobile-layout-car');
    await expect(firstCard).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    const firstCardTop = (await firstCard.boundingBox())?.y;
    expect(firstCardTop).toBeDefined();
    expect(firstCardTop!).toBeGreaterThanOrEqual(1320);
    expect(firstCardTop!).toBeLessThanOrEqual(maxFirstCardTop);
  });
}

for (const { width } of mobileViewports) {
  test(`keeps the ${width}px homepage within the viewport after using hero and stock controls`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 874 });
    await mockHomeData(page, stock);

    await page.goto('/');
    await page.evaluate(() => document.fonts.ready);

    await expect(page.getByTestId('button-hero-primary')).toBeVisible();
    await expect(page.getByTestId('link-hero-find-my-car')).toBeVisible();
    await expect(page.getByTestId('input-showroom-search')).toBeVisible();
    await expect(page.getByRole('button', { name: 'View matching cars' })).toBeVisible();
    await assertNoHorizontalOverflow(page);

    await page.getByTestId('button-hero-primary').click();
    await page.getByTestId('input-showroom-search').fill('BMW');
    await page.getByRole('button', { name: 'View matching cars' }).click();
    await assertNoHorizontalOverflow(page);
  });
}

test('moves keyboard focus to the results heading after hero activation', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 874 });
  await mockHomeData(page, stock);
  await page.goto('/');

    const resultsHeading = page.locator('#vehicle-results-heading');
  await tabToHeroPrimary(page);
  await assertKeyboardFocusIsVisible(page.getByTestId('button-hero-primary'));
  await page.keyboard.press('Enter');
  await expect(resultsHeading).toBeFocused();

  await page.goto('/');
  await tabToHeroPrimary(page);
  await page.keyboard.press('Space');
  await expect(resultsHeading).toBeFocused();
});

test('moves keyboard focus to results after stock-opening controls use Enter or Space', async ({ page }) => {
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
  await page.goto('/find-my-car');

  const menuButton = page.getByRole('button', { name: 'Open navigation menu' });
  await expect(menuButton).toBeVisible();
  await menuButton.press('Enter');

  const browseStock = page.getByRole('button', { name: 'Browse Stock' });

  const detailStockLink = page.getByRole('link', { name: /View all stock/ });
  await expect(enquiryStockLink).toHaveAttribute('href', '/#stock');
  await enquiryStockLink.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Latest arrivals' })).toBeFocused();
});

  const enquiryStockLink = page.getByTestId('link-browse-stock-from-enquiry');
