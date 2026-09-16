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
