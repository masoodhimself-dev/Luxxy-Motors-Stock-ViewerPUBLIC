import { mkdir } from 'node:fs/promises';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Local settings preview with every write intercepted.');

async function mockedSettings(page: Page, request: APIRequestContext, failFirst = false) {
  const response = await request.get('/api/dealer-settings');
  expect(response.ok()).toBeTruthy();
  let settings = await response.json();
  const original = structuredClone(settings);
  const submissions: any[] = [];
  const blocked: string[] = [];
  await page.route('**/api/**', async route => {
    const action = route.request();
    const path = new URL(action.url()).pathname;
    if (path === '/api/dealer-settings') {
      if (action.method() === 'GET') return route.fulfill({ json: settings, headers: { 'x-settings-revision': '1' } });
      if (action.method() === 'PATCH') {
        submissions.push(action.postDataJSON());
        if (failFirst && submissions.length === 1) return route.fulfill({ status: 503, json: { error: 'Preview publish failed. Please try again.' } });
        settings = action.postDataJSON();
        return route.fulfill({ json: settings, headers: { 'x-settings-revision': '1' } });
      }
    }
    if (['GET', 'HEAD'].includes(action.method())) return route.continue();
    blocked.push(`${action.method()} ${path}`);
    return route.fulfill({ status: 403, json: { error: 'Settings audit blocked this write.' } });
  });
  return { original, submissions, blocked };
}

async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function capture(page: Page, name: string) {
  if (process.env.LUXXY_CAPTURE_SETTINGS_WORKSPACE !== '1') return;
  const output = 'output/ui-premium/portal-settings';
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: `${output}/${name}.png`, animations: 'disabled' });
}

async function usable(page: Page, control: Locator) {
  await control.scrollIntoViewIfNeeded();
  await control.focus();
  await expect.poll(() => control.evaluate(element => {
    const saveBar = document.querySelector<HTMLElement>('.settings-save-bar');
    return !saveBar || getComputedStyle(saveBar).position !== 'sticky' || element.getBoundingClientRect().bottom <= saveBar.getBoundingClientRect().top - 12;
  })).toBe(true);
  expect(await control.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit === element || element.contains(hit);
  })).toBe(true);
  await fits(page);
}

