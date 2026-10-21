import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // All interaction checks are read-only; neither messages nor bookings are submitted.
  await page.route('**/api/**', route => ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort());
});

for (const width of [320, 390, 820, 1024, 1440]) {
  test(`visit information replaces the showroom illustration at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.clock.install({ time: new Date('2026-10-19T09:00:00Z') });
    await page.route('**/api/dealer-settings', async route => {
      const response = await route.fetch();
      const settings = await response.json();
      // Confirmed details supplied by Masood, applied only to this browser's GET response.
      settings.address = { street: 'Rear of 176 Rayners Lane', city: 'London', postcode: 'HA2 8LY' };
      settings.hours = [{ days: 'Monday – Saturday', times: '08:00 – 18:00' }, { days: 'Sunday', times: 'Closed' }];
      settings.presentation = { ...settings.presentation, visitInstructions: '', parkingInstructions: '' };
      await route.fulfill({ response, json: settings });
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const visit = page.locator('#visit');
    await expect(visit.getByTestId('showroom-visit-panel')).toBeAttached();
    await visit.scrollIntoViewIfNeeded();
    await expect(visit.getByText('Rear of 176 Rayners Lane', { exact: true })).toBeVisible();
    await expect(visit.getByRole('status')).toContainText('Open now');
    await expect(visit.getByRole('status')).toContainText('Closes at 18:00 today');
    await expect(visit.locator('img')).toHaveCount(0);
    const directions = visit.getByRole('link', { name: 'Get directions', exact: true });
    await expect(directions).toHaveAttribute('href', /google\.com\/maps/);
    await visit.getByText('View all opening hours', { exact: true }).click();
    await expect(visit.getByText('Sunday', { exact: true })).toBeVisible();
    await expect(visit.getByText('Closed', { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`visit-${width}.png`) });
  });

  test(`stock filters combine before showing results at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/stock', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-testid^="card-vehicle-"]').first()).toBeVisible();
    await expect(page.getByLabel('Search the showroom')).toHaveAccessibleDescription(/automatic under £10k/);
    await page.getByRole('button', { name: 'Advanced search' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Transmission', {exact:true}).selectOption('Automatic');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Max budget', {exact:true}).selectOption('15000');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Transmission', {exact:true})).toHaveValue('Automatic');
    await expect(dialog.getByLabel('Max budget', {exact:true})).toHaveValue('15000');
    await expect(dialog.getByTestId('button-quick-automatic')).toHaveCount(0);
    await dialog.getByRole('button', { name: /^Show \d+ cars?$/ }).click();
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(/transmission=Automatic/);
    await expect(page).toHaveURL(/maxPrice=15000/);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`stock-${width}.png`) });
    const firstCar = page.locator('[data-testid^="card-vehicle-"]').first();
    await firstCar.getByRole('link', { name: /^View full details for/ }).click();
    await expect(page.locator('.vehicle-detail-grid h1')).toHaveCount(1);
    await page.getByRole('link', { name: 'Back to your results' }).click();
    await expect(page).toHaveURL(/transmission=Automatic/);
    await expect(page).toHaveURL(/maxPrice=15000/);
  });

  test(`vehicle identity is easy to find at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/stock', { waitUntil: 'domcontentloaded' });
    const carLink = page.locator('[data-testid^="card-vehicle-"]').first().getByRole('link', { name: /^View full details for/ });
    await carLink.click();
    const identity = page.getByTestId('vehicle-identity');
    await expect(identity).toBeVisible();
    await expect(page.locator('.vehicle-detail-grid h1')).toHaveCount(1);
    const bounds = await identity.boundingBox();
    const gallery = await page.locator('.vehicle-detail-gallery').boundingBox();
    expect(bounds).not.toBeNull();
    expect(gallery).not.toBeNull();
    if (width < 1100) expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(gallery!.y + 1);
    else expect(bounds!.x).toBeGreaterThan(gallery!.x);
    await expect(page.getByRole('button', { name: 'Share this vehicle' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Print vehicle details/ })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.locator('.gallery-photo').first().evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0), { timeout: 15_000 }).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`vehicle-${width}.png`) });
    const panel = page.getByTestId('showroom-visit-panel');
    await expect(panel).toHaveCount(1);
    await expect(panel.locator('img')).toHaveCount(0);
  });
}
