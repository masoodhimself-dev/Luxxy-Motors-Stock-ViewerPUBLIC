import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Audits the isolated local preview only.');

for (const width of [390, 820, 1440]) {
  test(`staff settings and workspace layout at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const writes: string[] = [];
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) {
        writes.push(`${route.request().method()} ${route.request().url()}`);
        await route.abort();
      } else await route.continue();
    });
    await page.route('**/api/reservations', route => route.fulfill({ json: { reservations: [{ id: 'audit-reservation', reference: 'AUDIT-001', vehicleTitle: '2018 Example car', customerName: 'Sample Customer', email: 'sample@example.test', phone: '07700 900123', createdAt: '2026-10-01T10:00:00Z', status: 'reserved', depositPence: 20000, amountReceivedPence: 0 }] } }));
    await page.goto('/portal');
    await expect(page.getByTestId('input-identity-name')).toBeVisible();
    await mkdir('/tmp/luxxy-portal-audit', { recursive: true });
    const nav = page.locator('[data-testid^="button-settings-nav-"]');
    const ids = await nav.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-testid')!));
    for (const id of ids) {
      await page.getByTestId(id).click();
      const section = id.replace('button-settings-nav-', '');
      await expect(page.locator(`#settings-${section}`)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${section} overflow`).toBeLessThanOrEqual(width);
      if (['identity', 'pages', 'review'].includes(section)) {
        await page.screenshot({ path: `/tmp/luxxy-portal-audit/settings-${section}-${width}.png` });
      }
    }
    await page.getByRole('button', { name: 'Show all sections', exact: true }).click();
    await expect(page.locator('#settings-identity')).toBeVisible();
    await expect(page.locator('#settings-review')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.getByTestId('tab-reservations').click();
    await expect(page.getByRole('heading', { name: 'Online reservations' })).toBeVisible();
    await expect(page.getByTestId('staff-reservation-audit-reservation')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel reservation', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Keep reservation', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'Keep reservation', exact: true }).click();
    await page.getByRole('combobox', { name: 'Reservation status' }).selectOption('cancelled');
    await expect(page.getByText('No cancelled reservations', { exact: true })).toBeVisible();
    await page.getByRole('combobox', { name: 'Reservation status' }).selectOption('all');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `/tmp/luxxy-portal-audit/reservations-${width}.png` });
    await page.goto('/portal/sales-demo');
    await page.getByRole('button', { name: 'New sale', exact: true }).click();
    for (const name of ['Customer', 'Vehicle', 'Part exchange', 'Payments', 'Documents', 'Handover']) {
      await page.getByRole('button', { name, exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${name} overflow`).toBeLessThanOrEqual(width);
      if (['Customer', 'Documents'].includes(name)) await page.screenshot({ path: `/tmp/luxxy-portal-audit/sales-${name.toLowerCase()}-${width}.png` });
    }
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('phone sales Next keeps the current section visible in its navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/**', route => ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) ? route.continue() : route.abort());
  await page.goto('/portal/sales-demo');
  await page.getByRole('button', { name: 'New sale', exact: true }).click();
  for (const name of ['Vehicle', 'Part exchange', 'Payments', 'Documents', 'Handover']) {
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    const active = page.getByRole('navigation', { name: 'Sale sections' }).getByRole('button', { name, exact: true });
    await expect(active).toBeInViewport({ ratio: 1 });
    if (name === 'Documents') await page.screenshot({ path: '/tmp/luxxy-portal-audit/sales-next-navigation-390.png' });
  }
});


test('staff connection failures can recover without incorrectly denying membership', async ({ page }) => {
  let failed = true;
  await page.route('**/api/portal/session', route => route.fulfill(failed
    ? { status: 503, json: { error: 'Temporary unavailable' } }
    : { json: { state: 'allowed', name: 'Sample Staff', email: 'staff@example.test' } }));
  await page.route('**/api/dealer-settings', route => route.request().method() === 'GET' ? route.continue() : route.abort());
  await page.goto('/portal');
  await expect(page.getByRole('heading', { name: 'Unable to load your workspace' })).toBeVisible();
  await expect(page.getByText(/not on the staff list/)).toHaveCount(0);
  await expect(page.getByTestId('input-identity-name')).toHaveCount(0);
  failed = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByTestId('input-identity-name')).toBeVisible();
});

test('forbidden staff access still shows the restricted state', async ({ page }) => {
  await page.route('**/api/portal/session', route => route.fulfill({ json: { state: 'forbidden', name: 'Sample Staff', email: 'staff@example.test' } }));
  await page.goto('/portal');
  await expect(page.getByRole('heading', { name: 'Access unavailable' })).toBeVisible();
  await expect(page.getByTestId('input-identity-name')).toHaveCount(0);
  await expect(page.getByTestId('tab-reservations')).toHaveCount(0);
});

test('phone onboarding Continue keeps its current step horizontally visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/**', route => ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) ? route.continue() : route.abort());
  await page.goto('/portal');
  await expect(page.getByTestId('input-identity-name')).toBeVisible();
  for (const section of ['contact', 'presentation', 'homepage', 'pages']) {
    await page.getByRole('button', { name: /^Continue to / }).click();
    const step = page.getByTestId(`button-settings-nav-${section}`);
    await expect(step).toHaveAttribute('aria-current', 'step');
    await expect.poll(() => step.evaluate(button => {
      const bounds = button.getBoundingClientRect();
      const viewport = button.parentElement!.getBoundingClientRect();
      return bounds.left >= viewport.left && bounds.right <= viewport.right;
    })).toBe(true);
  }
});
