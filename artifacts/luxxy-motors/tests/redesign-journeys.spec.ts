import { expect, test, type Page } from '@playwright/test';

test.skip(
  process.env.LUXXY_LOCAL_PREVIEW !== '1',
  'The visual harness uses synthetic staff records and blocks writes.',
);
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => innerWidth),
  );
}
for (const width of [320, 390, 768, 1440]) {
  test(`customer and staff journeys fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const path of [
      '/',
      '/vehicle/preview-1',
      '/saved',
      '/compare',
      '/find-my-car',
      '/enquire?type=viewing&vehicleId=preview-1',
      '/enquire?type=part_exchange',
      '/viewing/sample',
      '/customer-details/sample',
      '/sign/sample',
      '/missing',
    ]) {
      await page.goto(path);
      await expect(page.locator('#main-content')).toBeVisible();
      await expect(page.locator('#main-content h1')).toBeVisible();
      await fits(page);
    }
    for (const id of ['preview-1', 'preview-2']) {
      await page.goto(`/vehicle/${id}`);
      await page.getByTestId(`button-compare-${id}`).click();
    }
    await page.goto('/compare');
    await expect(page.getByTestId('compare-table')).toBeVisible();
    await fits(page);
    await page.goto('/portal');
    await expect(page.getByTestId('compare-tray')).toHaveCount(0);
    await expect(page.getByTestId('work-queue')).toBeVisible();
    for (const tab of ['today', 'leads', 'deals', 'channels', 'settings']) {
      await page.getByTestId(`tab-${tab}`).click();
      await expect(page.locator('#main-content h1')).toBeVisible();
      if (tab === 'channels') await expect(page.getByTestId('channel-summary')).toBeVisible();
      if (tab === 'settings') await expect(page.getByTestId('input-identity-name')).toBeVisible();
      await fits(page);
    }
    await page.goto('/portal/leads/sample-lead-1');
    await expect(page.getByTestId('lead-detail')).toBeVisible();
    await fits(page);
  });
}

test('gallery has keyboard navigation, a focus trap and focus restoration', async ({ page }) => {
  await page.goto('/vehicle/preview-1');
  const opener = page.getByRole('button', { name: 'View gallery fullscreen' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Vehicle image gallery' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(dialog).toContainText('2 / 70');
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
});

test('save and compare work from stock and vehicle details', async ({ page }) => {
  await page.goto('/vehicle/preview-1');
  await page.getByTestId('button-save-preview-1').click();
  await expect(page.getByTestId('button-save-preview-1')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('button-compare-preview-1').click();
  await page.goto('/vehicle/preview-2');
  await page.getByTestId('button-compare-preview-2').click();
  await page.goto('/compare');
  await expect(page.getByTestId('compare-table')).toContainText('£12,104');
  await expect(page.getByTestId('compare-table')).toContainText('£13,255');
  await page.goto('/saved');
  await expect(page.getByTestId('row-vehicle-preview-1')).toBeVisible();
});

test('booking preserves the selected car, date and contact payload', async ({ page }) => {
  let submitted: Record<string, unknown> | undefined;
  await page.route('**/api/enquiries', async (route) => {
    submitted = route.request().postDataJSON();
    await route.fulfill({
      json: {
        reference: 'UI-TEST',
        customerNotificationStatus: 'sent',
        managePath: '/viewing/sample',
      },
    });
  });
  await page.goto('/enquire?type=viewing&vehicleId=preview-1');
  const continueButton = page.getByTestId('button-continue-to-details');
  await expect(continueButton).toBeDisabled();
  await page.getByTestId('group-viewing-slots').getByRole('button').first().click();
  await continueButton.click();
  await expect(page.getByTestId('input-customer-name')).toBeFocused();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(submitted).toBeUndefined();
  await page.getByTestId('input-customer-name').fill('Test Customer');
  await page.getByTestId('input-customer-email').fill('test@example.com');
  await page.getByTestId('input-customer-phone').fill('07700 900123');
  await page.getByTestId('button-submit-enquiry').click();
  await expect(page.getByTestId('status-enquiry-success')).toBeVisible();
  expect(submitted).toMatchObject({
    type: 'viewing',
    vehicleId: 'preview-1',
    customerName: 'Test Customer',
    email: 'test@example.com',
    phone: '07700900123',
  });
  expect(submitted?.appointmentAt).toBeTruthy();
});

test('manual lead capture retains fields and traps focus', async ({ page }) => {
  let payload: Record<string, unknown> | undefined;
  await page.route('**/api/leads', async (route) => {
    if (route.request().method() === 'POST') {
      payload = route.request().postDataJSON();
      await route.fulfill({ json: { lead: { id: 'sample-lead-1' } } });
    } else await route.continue();
  });
  await page.goto('/portal');
  await page.getByTestId('button-new-lead').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('input-customer-name')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  await dialog.getByTestId('input-customer-name').fill('Test Customer');
  await dialog.getByTestId('input-phone').fill('07700 900123');
  await dialog.getByTestId('button-save-lead').click();
  await expect(page).toHaveURL(/portal\/leads\/sample-lead-1/);
  expect(payload).toMatchObject({
    customerName: 'Test Customer',
    phone: '07700 900123',
    source: 'walk_in',
  });
});

test('sales readiness and development warnings remain visible', async ({ page }) => {
  await page.goto('/portal');
  await page.getByTestId('tab-deals').click();
  await expect(page.getByText('DEVELOPMENT ONLY', { exact: true })).toBeVisible();
  await page.getByRole('button').filter({ hasText: 'Amelia Clarke' }).click();
  await expect(page.getByRole('button', { name: 'Complete checklist to prepare' })).toBeDisabled();
  await expect(page.getByRole('heading', { name: 'Sales readiness checklist' })).toBeVisible();
});

test('staff dialogs return keyboard focus after closing', async ({ page }) => {
  await page.goto('/portal');
  const leadButton = page.getByTestId('button-new-lead');
  await leadButton.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(leadButton).toBeFocused();
  await page.getByTestId('tab-deals').click();
  await page.getByTestId('button-toggle-sale-form').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('button-toggle-sale-form')).toBeFocused();
});


test('gallery thumbnails use one tab stop and support arrow, Home and End keys', async ({ page }) => {
  await page.goto('/vehicle/preview-1');
  const thumbnails = page.getByRole('button', { name: /^Show photograph/ });
  await expect(thumbnails).toHaveCount(6);
  await expect(thumbnails.first()).toHaveAttribute('tabindex', '0');
  await thumbnails.first().focus();
  await page.keyboard.press('ArrowRight');
  await expect(thumbnails.nth(1)).toBeFocused();
  await page.keyboard.press('End');
  await expect(thumbnails.last()).toBeFocused();
  await page.keyboard.press('Home');
  await expect(thumbnails.first()).toBeFocused();
  expect(await thumbnails.evaluateAll(els => els.filter(el => el.getAttribute('tabindex') === '0').length)).toBe(1);
  await page.keyboard.press('Tab');
  expect(await thumbnails.evaluateAll(els => els.includes(document.activeElement!))).toBe(false);
});

test('service enquiry headings track the selected type without discarding typed details', async ({ page }) => {
  await page.goto('/enquire?type=general');
  await page.getByTestId('input-customer-name').fill('Test Customer');
  await page.getByTestId('select-enquiry-type').selectOption('warranty');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Warranty enquiries');
  await expect(page.getByTestId('input-customer-name')).toHaveValue('Test Customer');
  await page.getByTestId('select-enquiry-type').selectOption('delivery');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Arrange delivery');
});

test('mobile comparison stays compact and shows prices alongside vehicle names', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const id of ['preview-1', 'preview-2']) {
    await page.goto(`/vehicle/${id}`);
    await page.getByTestId(`button-compare-${id}`).click();
  }
  await page.goto('/find-my-car');
  const tray = page.getByTestId('compare-tray');
  await expect(tray).toBeVisible();
  expect((await tray.boundingBox())!.height).toBeLessThan(90);
  await tray.getByRole('link', { name: 'Compare', exact: true }).click();
  await expect(page.getByTestId('compare-price-preview-1')).toContainText('£12,104');
  await expect(page.getByTestId('compare-price-preview-2')).toContainText('£13,255');
  expect((await page.getByTestId('compare-price-preview-1').boundingBox())!.y).toBeLessThan(700);
});

test('mobile staff leads and settings actions remain usable in the first screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/portal');
  await page.getByTestId('tab-leads').click();
  await expect(page.getByRole('button').filter({ hasText: 'Amelia Clarke' })).toBeVisible();
  expect((await page.getByRole('heading', { name: 'Amelia Clarke' }).boundingBox())!.y).toBeLessThan(700);
  await page.getByTestId('tab-settings').click();
  const save = page.getByTestId('button-save-settings');
  await expect(save).toBeVisible();
  expect((await save.locator('..').locator('..').boundingBox())!.height).toBeLessThan(110);
  await page.getByTestId('button-new-lead').click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Add a lead' })).toBeVisible();
});


for (const path of ['/saved', '/compare']) {
  test(`${path} distinguishes a failed stock request from an empty selection`, async ({ page }) => {
    await page.goto('/vehicle/preview-1');
    await page.getByTestId(path === '/saved' ? 'button-save-preview-1' : 'button-compare-preview-1').click();
    await page.route('**/api/stock', route => route.fulfill({ status: 503, json: { error: 'Test stock outage' } }));
    await page.goto(path);
    await expect(page.getByRole('alert')).toContainText('Stock could not be loaded');
    await expect(page.getByRole('alert')).toContainText('Your selections are still saved');
    const key = path === '/saved' ? 'luxxy.saved-cars.v1' : 'luxxy.compare-cars.v1';
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key) || '[]'), key)).toContain('preview-1');
  });
}

test('unavailable saved vehicles have a clear removal state', async ({ page }) => {
  await page.goto('/vehicle/preview-1');
  await page.getByTestId('button-save-preview-1').click();
  await page.route('**/api/stock', route => route.fulfill({ json: { schemaVersion: 1, count: 0, cars: [] } }));
  await page.goto('/saved');
  await expect(page.getByRole('heading', { name: 'No saved cars available' })).toBeVisible();
  await expect(page.getByText('One saved car is no longer in stock.')).toBeVisible();
  await page.getByTestId('button-remove-unavailable').click();
  await expect(page.getByRole('heading', { name: 'No saved cars yet' })).toBeVisible();
});
