import { expect, test, type Page } from '@playwright/test';
import { dealerConfig } from '../src/config/dealer';

const tokens = {
  viewing: 'fixture-viewing-token-123456789012345678901234',
  signing: 'fixture-signing-token-123456789012345678901234',
  customer: 'fixture-customer-token-123456789012345678901234',
} as const;

const stockFixture = {
  schemaVersion: 1,
  dealerName: 'Luxxy Motors',
  dealerLocation: 'Harrow',
  count: 0,
  scrapedAt: null,
  cars: [],
};

const viewingFixture = {
  reference: 'ENQ-FIXTURE',
  status: 'booked',
  customerName: 'Avery Morgan',
  appointmentAt: '2030-06-18T14:30:00.000Z',
  cancelledAt: null,
  timezone: 'Europe/London',
  vehicleTitle: '2022 BMW 1 Series',
  vehicleUrl: '/vehicle/fixture-bmw',
  calendarIcs: 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR',
  canChange: true,
};

const customerFixture = {
  id: 'customer-session-fixture',
  vehicleId: 'fixture-bmw',
  status: 'pending',
  expiresAt: '2030-06-19T14:30:00.000Z',
  customerDetailsPath: `/customer-details/${tokens.customer}`,
  customer: null,
};

const completedCustomerFixture = {
  ...customerFixture,
  status: 'completed',
  customer: {
    id: 'customer-fixture',
    name: 'Avery Morgan',
    email: 'avery@example.com',
    phone: '+44 7700 900123',
  },
};

const signingFixture = {
  developmentOnly: true,
  warning: 'This is a fixture-backed customer signing session.',
  session: {
    status: 'pending',
    expiresAt: '2030-06-19T14:30:00.000Z',
  },
  sale: {
    agreedPricePence: 1299500,
    depositPence: 100000,
    balancePence: 1199500,
    currency: 'GBP',
  },
  customer: {
    name: 'Avery Morgan',
    email: 'avery@example.com',
  },
  revision: {
    revisionNumber: 1,
    packHash: 'fixture-pack-hash',
    snapshot: {
      vehicle: {
        value: '2022 BMW 1 Series',
        registration: 'AB22 XYZ',
        mileage: 30000,
      },
      details: {
        name: 'Avery Morgan',
        email: 'avery@example.com',
        phone: '+44 7700 900123',
      },
    },
    documents: [
      {
        id: 'document-fixture',
        title: 'Vehicle order',
        content: 'Fixture document content',
        contentHash: 'fixture-document-hash',
        required: true,
      },
    ],
    acknowledgements: [
      {
        code: 'vehicle-details',
        statement: 'I confirm that the vehicle details are correct.',
      },
    ],
  },
};

async function mockSharedShowroomApi(page: Page) {
  await page.route('**/api/dealer-settings', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(dealerConfig),
    }),
  );
  await page.route('**/api/stock', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(stockFixture),
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

async function assertCurrentShowroomVisuals(page: Page) {
  const visualState = await page.locator('main .luxxy-shell').first().evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundImage: style.backgroundImage,
      fontFamily: style.fontFamily,
    };
  });

  expect(visualState.backgroundImage).toBe('none');
  expect(visualState.fontFamily).toContain('DM Sans');

  const legacySurface = page.locator('main .luxxy-shell [class*="shadow-"]').first();
  await expect(legacySurface).toBeVisible();
  const surfaceStyle = await legacySurface.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      borderWidth: style.borderWidth,
      boxShadow: style.boxShadow,
    };
  });

  // Secure routes share the explicit, flat surface system.
  expect(surfaceStyle.borderWidth).toBe('1px');
  expect(surfaceStyle.boxShadow).toMatch(/^(none|.*0px 0px 0px 0px.*)$/);
  await assertNoHorizontalOverflow(page);
}

