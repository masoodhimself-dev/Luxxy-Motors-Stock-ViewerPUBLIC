import { expect, test } from '@playwright/test';
import { previewSettings } from '../preview/settings';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Uses local preview fixtures with intercepted settings writes.');

for (const width of [390, 1440]) {
  test(`online reservations require terms and save dealer deposit settings at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let settings = structuredClone(previewSettings);
    settings.onlineReservation = { enabled: false, depositPence: 10000, terms: '' };
    let writes = 0;
    await page.route('**/api/dealer-settings', async (route) => {
      if (route.request().method() === 'PATCH') {
        settings = route.request().postDataJSON();
        writes++;
      }
      await route.fulfill({ json: settings });
    });

    await page.goto('/portal');
    await page.getByTestId('tab-settings').click();
    await page.getByTestId('button-settings-nav-services').click();
    const enabled = page.getByTestId('checkbox-online-reservation-enabled');
    const amount = page.getByTestId('input-online-reservation-deposit');
    const terms = page.getByTestId('textarea-online-reservation-terms');
    await expect(enabled).not.toBeChecked();
    await enabled.check();
    await amount.fill('250.50');
    await page.getByTestId('button-save-settings').click();
    await expect(page.getByText('Add your reservation terms before enabling online reservations.', { exact: true })).toBeVisible();
    expect(writes).toBe(0);

    await terms.fill('The dealership will contact you to discuss your reservation.');
    await page.getByTestId('button-save-settings').click();
    await expect(page.getByTestId('status-settings-success')).toBeVisible();
    expect(settings.onlineReservation).toEqual({ enabled: true, depositPence: 25050, terms: 'The dealership will contact you to discuss your reservation.' });
    expect(writes).toBe(1);
    await page.reload();
    await page.getByTestId('tab-settings').click();
    await expect(enabled).toBeChecked();
    await expect(amount).toHaveValue('250.5');
    await enabled.uncheck();
    await page.getByTestId('button-save-settings').click();
    await expect(page.getByTestId('status-settings-success')).toBeVisible();
    expect(settings.onlineReservation?.enabled).toBe(false);
    expect(settings.onlineReservation?.depositPence).toBe(25050);
    expect(writes).toBe(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}
