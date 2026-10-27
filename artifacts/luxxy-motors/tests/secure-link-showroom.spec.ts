import { expect, test, type Page } from '@playwright/test';
import { dealerConfig } from '../src/config/dealer';

const viewingToken = 'fixture-viewing-token-123456789012345678901234';
const viewingFixture = {
  reference: 'ENQ-FIXTURE', status: 'booked', customerName: 'Avery Morgan',
  appointmentAt: '2030-06-18T14:30:00.000Z', cancelledAt: null,
  timezone: 'Europe/London', vehicleTitle: '2022 BMW 1 Series', vehicleUrl: '/vehicle/fixture-bmw',
  calendarIcs: 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR', canChange: true,
};
async function mockShowroom(page: Page) {
  await page.route('**/api/**', route => ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort('blockedbyclient'));
  await page.route('**/api/dealer-settings', route => route.fulfill({ json: dealerConfig }));
  await page.route('**/api/stock', route => route.fulfill({ json: { schemaVersion: 1, dealerName: 'Luxxy Motors', count: 0, cars: [] } }));
}
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
}
for (const viewport of [{ width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1280, height: 900 }]) {
  test.describe(`customer link recovery at ${viewport.width}px`, () => {
    test.use({ viewport });
    test('valid viewing keeps the confirmed appointment and calendar action', async ({ page }) => {
      await mockShowroom(page);
      await page.route(`**/api/viewings/${viewingToken}`, route => route.fulfill({ json: viewingFixture }));
      await page.goto(`/viewing/${viewingToken}`);
      await expect(page.getByRole('heading', { name: 'Your viewing' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Add to calendar' })).toBeVisible();
      await expect(page.locator('main')).toContainText(viewingFixture.vehicleTitle);
      await fits(page);
    });
    test('viewing distinguishes a pending response from an expired link', async ({ page }) => {
      await mockShowroom(page);
      let release: () => void = () => {};
      const pending = new Promise<void>(resolve => { release = resolve; });
      await page.route(`**/api/viewings/${viewingToken}`, async route => {
        await pending;
        await route.fulfill({ status: 410, json: { error: 'This fixture link has expired.' } });
      });
      await page.goto(`/viewing/${viewingToken}`);
      await expect(page.getByTestId('loading-viewing-session')).toBeVisible();
      release();
      await expect(page.getByRole('heading', { name: 'Cannot find booking' })).toBeVisible();
      await fits(page);
    });
    test('old signing and customer-intake links show contact recovery without private API requests', async ({ page }) => {
      await mockShowroom(page);
      const privateReads: string[] = [];
      page.on('request', request => {
        if (/\/api\/(?:signing|customer-intake-sessions)\//.test(request.url())) privateReads.push(request.url());
      });
      for (const path of ['/sign/retired-fixture', '/customer-details/retired-fixture']) {
        await page.goto(path);
        await expect(page.getByRole('heading', { name: 'This link is no longer available' })).toBeVisible();
        await expect(page.locator('main').getByRole('link', { name: 'Contact us', exact: true })).toHaveAttribute('href', '/contact');
        await expect(page.locator('main').getByRole('link', { name: 'Browse stock', exact: true })).toHaveAttribute('href', '/stock');
        await fits(page);
      }
      expect(privateReads).toEqual([]);
    });
  });
}
