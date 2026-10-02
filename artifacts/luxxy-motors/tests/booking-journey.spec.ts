import { expect, test, type Page } from '@playwright/test';

// Every mutation is intercepted. These tests never create real appointments.
test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'The booking journey uses the isolated local preview.');
test.use({ reducedMotion: 'reduce' });

const policy = {
  enabled: true, durationMinutes: 30, bufferMinutes: 15, minimumNoticeHours: 0,
  dailyCapacity: 8, daysAhead: 30, blockedDates: [], instructions: 'Bring your driving licence. Park beside the showroom entrance.',
  confirmationMode: 'instant',
  weeklyHours: Array.from({ length: 7 }, (_, day) => ({ day, enabled: true, open: '09:00', close: '18:00' })),
};

async function mockSettings(page: Page, changes: Partial<typeof policy> = {}) {
  const settings = await (await page.request.get('/api/dealer-settings')).json();
  await page.route('**/api/dealer-settings', route => route.fulfill({ json: { ...settings, testDriveBooking: { ...policy, ...changes } } }));
}

async function chooseTime(page: Page) {
  const slots = page.getByTestId('group-viewing-slots');
  await slots.getByRole('button').and(page.locator(':enabled')).first().click();
  await page.getByTestId('button-continue-to-details').click();
  await expect(page.getByTestId('input-customer-name')).toBeFocused();
}

async function fillContact(page: Page) {
  await page.getByTestId('input-customer-name').fill('Booking Customer');
  await page.getByTestId('input-customer-email').fill('booking@example.test');
  await page.getByTestId('input-customer-phone').fill('07700 900123');
}

async function capture(page: Page, step: string, width: number) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    const images = Array.from(document.querySelectorAll<HTMLImageElement>('[data-testid="card-enquiry-vehicle"] img'));
    await Promise.race([Promise.all(images.map(image => image.decode().catch(() => undefined))), new Promise(resolve => setTimeout(resolve, 3000))]);
  });
  await page.screenshot({ path: `/tmp/booking-journey-${step}-${width}.png`, fullPage: true });
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-05T08:00:00.000Z'));
  await page.route('**/api/**', route => ['GET', 'HEAD'].includes(route.request().method())
    ? route.continue() : route.fulfill({ status: 403, json: { error: 'Test blocked this write.' } }));
  const stock = await (await page.request.get('/api/stock')).json();
  const cars = stock.cars.filter((car: { inventoryStatus?: string }) => !['sold', 'archived', 'hidden'].includes(car.inventoryStatus ?? '')).slice(0, 2)
    .map((car: Record<string, unknown>, index: number) => ({ ...car, id: `preview-${index + 1}` }));
  expect(cars).toHaveLength(2);
  await page.route('**/api/stock', route => route.fulfill({ json: { ...stock, count: cars.length, cars } }));
  await mockSettings(page);
  await page.route('**/api/enquiries/availability?*', route => {
    const date = new URL(route.request().url()).searchParams.get('date');
    return route.fulfill({ json: { date, timezone: 'Europe/London', slots: [
      { label: '10:00 am', startAt: `${date}T09:00:00.000Z`, available: true },
      { label: '11:00 am', startAt: `${date}T10:00:00.000Z`, available: false },
      { label: '2:00 pm', startAt: `${date}T13:00:00.000Z`, available: true },
    ] } });
  });
});