async function assertKeyboardFocusTreatment(page: Page, label: string) {
  const control = page.getByLabel(label);
  await control.focus();
  await expect.poll(() => control.evaluate((element) => parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(2);
  expect(await control.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none');
}

test.describe('secure customer links keep the showroom system', () => {
  for (const viewport of [
    { name: '390px mobile', width: 390, height: 844 },
    { name: 'desktop', width: 1280, height: 900 },
  ]) {
    test.describe(`${viewport.name} viewport`, () => {
      test.use({ viewport });

      test('previews valid viewing, signing and customer-details fixtures', async ({ page }) => {
        await mockSharedShowroomApi(page);

        await page.route(`**/api/viewings/${tokens.viewing}`, (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(viewingFixture),
          }),
        );
        await page.goto(`/viewing/${tokens.viewing}`);
        await expect(page.getByRole('heading', { name: 'Your Viewing' })).toBeVisible();
        await assertCurrentShowroomVisuals(page);

        await page.route(`**/api/signing/${tokens.signing}`, (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(signingFixture),
          }),
        );
        await page.goto(`/sign/${tokens.signing}`);
        await expect(page.getByRole('heading', { name: 'The vehicle' })).toBeVisible();
        await assertCurrentShowroomVisuals(page);

        await page.route(`**/api/customer-intake-sessions/${tokens.customer}`, (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(customerFixture),
          }),
        );
        await page.goto(`/customer-details/${tokens.customer}`);
        await expect(page.getByRole('heading', { name: 'Your details' })).toBeVisible();
        await assertCurrentShowroomVisuals(page);
        await assertKeyboardFocusTreatment(page, 'Full name');
      });

      test('previews loading and expired-link states without losing focus treatment', async ({ page }) => {
        await mockSharedShowroomApi(page);

        let releaseViewing: (() => void) | undefined;
        const viewingResponsePending = new Promise<void>((resolve) => {
          releaseViewing = resolve;
        });
        await page.route(`**/api/viewings/${tokens.viewing}`, async (route) => {
          await viewingResponsePending;
          await route.fulfill({
            status: 410,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'This fixture link has expired.' }),
          });
        });
        await page.goto(`/viewing/${tokens.viewing}`);
        await expect(page.getByTestId('loading-viewing-session')).toBeVisible();
        await assertCurrentShowroomVisuals(page);
        releaseViewing?.();
        await expect(page.getByRole('heading', { name: 'Cannot find booking' })).toBeVisible();
        await assertCurrentShowroomVisuals(page);

        let releaseSigning: (() => void) | undefined;
        const signingResponsePending = new Promise<void>((resolve) => {
          releaseSigning = resolve;
        });
        await page.route(`**/api/signing/${tokens.signing}`, async (route) => {
          await signingResponsePending;
          await route.fulfill({
            status: 410,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'This signing session has expired.' }),
          });
        });
        await page.goto(`/sign/${tokens.signing}`);
        await expect(page.getByTestId('loading-signing-session')).toBeVisible();
        await assertCurrentShowroomVisuals(page);
        releaseSigning?.();
        await expect(page.getByRole('heading', { name: 'Cannot open documents' })).toBeVisible();
        await assertCurrentShowroomVisuals(page);

        let releaseCustomer: (() => void) | undefined;
        const customerResponsePending = new Promise<void>((resolve) => {
          releaseCustomer = resolve;
        });
        await page.route(`**/api/customer-intake-sessions/${tokens.customer}`, async (route) => {
          await customerResponsePending;
          await route.fulfill({
            status: 410,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'This customer details link has expired.' }),
          });
        });
        await page.goto(`/customer-details/${tokens.customer}`);
        await expect(page.getByTestId('loading-customer-session')).toBeVisible();
        await assertCurrentShowroomVisuals(page);
        releaseCustomer?.();
        await expect(page.getByRole('heading', { name: 'Link unavailable' })).toBeVisible();
        await assertCurrentShowroomVisuals(page);
      });

      test('previews customer-details and signing success states from fixture responses', async ({ page }) => {
        await mockSharedShowroomApi(page);

        await page.route(`**/api/customer-intake-sessions/${tokens.customer}`, (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(customerFixture),
          }),
        );
        await page.route(`**/api/customer-intake-sessions/${tokens.customer}/complete`, (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(completedCustomerFixture),
          }),
        );
        await page.goto(`/customer-details/${tokens.customer}`);
        await page.getByLabel('Full name').fill('Avery Morgan');
        await page.getByLabel('Email address').fill('avery@example.com');
        await page.getByRole('button', { name: 'Save my details' }).click();
        await expect(page.getByRole('heading', { name: 'DETAILS SAVED' })).toBeVisible();
        await assertCurrentShowroomVisuals(page);

        await page.route(`**/api/signing/${tokens.signing}`, (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(signingFixture),
          }),
        );
        await page.route(`**/api/signing/${tokens.signing}/complete`, (route) =>
          route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ signed: true }),
          }),
        );
        await page.goto(`/sign/${tokens.signing}`);
        await page.getByLabel('I confirm that the vehicle details are correct.').check();
        await page.getByLabel('Signer name').fill('Avery Morgan');
        await page.getByLabel('Signer email').fill('avery@example.com');
        await page.getByRole('button', { name: 'Sign and agree' }).click();
        await expect(page.getByRole('heading', { name: 'THANK YOU, Avery Morgan' })).toBeVisible();
        await assertCurrentShowroomVisuals(page);
      });
    });
  }
});