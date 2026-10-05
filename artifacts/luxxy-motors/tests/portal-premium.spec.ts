import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Isolated local preview only; all API writes are blocked.');

for (const width of [390, 820, 1440]) {
  test(`portal New sale retains a worksheet across sections at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const writes: string[] = [];
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => {
      if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.continue();
      writes.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
      return route.fulfill({ status: 403, json: { error: 'This review blocks all API writes.' } });
    });
    await page.goto('/portal?section=enquiries');
    await expect(page.getByRole('heading', { name: 'Enquiry workspace', exact: true })).toBeVisible();
    const workspace = page.locator('.portal-premium-workspace');
    const heading = workspace.locator('.portal-workspace-heading');
    await expect(heading.getByRole('button', { name: 'New sale', exact: true })).toBeVisible();
    await expect(page.getByTestId('tab-enquiries')).toHaveAttribute('aria-current', 'page');
    await expect(heading.getByRole('heading', { level: 1 })).toHaveCSS('font-family', /Inter/);
    await heading.getByRole('button', { name: 'New sale', exact: true }).click();
    const sales = page.locator('#portal-content-sales');
    await expect(page.getByTestId('tab-sales')).toHaveAttribute('aria-current', 'page');
    await expect(sales.getByRole('heading', { name: 'Customer', exact: true })).toBeVisible();
    await sales.getByLabel('Customer name', { exact: true }).fill('Retained worksheet');
    await sales.getByLabel('Email', { exact: true }).fill('draft@example.test');
    await sales.getByRole('button', { name: 'Payments & receipts', exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await mkdir('output/ui-premium/portal', { recursive: true });
    await page.screenshot({ path: `output/ui-premium/portal/sales-${width}.png` });

    await page.getByTestId('tab-settings').click();
    await expect(page.getByTestId('input-identity-name')).toBeVisible();
    await expect(sales).toBeHidden();
    await page.screenshot({ path: `output/ui-premium/portal/settings-${width}.png` });
    await page.getByTestId('tab-sales').click();
    await expect(sales.getByRole('heading', { name: 'Payments & receipts', exact: true, level: 1 })).toBeVisible();
    await sales.getByRole('button', { name: 'Customer', exact: true }).click();
    await expect(sales.getByLabel('Customer name', { exact: true })).toHaveValue('Retained worksheet');
    await expect(sales.getByLabel('Email', { exact: true })).toHaveValue('draft@example.test');

    page.once('dialog', dialog => dialog.dismiss());
    await heading.getByRole('button', { name: 'New sale', exact: true }).click();
    await expect(sales.getByLabel('Customer name', { exact: true })).toHaveValue('Retained worksheet');
    page.once('dialog', dialog => dialog.accept());
    await heading.getByRole('button', { name: 'New sale', exact: true }).click();
    await expect(sales.getByLabel('Customer name', { exact: true })).toHaveValue('');
    await expect(sales.getByLabel('Email', { exact: true })).toHaveValue('');

    await page.getByTestId('tab-enquiries').click();
    await page.getByRole('tab', { name: 'All cars', exact: true }).click();
    await expect(page.getByLabel('Search all cars', { exact: true })).toBeVisible();
    await page.screenshot({ path: `output/ui-premium/portal/enquiries-stock-${width}.png` });
    await page.getByRole('tab', { name: 'Calendar', exact: true }).click();
    await expect(page.locator('.enquiry-calendar-agenda').getByRole('heading')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `output/ui-premium/portal/calendar-${width}.png` });
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('Sales remains inside the existing staff access boundary', async ({ page }) => {
  await page.route('**/api/portal/session', route => route.fulfill({ json: { state: 'forbidden', name: 'Denied fixture', email: 'denied@example.test' } }));
  await page.goto('/portal?section=sales');
  await expect(page.getByRole('heading', { name: 'Access unavailable', exact: true })).toBeVisible();
  await expect(page.getByTestId('tab-sales')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New sale', exact: true })).toHaveCount(0);
  await expect(page.locator('.sales-workspace')).toHaveCount(0);
});

test('the selected portal section stays visible on a narrow screen after loading and switching', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/**', route => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) return route.continue();
    return route.fulfill({ status: 403, json: { error: 'API writes are blocked.' } });
  });
  await page.goto('/portal?section=settings');
  await expect(page.getByTestId('input-identity-name')).toBeVisible();
  const currentSectionIsVisible = () => page.locator('.portal-section-nav').evaluate(navigation => {
    const current = navigation.querySelector('[aria-current="page"]');
    if (!current) return false;
    const item = current.getBoundingClientRect();
    const viewport = navigation.getBoundingClientRect();
    return item.left >= viewport.left - 1 && item.right <= viewport.right + 1;
  });
  await expect.poll(currentSectionIsVisible).toBe(true);
  await page.locator('.portal-workspace-heading').getByRole('button', { name: 'New sale', exact: true }).click();
  await expect(page.getByTestId('tab-sales')).toHaveAttribute('aria-current', 'page');
  await expect.poll(currentSectionIsVisible).toBe(true);
});
