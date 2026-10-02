import { expect, test, type Page } from '@playwright/test';
import type { DealerSettings } from '@workspace/api-client-react';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Local fixtures only; no live settings or appointments are changed.');

const pendingBooking = {
  id: 'fixture-test-drive', reference: 'TD-FIXTURE-01', customerName: 'Alex Sample',
  email: 'alex@example.test', phone: '07700 900123', vehicleTitle: '2021 BMW 3 Series',
  appointmentAt: '2027-01-05T11:00:00Z', appointmentStatus: 'pending', appointmentRevision: 0,
  appointmentDurationMinutes: 45, appointmentCancelledAt: null as string | null,
  message: 'Please show me the parking sensors.', partExchangeRegistration: null,
};

async function guardWrites(page: Page) {
  await page.route('**/api/**', route => ['GET', 'HEAD', 'OPTIONS'].includes(route.request().method()) ? route.continue() : route.abort());
}

for (const width of [390, 820, 1440]) {
  test(`dealer can review booking rules and publish to a fixture at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await guardWrites(page);
    let settings: DealerSettings | undefined;
    let writes = 0;
    await page.route('**/api/dealer-settings', async route => {
      if (!settings) settings = await (await route.fetch()).json();
      if (route.request().method() === 'PATCH') {
        writes += 1;
        settings = route.request().postDataJSON();
      }
      return route.fulfill({ json: settings });
    });
    await page.goto('/portal');
    await expect(page.getByTestId('input-identity-name')).toBeVisible();
    await page.getByTestId('button-settings-nav-presentation').click();
    await expect(page.getByTestId('test-drive-settings')).toBeVisible();
    await page.getByTestId('select-test-drive-confirmation').selectOption('approval');
    await page.getByTestId('input-test-drive-durationMinutes').fill('45');
    await page.getByTestId('input-test-drive-bufferMinutes').fill('15');
    await page.getByTestId('input-test-drive-minimumNoticeHours').fill('12');
    await page.getByTestId('input-test-drive-dailyCapacity').fill('8');
    await page.getByTestId('input-test-drive-daysAhead').fill('21');
    await page.getByRole('checkbox', { name: 'Sunday appointments', exact: true }).check();
    await page.getByLabel('Sunday first appointment', { exact: true }).fill('11:00');
    await page.getByLabel('Sunday appointments finish', { exact: true }).fill('15:00');
    await page.getByTestId('input-test-drive-blocked-date').fill('2027-01-01');
    await page.getByRole('button', { name: 'Add unavailable date', exact: true }).click();
    await expect(page.getByText('1 January 2027', { exact: true })).toBeVisible();
    await page.getByTestId('textarea-test-drive-instructions').fill('Please bring the documents listed in your confirmation.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    expect(writes).toBe(0);
    await page.getByRole('heading', { name: 'Test-drive appointments', exact: true }).click();
    await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); window.scrollTo({ top: 0, behavior: 'instant' }); });
    await page.screenshot({ path: `/tmp/luxxy-test-drive-settings-${width}.png`, fullPage: true });
    await page.getByTestId('button-save-settings').click();
    await expect(page.getByText('45-minute appointments · staff approval required · up to 8 appointments a day.')).toBeVisible();
    expect(writes).toBe(0);
    await page.getByTestId('button-save-settings').click();
    await expect(page.getByText('Published to the showroom. Your changes are live.')).toBeVisible();
    expect(writes).toBe(1);
    expect(settings?.testDriveBooking).toMatchObject({ enabled: true, confirmationMode: 'approval', durationMinutes: 45, bufferMinutes: 15, minimumNoticeHours: 12, dailyCapacity: 8, daysAhead: 21, blockedDates: ['2027-01-01'] });
    expect(settings?.testDriveBooking?.weeklyHours.find(day => day.day === 0)).toEqual({ day: 0, enabled: true, open: '11:00', close: '15:00' });
  });

  test(`staff can confirm a request only after reviewing it at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await guardWrites(page);
    let booking = { ...pendingBooking };
    const decisions: unknown[] = [];
    await page.route('**/api/test-drive-bookings', route => route.fulfill({ json: [booking] }));
    await page.route('**/api/test-drive-bookings/fixture-test-drive/decision', route => {
      decisions.push(route.request().postDataJSON());
      booking = { ...booking, appointmentStatus: 'confirmed' };
      return route.fulfill({ json: booking });
    });
    await page.goto('/portal');
    await page.getByTestId('tab-test-drives').click();
    const row = page.getByTestId('staff-test-drive-fixture-test-drive');
    await expect(row).toContainText('Alex Sample');
    await expect(row).toContainText('5 Jan 2027, 11:00');
    await page.screenshot({ path: `/tmp/luxxy-test-drive-staff-${width}.png` });
    await row.getByRole('button', { name: 'Confirm appointment', exact: true }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeInViewport();
    await expect(dialog.getByRole('button', { name: 'Keep request', exact: true })).toBeFocused();
    expect(decisions).toEqual([]);
    await dialog.getByRole('button', { name: 'Keep request', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await row.getByRole('button', { name: 'Confirm appointment', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm test drive', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Alex Sample’s test drive has been confirmed.');
    await expect(row).toContainText('Confirmed');
    await expect(row.getByRole('button', { name: 'Confirm appointment', exact: true })).toHaveCount(0);
    expect(decisions).toEqual([{ decision: 'confirm', expectedRevision: 0 }]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test('invalid appointment hours stay in the draft and cannot be published', async ({ page }) => {
  await guardWrites(page);
  let writes = 0;
  await page.route('**/api/dealer-settings', route => {
    if (route.request().method() !== 'GET') writes += 1;
    return route.request().method() === 'GET' ? route.continue() : route.fulfill({ status: 400, json: { error: 'Unexpected fixture write' } });
  });
  await page.goto('/portal');
  await page.getByTestId('button-settings-nav-presentation').click();
  await page.getByLabel('Monday first appointment', { exact: true }).fill('17:50');
  await page.getByTestId('button-save-settings').click();
  await expect(page.getByRole('alert')).toContainText('with room for one full appointment');
  await expect(page.locator('#settings-presentation')).toBeVisible();
  expect(writes).toBe(0);
});

test('failed decisions preserve the request, and a retry can decline it', async ({ page }) => {
  await guardWrites(page);
  let booking: typeof pendingBooking = { ...pendingBooking };
  let failing = true;
  const decisions: unknown[] = [];
  await page.route('**/api/test-drive-bookings', route => route.fulfill({ json: [booking] }));
  await page.route('**/api/test-drive-bookings/fixture-test-drive/decision', route => {
    decisions.push(route.request().postDataJSON());
    if (failing) return route.fulfill({ status: 409, json: { error: 'The appointment changed. Please refresh before deciding.' } });
    booking = { ...booking, appointmentCancelledAt: '2026-10-02T12:00:00Z' };
    return route.fulfill({ json: booking });
  });
  await page.goto('/portal');
  await page.getByTestId('tab-test-drives').click();
  await page.getByRole('button', { name: 'Decline', exact: true }).click();
  await page.getByRole('button', { name: 'Decline and release time', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText('The appointment changed. Please refresh before deciding.');
  expect(booking.appointmentCancelledAt).toBeNull();
  failing = false;
  await page.getByRole('button', { name: 'Decline and release time', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('has been declined');
  await expect(page.getByText('No appointments to show', { exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Test-drive status', exact: true }).selectOption('cancelled');
  await expect(page.getByTestId('staff-test-drive-fixture-test-drive')).toContainText('Cancelled');
  expect(decisions).toEqual([{ decision: 'decline', expectedRevision: 0 }, { decision: 'decline', expectedRevision: 0 }]);
});


test('staff must refresh and review a rescheduled appointment before confirming it', async ({ page }) => {
  await page.clock.install();
  await guardWrites(page);
  let booking = { ...pendingBooking };
  const decisions: Array<{ decision: string; expectedRevision: number }> = [];
  await page.route('**/api/test-drive-bookings', route => route.fulfill({ json: [booking] }));
  await page.route('**/api/test-drive-bookings/fixture-test-drive/decision', route => {
    const request = route.request().postDataJSON();
    decisions.push(request);
    if (request.expectedRevision !== booking.appointmentRevision) return route.fulfill({ status: 409, json: { error: 'This appointment has changed. Refresh and review its latest details before deciding.' } });
    booking = { ...booking, appointmentStatus: 'confirmed', appointmentRevision: booking.appointmentRevision + 1 };
    return route.fulfill({ json: booking });
  });
  await page.goto('/portal');
  await page.getByTestId('tab-test-drives').click();
  const row = page.getByTestId('staff-test-drive-fixture-test-drive');
  await row.getByRole('button', { name: 'Confirm appointment', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('5 Jan 2027, 11:00');
  booking = { ...booking, appointmentAt: '2027-01-05T14:00:00Z', appointmentRevision: 1 };
  await page.clock.fastForward(60_001);
  await expect(row).toContainText('5 Jan 2027, 14:00');
  await expect(dialog).toContainText('5 Jan 2027, 11:00');
  await dialog.getByRole('button', { name: 'Confirm test drive', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('This appointment has changed. Refresh and review its latest details before deciding.');
  expect(booking.appointmentStatus).toBe('pending');
  await dialog.getByRole('button', { name: 'Keep request', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh test drives', exact: true }).click();
  await expect(row).toContainText('5 Jan 2027, 14:00');
  await row.getByRole('button', { name: 'Confirm appointment', exact: true }).click();
  await expect(dialog).toContainText('5 Jan 2027, 14:00');
  await dialog.getByRole('button', { name: 'Confirm test drive', exact: true }).click();
  await expect(row).toContainText('Confirmed');
  expect(decisions).toEqual([{ decision: 'confirm', expectedRevision: 0 }, { decision: 'confirm', expectedRevision: 1 }]);
});


test('active appointments exclude past visits and past requests have no decision actions', async ({ page }) => {
  await page.clock.install({ time: new Date('2027-01-05T12:00:00Z') });
  await guardWrites(page);
  const bookings = [
    { ...pendingBooking, id: 'past-pending', appointmentAt: '2027-01-05T11:00:00Z' },
    { ...pendingBooking, id: 'past-confirmed', appointmentAt: '2027-01-05T10:00:00Z', appointmentStatus: 'confirmed' },
    { ...pendingBooking, id: 'future-pending', appointmentAt: '2027-01-05T14:00:00Z' },
    { ...pendingBooking, id: 'future-confirmed', appointmentAt: '2027-01-05T15:00:00Z', appointmentStatus: 'confirmed' },
    { ...pendingBooking, id: 'future-cancelled', appointmentAt: '2027-01-05T16:00:00Z', appointmentCancelledAt: '2027-01-05T09:00:00Z' },
  ];
  await page.route('**/api/test-drive-bookings', route => route.fulfill({ json: bookings }));
  await page.goto('/portal');
  await page.getByTestId('tab-test-drives').click();
  await expect(page.locator('[data-testid^="staff-test-drive-"]')).toHaveCount(2);
  await expect(page.getByTestId('staff-test-drive-future-pending')).toBeVisible();
  await expect(page.getByTestId('staff-test-drive-future-confirmed')).toBeVisible();
  await page.getByRole('combobox', { name: 'Test-drive status', exact: true }).selectOption('all');
  await expect(page.locator('[data-testid^="staff-test-drive-"]')).toHaveCount(5);
  const pastRequest = page.getByTestId('staff-test-drive-past-pending');
  await expect(pastRequest).toContainText('Time passed');
  await expect(pastRequest.getByRole('button', { name: 'Confirm appointment', exact: true })).toHaveCount(0);
  await expect(pastRequest.getByRole('button', { name: 'Decline', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('staff-test-drive-future-pending').getByRole('button', { name: 'Confirm appointment', exact: true })).toBeVisible();
  await page.clock.fastForward(2 * 60 * 60 * 1000);
  await expect(page.getByTestId('staff-test-drive-future-pending')).toContainText('Time passed');
  await expect(page.getByTestId('staff-test-drive-future-pending').getByRole('button', { name: 'Confirm appointment', exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Test-drive status', exact: true }).selectOption('active');
  await expect(page.locator('[data-testid^="staff-test-drive-"]')).toHaveCount(1);
  await expect(page.getByTestId('staff-test-drive-future-confirmed')).toBeVisible();
});