for (const width of [390, 820, 1440]) {
  test(`settings retain drafts, validate imports and review before publishing at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    const audit = await mockedSettings(page, request);
    await page.goto('/portal?section=settings');
    const name = page.getByTestId('input-identity-name');
    await expect(name).toBeVisible();
    await expect(page.locator('.portal-settings-premium')).toBeVisible();
    await expect(name).toHaveCSS('font-family', /Inter/);
    await expect(page.locator('.settings-save-bar')).toHaveCSS('position', 'sticky');
    await usable(page, name);
    await fits(page);
    await capture(page, `identity-${width}`);
    const draftName = `Unpublished Showroom ${width}`;
    await name.fill(draftName);
    await expect(page.getByRole('status').filter({ hasText: 'Unpublished changes' })).toBeVisible();
    expect(audit.submissions).toHaveLength(0);
    await page.reload();
    await expect(name).toHaveValue(draftName);
    await expect(page.getByRole('status').filter({ hasText: 'Unpublished changes' })).toBeVisible();

    await page.getByTestId('button-settings-nav-presentation').click();
    const reviewText = page.getByLabel('Reviews JSON', { exact: true });
    await reviewText.fill('{');
    await page.getByRole('button', { name: 'Apply reviews JSON', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Invalid JSON' })).toBeVisible();
    expect(audit.submissions).toHaveLength(0);
    const review = { rating: 5, review: 'The team answered every question clearly.', name: 'Preview Customer', date: 'October 2026', source: 'Customer feedback', verified: true };
    await page.getByRole('checkbox', { name: 'Show customer reviews on the homepage', exact: true }).check();
    await reviewText.fill(JSON.stringify([review], null, 2));
    await page.getByRole('button', { name: 'Apply reviews JSON', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: '1 reviews applied' })).toBeVisible();
    await usable(page, reviewText);
    await capture(page, `reviews-import-${width}`);

    await page.getByTestId('button-settings-nav-services').click();
    await page.getByTestId('checkbox-online-reservation-enabled').check();
    await page.getByTestId('input-online-reservation-deposit').fill('250.50');
    const terms = page.getByTestId('textarea-online-reservation-terms');
    await terms.fill('');
    const publish = page.getByTestId('button-save-settings');
    await publish.click();
    await expect(page.getByTestId('status-settings-validation')).toContainText('Add your reservation terms');
    await expect(page.getByTestId('button-settings-nav-services')).toHaveAttribute('aria-current', 'step');
    expect(audit.submissions).toHaveLength(0);
    const reservationTerms = 'The dealership will contact you to discuss the reservation and explain the cancellation arrangements.';
    await terms.fill(reservationTerms);
    await usable(page, terms);
    await capture(page, `services-${width}`);
    await publish.click();
    await expect(page.locator('#settings-review')).toBeFocused();
    await expect(publish).toHaveText('Publish showroom');
    expect(audit.submissions).toHaveLength(0);
    await page.getByText('Preview your draft appearance', { exact: true }).click();
    await expect(page.getByText(review.review, { exact: true })).toBeVisible();
    await page.getByText(/^Launch readiness ·/).click();
    await expect(page.getByText('Review Email & payments and test a reservation before launch; this content check does not verify the payment connection', { exact: true })).toBeVisible();
    await fits(page);
    await capture(page, `review-${width}`);
    await publish.click();
    await expect(page.getByTestId('status-settings-success')).toContainText('Published to the showroom');
    expect(audit.submissions).toHaveLength(1);
    expect(audit.submissions[0]).toMatchObject({ identity: { name: draftName }, contact: audit.original.contact, hero: audit.original.hero, presentation: { reviewsEnabled: true, reviews: [review] }, onlineReservation: { enabled: true, depositPence: 25050, terms: reservationTerms } });
    await expect(page.getByRole('status').filter({ hasText: 'Unpublished changes' })).toHaveCount(0);
    await page.getByTestId('button-settings-nav-identity').click();
    await expect(name).toHaveValue(draftName);
    await page.reload();
    await expect(name).toHaveValue(draftName);
    await expect(page.getByRole('status').filter({ hasText: 'Unpublished changes' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Show all sections', exact: true }).click();
    await expect(page.locator('#settings-identity')).toBeVisible();
    await expect(page.locator('#settings-review')).toBeVisible();
    await fits(page);
    expect(audit.blocked).toEqual([]);
  });
}

test('failed publishing retains the draft and retry succeeds without losing fields', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const audit = await mockedSettings(page, request, true);
  await page.goto('/portal?section=settings');
  await page.getByTestId('input-identity-name').fill('Retry Draft Showroom');
  const publish = page.getByTestId('button-save-settings');
  await publish.click();
  await expect(page.locator('#settings-review')).toBeVisible();
  await publish.click();
  await expect(page.getByTestId('status-settings-error')).toContainText('Preview publish failed');
  await expect(page.getByRole('status').filter({ hasText: 'Unpublished changes' })).toBeVisible();
  await publish.click();
  await expect(page.getByTestId('status-settings-success')).toContainText('Published to the showroom');
  expect(audit.submissions).toHaveLength(2);
  expect(audit.submissions[1]).toEqual(audit.submissions[0]);
  expect(audit.submissions[1].identity.name).toBe('Retry Draft Showroom');
  expect(audit.blocked).toEqual([]);
});

test('short landscape keeps editing controls clear of the save bar', async ({ page, request }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  const audit = await mockedSettings(page, request);
  await page.goto('/portal?section=settings');
  await expect(page.getByTestId('input-identity-name')).toBeVisible();
  await page.getByTestId('button-settings-nav-services').click();
  await usable(page, page.getByTestId('textarea-online-reservation-terms'));
  await expect(page.locator('.settings-save-bar')).toHaveCSS('position', 'static');
  await capture(page, 'services-landscape-844');
  expect(audit.submissions).toEqual([]);
  expect(audit.blocked).toEqual([]);
});

for (const width of [390, 820, 1440]) {
  test(`all settings categories load without layout overflow at ${width}px`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 900 });
    const audit = await mockedSettings(page, request);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/portal?section=settings');
    const navigation = page.getByRole('navigation', { name: 'Dealership settings', exact: true });
    for (const [tab, heading] of [
      ['Email templates', 'Email templates'], ['Email & payments', 'API integrations'],
      ['Sales documents', 'Sales paperwork'], ['Website chat', 'Website chat'],
      ['Team', 'Your team'], ['Publish history', 'Publication history'],
    ]) {
      await navigation.getByRole('button', { name: tab, exact: true }).click();
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
      await fits(page);
      await capture(page, `category-${tab.replaceAll(' ', '-')}-${width}`);
    }
    expect(errors).toEqual([]);
    expect(audit.blocked).toEqual([]);
    expect(audit.submissions).toEqual([]);
  });
}
