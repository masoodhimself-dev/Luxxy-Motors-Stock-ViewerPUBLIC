import { expect, test, type Page } from '@playwright/test';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Read-only mocked local portal audit.');

async function audit(page: Page) {
  const writes: string[] = [], errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => {
    if (['GET', 'HEAD'].includes(route.request().method())) return route.continue();
    writes.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    return route.abort();
  });
  await page.route('**/api/staff/team', route => route.fulfill({ json: { members: [
    { id: 'staff-owner', name: 'A long fictional showroom owner name for a narrow-screen layout audit', email: 'owner-with-a-long-name@example.test', role: 'owner', active: true },
    { id: 'staff-sales', name: 'Alex Sales', email: 'sales@example.test', role: 'salesperson', active: false },
  ] } }));
  await page.route('**/api/staff/settings-history', route => route.fulfill({ json: {
    revision: 2, versions: [
      { revision: 2, publishedAt: '2026-10-12T10:00:00Z', publishedBy: 'Fictional showroom owner with a longer staff name', action: 'publish' },
      { revision: 1, publishedAt: '2026-10-11T10:00:00Z', publishedBy: 'Fictional showroom owner', action: 'initial' },
    ],
  } }));
  return { writes, errors };
}
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const overflow = await page.locator('.dealer-settings-hub').evaluate(element => element.scrollWidth > element.clientWidth + 1);
  expect(overflow).toBe(false);
}

for (const width of [390, 820, 1440]) {
  test(`owner settings retain usable categories and contained fields at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const state = await audit(page);
    await page.goto('/portal?section=settings');
    const nav = page.getByRole('navigation', { name: 'Dealership settings' });
    await expect(page.getByTestId('input-identity-name')).toBeVisible();
    await fits(page);
    for (const section of ['contact', 'presentation', 'homepage', 'pages', 'services', 'proof', 'brochure', 'legal', 'review']) {
      await page.getByTestId(`button-settings-nav-${section}`).click();
      await expect(page.locator(`#settings-${section}`)).toBeVisible();
      await fits(page);
    }
    await nav.getByRole('button', { name: 'Email templates', exact: true }).click();
    await expect(page.getByLabel('Email to customise')).toBeVisible();
    const branding = page.locator('.email-branding-details');
    await expect(branding).not.toHaveAttribute('open');
    await branding.locator('summary').click();
    await expect(page.getByLabel('Email footer')).toBeVisible();
    await page.getByLabel('Email footer').fill('Fictional footer retained in the unpublished form.');
    await branding.locator('summary').click();
    await page.getByLabel('Email to customise').selectOption('payment_receipt');
    await branding.locator('summary').click();
    await expect(page.getByLabel('Email footer')).toHaveValue('Fictional footer retained in the unpublished form.');
    await fits(page);
    await page.screenshot({ path: `/private/tmp/luxxy-owner-emails-${width}.png`, fullPage: true });
    await nav.getByRole('button', { name: 'Email & stock', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'API integrations', exact: true })).toBeVisible();
    await expect(page.getByLabel(/API key/)).toHaveAttribute('type', 'password');
    const grid = page.locator('fieldset.integration-grid');
    const card = grid.locator(':scope > .integration-card');
    await expect(card).toHaveCount(1);
    expect(await card.evaluate(element => element.getBoundingClientRect().width)).toBeGreaterThan(await grid.evaluate(element => element.getBoundingClientRect().width * .9));
    await fits(page);
    await page.screenshot({ path: `/private/tmp/luxxy-owner-integrations-${width}.png`, fullPage: true });
    await nav.getByRole('button', { name: 'Sales documents', exact: true }).click();
    await expect(page.getByLabel('Terms and conditions of sale')).toBeVisible();
    await expect(page.getByLabel('Reservation and deposit terms')).toBeVisible();
    await fits(page);
    await page.screenshot({ path: `/private/tmp/luxxy-owner-paperwork-${width}.png`, fullPage: true });
    await nav.getByRole('button', { name: 'Team', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Your team', exact: true })).toBeVisible();
    await expect(page.getByLabel('Role for owner-with-a-long-name@example.test')).toHaveValue('owner');
    await fits(page);
    await page.screenshot({ path: `/private/tmp/luxxy-owner-team-${width}.png`, fullPage: true });
    await nav.getByRole('button', { name: 'Publish history', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Publication history', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Restore this version' })).toBeVisible();
    await fits(page);
    expect(state.writes).toEqual([]);
    expect(state.errors).toEqual([]);
  });
}

test('sales staff do not gain owner settings controls during the cosmetic changes', async ({ page }) => {
  const state = await audit(page);
  await page.route('**/api/staff/access', route => route.fulfill({ json: {
    role: 'salesperson', permissions: ['sales.manage', 'stock.manage'], user: { name: 'Fictional salesperson' },
  } }));
  await page.goto('/portal?section=settings');
  await expect(page.getByRole('heading', { name: 'Owner settings', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Dealership settings' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add staff access' })).toHaveCount(0);
  expect(state.writes).toEqual([]);
});
