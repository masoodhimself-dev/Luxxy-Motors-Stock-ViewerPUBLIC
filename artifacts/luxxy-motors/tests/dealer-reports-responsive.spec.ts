import { test, expect } from '@playwright/test';

// Vite's local preview uses fictional authentication and mock records. All
// external requests and all non-read API calls are blocked in these tests.
for (const width of [390, 820, 1440]) {
  test(`Reports is usable at ${width}px with only fictional data`, async ({ page }) => {
    const errors: string[] = [];
    const writes: string[] = [];
    const requested: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width, height: 950 });
    await page.route(/^https?:\/\//, route => new URL(route.request().url()).origin === 'http://127.0.0.1:4289' ? route.continue() : route.abort());
    await page.route('**/api/**', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (!['GET', 'HEAD'].includes(request.method())) { writes.push(`${request.method()} ${url.pathname}`); return route.abort(); }
      if (url.pathname === '/api/staff/access') return route.fulfill({ json: { role: 'owner', permissions: ['sales.manage', 'finance.export', 'settings.publish'], user: { authUserId: 'test-owner', name: 'Test Owner' } } });
      if (url.pathname === '/api/dealer-reports') {
        const period = url.searchParams.get('period') || '30d'; requested.push(period);
        return route.fulfill({ json: { period, from: '2026-09-27T12:00:00Z', to: '2026-10-27T12:00:00Z', enquiries: { received: period === '90d' ? 27 : 12, newNow: 2 }, bookings: { scheduled: 5, pending: 1 }, sales: { completed: 3 }, popularVehicles: [{ vehicleId: 'fictional', title: 'FictionalCarWithAnExceptionallyLongUnbrokenNameForResponsiveLayoutTesting', enquiries: 4 }] } });
      }
      return route.continue();
    });
    await page.goto('/portal?section=reports');
    await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText('FictionalCarWithAnExceptionallyLongUnbrokenNameForResponsiveLayoutTesting')).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'Portal sections' });
    await expect(nav.getByRole('button', { name: 'Reports' })).toBeVisible();
    await expect(nav.getByRole('button', { name: 'Settings' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const navBounds = await nav.boundingBox();
    for (const name of ['Inbox', 'Sales', 'Reports', 'Settings']) {
      const bounds = await nav.getByRole('button', { name }).boundingBox();
      expect(bounds && navBounds && bounds.x >= navBounds.x && bounds.x + bounds.width <= navBounds.x + navBounds.width + 1).toBeTruthy();
    }
    await page.screenshot({ path: `/private/tmp/luxxy-reports-${width}.png`, animations: 'disabled', fullPage: true });
    await page.getByLabel('Report period').selectOption('90d');
    await expect(page.getByText('27', { exact: true })).toBeVisible();
    expect(requested).toEqual(['30d', '90d']);
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
}