for (const width of [390, 820, 1440]) {
  test(`vehicle, time, details and final confirmation remain clear at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 820 ? 1180 : 900 });
    let payload: Record<string, unknown> | undefined;
    await page.route('**/api/enquiries', route => {
      payload = route.request().postDataJSON();
      return route.fulfill({ json: { reference: 'BOOKING-TEST', appointmentStatus: 'confirmed', customerNotificationStatus: 'sent',
        appointmentAt: payload!.appointmentAt, managePath: '/viewing/booking-test', calendarIcs: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR' } });
    });
    await page.goto('/enquire?type=viewing');
    await expect(page.getByRole('button', { name: 'Select a car to continue' })).toBeDisabled();
    await page.locator('input[name="viewing-vehicle"][value="preview-2"]').check();
    await page.getByRole('link', { name: 'Choose date and time' }).click();
    await expect(page).toHaveURL(/vehicleId=preview-2/);
    await expect(page.getByTestId('card-enquiry-vehicle')).toBeVisible();
    await expect(page.getByTestId('group-viewing-dates')).toBeVisible();
    await expect(page.getByTestId('button-continue-to-details')).toBeDisabled();
    await expect(page.getByTestId('group-viewing-slots').getByRole('button', { name: /11:00/ })).toHaveCount(0);
    await capture(page, 'time', width);
    await chooseTime(page);
    await fillContact(page);
    await capture(page, 'details', width);
    await expect(page.getByTestId('select-preferred-contact')).toHaveCount(0);
    await page.getByTestId('button-review-booking').click();
    expect(payload).toBeUndefined();
    await expect(page.getByTestId('button-submit-enquiry')).toHaveText('Confirm test drive');
    await expect(page.getByText('Booking Customer', { exact: true })).toBeVisible();
    await expect(page.getByTestId('booking-review')).toContainText('booking@example.test');
    await expect(page.getByRole('button', { name: 'Reserve car online', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await capture(page, 'review', width);
    await page.getByTestId('button-submit-enquiry').click();
    const success = page.getByTestId('status-enquiry-success');
    await expect(success.getByRole('heading', { name: 'Your test drive is booked' })).toBeFocused();
    await expect(success).toContainText(policy.instructions);
    await expect(page.getByRole('link', { name: 'Manage test drive', exact: true })).toHaveAttribute('href', '/viewing/booking-test');
    await expect(page.getByTestId('link-download-calendar')).toHaveAttribute('download', 'test-drive-BOOKING-TEST.ics');
    expect(payload).toMatchObject({ type: 'viewing', vehicleId: 'preview-2', customerName: 'Booking Customer', email: 'booking@example.test', phone: '07700900123' });
    expect(payload!.appointmentAt).toBeTruthy();
    expect(await page.evaluate(() => sessionStorage.getItem('luxxy.enquiry-draft.viewing:preview-2'))).toBeNull();
    await capture(page, 'success', width);
  });
}

test('a failed confirmation can be retried without losing the reviewed booking', async ({ page }) => {
  let attempts = 0;
  const submissions: unknown[] = [];
  await page.route('**/api/enquiries', route => {
    attempts += 1;
    submissions.push(route.request().postDataJSON());
    return route.fulfill(attempts === 1 ? { status: 503, json: { error: 'Please try again shortly.' } }
      : { json: { reference: 'RETRY-TEST', appointmentStatus: 'confirmed', customerNotificationStatus: 'sent' } });
  });
  await page.goto('/enquire?type=viewing&vehicleId=preview-2');
  await chooseTime(page);
  await fillContact(page);
  await page.getByTestId('button-review-booking').click();
  await page.getByTestId('button-submit-enquiry').click();
  await expect(page.getByTestId('status-enquiry-error')).toBeFocused();
  await expect(page.getByText('Booking Customer', { exact: true })).toBeVisible();
  await expect(page.getByTestId('status-enquiry-success')).toHaveCount(0);
  await expect(page.getByTestId('link-download-calendar')).toHaveCount(0);
  await page.getByTestId('button-submit-enquiry').click();
  await expect(page.getByTestId('status-enquiry-success')).toBeVisible();
  expect(attempts).toBe(2);
  expect(submissions[1]).toEqual(submissions[0]);
});

for (const confirmationMode of ['instant', 'approval']) test(`the saved appointment status controls success copy with ${confirmationMode} settings`, async ({ page }) => {
  await mockSettings(page, { confirmationMode });
  await page.route('**/api/enquiries', route => route.fulfill({ json: { reference: 'PENDING-TEST', appointmentStatus: 'pending', customerNotificationStatus: 'sent', managePath: '/viewing/pending-test' } }));
  await page.goto('/enquire?type=viewing&vehicleId=preview-2');
  await chooseTime(page);
  await fillContact(page);
  await page.getByTestId('button-review-booking').click();
  await expect(page.getByTestId('button-submit-enquiry')).toHaveText(confirmationMode === 'approval' ? 'Request test drive' : 'Confirm test drive');
  await page.getByTestId('button-submit-enquiry').click();
  const success = page.getByTestId('status-enquiry-success');
  await expect(success).toBeVisible();
  await expect(success.getByRole('heading')).toBeFocused();
  await expect(success).not.toContainText('Your test drive is booked');
  await expect(success).toContainText(/confirm|confirmation/i);
  await expect(page.getByTestId('link-download-calendar')).toHaveCount(0);
});

test('changing the chosen car keeps contact details and requires a new time', async ({ page }) => {
  await page.goto('/enquire?type=viewing&vehicleId=preview-2');
  await chooseTime(page);
  await fillContact(page);
  await page.getByTestId('card-enquiry-vehicle').getByRole('button', { name: 'Change car' }).click();
  await page.locator('input[name="viewing-vehicle"][value="preview-1"]').check();
  await page.getByRole('link', { name: 'Choose date and time' }).click();
  await expect(page).toHaveURL(/vehicleId=preview-1/);
  await expect(page.getByTestId('button-continue-to-details')).toBeDisabled();
  await chooseTime(page);
  await expect(page.getByTestId('input-customer-name')).toHaveValue('Booking Customer');
  await expect(page.getByTestId('input-customer-email')).toHaveValue('booking@example.test');
  await expect(page.getByTestId('input-customer-phone')).toHaveValue('07700 900123');
});

test('changing a date clears its selected time', async ({ page }) => {
  await page.goto('/enquire?type=viewing&vehicleId=preview-2');
  await page.getByTestId('group-viewing-slots').getByRole('button').and(page.locator(':enabled')).first().click();
  await expect(page.getByTestId('button-continue-to-details')).toBeEnabled();
  await page.getByTestId('group-viewing-dates').getByRole('button').nth(1).click();
  await expect(page.getByTestId('button-continue-to-details')).toBeDisabled();
});

test('no available times offers help without accepting an appointment', async ({ page }) => {
  await page.route('**/api/enquiries/availability?*', route => route.fulfill({ json: { date: new URL(route.request().url()).searchParams.get('date'), timezone: 'Europe/London', slots: [] } }));
  await page.goto('/enquire?type=viewing&vehicleId=preview-2');
  await expect(page.getByTestId('button-continue-to-details')).toBeDisabled();
  await expect(page.getByText('Can’t find a suitable time?', { exact: true })).toBeVisible();
  await expect(page.getByTestId('button-submit-enquiry')).toHaveCount(0);
});

test('optional part exchange and message can be reviewed and edited before sending', async ({ page }) => {
  let submitted: Record<string, unknown> | undefined;
  await page.route('**/api/enquiries', route => {
    submitted = route.request().postDataJSON();
    return route.fulfill({ json: { reference: 'EXCHANGE-TEST', appointmentStatus: 'confirmed', customerNotificationStatus: 'sent' } });
  });
  await page.goto('/enquire?type=viewing&vehicleId=preview-2');
  await chooseTime(page);
  await fillContact(page);
  await expect(page.getByTestId('enquiry-part-exchange-details')).toHaveCount(0);
  await page.locator('summary').filter({ hasText: 'Have a car to part-exchange?' }).click();
  await page.getByRole('checkbox', { name: 'Yes, I have a car to part-exchange' }).check();
  await page.getByLabel('Your car’s UK registration number', { exact: true }).fill('ab12 cde');
  await page.getByLabel('Approximate mileage', { exact: true }).fill('42000');
  await page.locator('summary').filter({ hasText: 'Anything you’d like us to know?' }).click();
  await page.getByTestId('textarea-enquiry-message').fill('Please have the service history ready.');
  await page.getByTestId('button-review-booking').click();
  await expect(page.getByTestId('booking-review')).toContainText('AB12 CDE · 42,000 miles');
  await expect(page.getByTestId('booking-review')).toContainText('Please have the service history ready.');
  expect(submitted).toBeUndefined();
  await page.getByRole('button', { name: 'Change details', exact: true }).click();
  await expect(page.getByTestId('input-customer-name')).toBeFocused();
  await expect(page.getByTestId('textarea-enquiry-message')).toHaveValue('Please have the service history ready.');
  await page.getByTestId('input-customer-name').fill('Updated Customer');
  await page.getByTestId('button-review-booking').click();
  await page.getByTestId('button-submit-enquiry').click();
  await expect(page.getByTestId('status-enquiry-success')).toBeVisible();
  expect(submitted).toMatchObject({ customerName: 'Updated Customer', partExchange: { registration: 'AB12 CDE', mileage: 42000, condition: null } });
  expect(submitted!.message).toContain('Please have the service history ready.');
});

test('a time taken during review keeps details and requires another time', async ({ page }) => {
  let taken = false;
  const submissions: Record<string, unknown>[] = [];
  await page.route('**/api/enquiries/availability?*', route => {
    const date = new URL(route.request().url()).searchParams.get('date');
    return route.fulfill({ json: { date, timezone: 'Europe/London', slots: [
      { label: '10:00 am', startAt: `${date}T09:00:00.000Z`, available: !taken },
      { label: '2:00 pm', startAt: `${date}T13:00:00.000Z`, available: true },
    ] } });
  });
  await page.route('**/api/enquiries', route => {
    submissions.push(route.request().postDataJSON());
    taken = true;
    return route.fulfill(submissions.length === 1 ? { status: 409, json: { error: 'That time has just been booked. Choose another time.' } }
      : { json: { reference: 'CHANGED-TIME', appointmentStatus: 'confirmed', customerNotificationStatus: 'sent' } });
  });
  await page.goto('/enquire?type=viewing&vehicleId=preview-2');
  await chooseTime(page);
  await fillContact(page);
  await page.getByTestId('button-review-booking').click();
  await page.getByTestId('button-submit-enquiry').click();
  await expect(page.getByTestId('status-enquiry-error')).toBeFocused();
  await expect(page.getByTestId('button-submit-enquiry')).toBeDisabled();
  await page.getByRole('button', { name: 'Change time', exact: true }).click();
  await expect(page.getByTestId('group-viewing-slots').getByRole('button', { name: '10:00 am', exact: true })).toHaveCount(0);
  await chooseTime(page);
  await expect(page.getByTestId('input-customer-name')).toHaveValue('Booking Customer');
  await page.getByTestId('button-review-booking').click();
  await page.getByTestId('button-submit-enquiry').click();
  await expect(page.getByTestId('status-enquiry-success')).toBeVisible();
  expect(submissions).toHaveLength(2);
  expect(submissions[0].appointmentAt).not.toBe(submissions[1].appointmentAt);
  expect(submissions[1]).toMatchObject({ customerName: 'Booking Customer', email: 'booking@example.test', phone: '07700900123' });
});

test('submission cannot be repeated while the confirmation is pending', async ({ page }) => {
  let submissions = 0;
  let release!: () => void;
  const responseReady = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/enquiries', async route => {
    submissions += 1;
    await responseReady;
    await route.fulfill({ json: { reference: 'ONE-BOOKING', appointmentStatus: 'confirmed', customerNotificationStatus: 'sent' } });
  });
  await page.goto('/enquire?type=viewing&vehicleId=preview-2');
  await chooseTime(page);
  await fillContact(page);
  await page.getByTestId('button-review-booking').click();
  await page.getByTestId('button-submit-enquiry').click();
  await expect(page.getByTestId('button-submit-enquiry')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Change details', exact: true })).toBeDisabled();
  await expect(page.getByTestId('status-enquiry-success')).toHaveCount(0);
  release();
  await expect(page.getByTestId('status-enquiry-success')).toBeVisible();
  expect(submissions).toBe(1);
});

test('disabled online booking offers a direct request for help', async ({ page }) => {
  await mockSettings(page, { enabled: false });
  await page.goto('/enquire?type=viewing&vehicleId=preview-2');
  await expect(page.getByRole('heading', { name: 'Arrange a test drive with the team' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ask about a test drive' })).toHaveAttribute('href', /type=general.*vehicleId=preview-2/);
  await expect(page.getByTestId('button-submit-enquiry')).toHaveCount(0);
  await expect(page.getByTestId('group-viewing-slots')).toHaveCount(0);
});

test('contact enquiry booking choice uses the new journey and Back restores the original draft', async ({ page }) => {
  await page.goto('/contact');
  await page.getByTestId('input-customer-name').fill('Contact Customer');
  await page.getByTestId('input-customer-email').fill('contact@example.test');
  await page.getByTestId('textarea-enquiry-message').fill('Please tell me about your warranty.');
  await page.getByTestId('select-enquiry-type').selectOption('viewing');
  await expect(page).toHaveURL(/\/enquire\?type=viewing$/);
  await expect(page.getByTestId('viewing-vehicle-required')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/contact$/);
  await expect(page.getByTestId('input-customer-name')).toHaveValue('Contact Customer');
  await expect(page.getByTestId('textarea-enquiry-message')).toHaveValue('Please tell me about your warranty.');
  await page.getByTestId('select-enquiry-type').selectOption('viewing');
  await page.locator('input[name="viewing-vehicle"][value="preview-2"]').check();
  await page.getByRole('link', { name: 'Choose date and time' }).click();
  await chooseTime(page);
  await expect(page.getByTestId('input-customer-name')).toHaveValue('Contact Customer');
  await expect(page.getByTestId('input-customer-email')).toHaveValue('contact@example.test');
  await expect(page.getByTestId('textarea-enquiry-message')).toHaveValue('');
  await expect(page.getByTestId('button-review-booking')).toBeVisible();
});
