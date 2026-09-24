import { expect, test } from '@playwright/test';
import { previewSettings } from '../preview/settings';

// All writes in this file are intercepted; no signing or publishing reaches a server.
test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Uses local preview fixtures.');

test('settings drafts survive navigation and reload without publishing, with explicit discard', async ({ page }) => {
  let writes = 0;
  await page.route('**/api/dealer-settings', async (route) => {
    if (route.request().method() !== 'GET') writes++;
    await route.fulfill({ json: previewSettings });
  });
  await page.goto('/portal');
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('input-identity-name').fill('Unpublished dealership');
  await expect(page.getByText('Unpublished changes', { exact: true })).toBeVisible();
  await page.getByTestId('link-preview-showroom').click();
  await expect(page.getByRole('button', { name: 'Luxxy Motors', exact: true })).toBeVisible();
  await page.goto('/portal');
  await page.getByTestId('tab-settings').click();
  await expect(page.getByTestId('input-identity-name')).toHaveValue('Unpublished dealership');
  await page.reload();
  await page.getByTestId('tab-settings').click();
  await expect(page.getByTestId('input-identity-name')).toHaveValue('Unpublished dealership');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Discard draft' }).click();
  await expect(page.getByTestId('input-identity-name')).toHaveValue('Luxxy Motors');
  await page.reload();
  await page.getByTestId('tab-settings').click();
  await expect(page.getByTestId('input-identity-name')).toHaveValue('Luxxy Motors');
  expect(writes).toBe(0);
});

test('colour picker and hex fields preserve the HSL settings contract; publishing clears drafts', async ({ page }) => {
  let settings = structuredClone(previewSettings);
  let updates = 0;
  await page.route('**/api/dealer-settings', async (route) => {
    if (route.request().method() === 'PATCH') { settings = route.request().postDataJSON(); updates++; }
    await route.fulfill({ json: settings });
  });
  await page.goto('/portal');
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('input-brand-primary-hex').fill('#123456');
  await page.getByTestId('input-brand-accent-hex').fill('#nope');
  await page.getByTestId('button-save-settings').click();
  expect(updates).toBe(0);
  await page.getByTestId('input-brand-accent-hex').fill('#996633');
  await page.getByTestId('button-save-settings').click();
  await expect(page.getByTestId('status-settings-success')).toBeVisible();
  expect(settings.identity.brandColors.primaryHsl).toMatch(/^210 /);
  expect(settings.identity.brandColors.accentHsl).toMatch(/^30 /);
  await expect(page.getByText('Unpublished changes', { exact: true })).toHaveCount(0);
  await page.reload();
  await page.getByTestId('tab-settings').click();
  await expect(page.getByTestId('input-brand-primary-hex')).toHaveValue('#123456');
});

test('budget ranges stay valid and applied filters can be removed when collapsed', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Advanced search' }).click();
  await page.getByRole('combobox', { name: 'Min budget', exact: true }).selectOption('20000');
  await page.getByRole('combobox', { name: 'Max budget', exact: true }).selectOption('5000');
  await expect(page.getByRole('combobox', { name: 'Min budget', exact: true })).toHaveValue('');
  await expect(page.getByRole('status').filter({ hasText: 'Minimum budget cleared' })).toBeVisible();
  await page.getByRole('button', { name: 'Advanced search' }).click();
  await page.getByRole('button', { name: 'Remove Up to £5,000 filter' }).click();
  await page.getByRole('button', { name: 'Advanced search' }).click();
  await expect(page.getByRole('combobox', { name: 'Max budget', exact: true })).toHaveValue('');
  await expect(page.getByText(/Category S records structural/)).toBeVisible();
});

test('empty stock has an actionable inventory message instead of filter advice', async ({ page }) => {
  await page.route('**/api/stock', (route) => route.fulfill({ json: { schemaVersion: 1, count: 0, cars: [], scrapedAt: null, dealerName: 'Luxxy Motors', dealerLocation: 'Harrow' } }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'No vehicles currently listed' })).toBeVisible();
  await expect(page.getByTestId('button-clear-filters')).toHaveCount(0);
  await page.getByRole('link', { name: 'Ask about upcoming stock' }).click();
  await expect(page.getByTestId('input-customer-name')).toBeVisible();
});

test('comparison hides equal specifications and keeps full vehicle names available', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByTestId('button-compare-preview-1').click();
  await page.getByTestId('button-compare-preview-2').click();
  await page.goto('/compare');
  await expect(page.getByTestId('compare-table').locator('dt')).toHaveCount(15);
  const before = await page.getByTestId('compare-table').locator('dt').allTextContents();
  await page.getByRole('checkbox', { name: 'Show differences only' }).check();
  const after = await page.getByTestId('compare-table').locator('dt').allTextContents();
  expect(after.length).toBeLessThan(before.length);
  await page.getByTestId('compare-table').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('compare-sticky-heading')).toBeInViewport();
  await page.getByRole('checkbox', { name: 'Show differences only' }).uncheck();
  await expect(page.getByTestId('compare-table').locator('dt')).toHaveCount(before.length);
});
