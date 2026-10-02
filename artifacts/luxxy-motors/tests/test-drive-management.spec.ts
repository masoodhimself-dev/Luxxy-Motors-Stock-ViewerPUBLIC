import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const firstTime = '2026-10-03T09:00:00.000Z';
const newTime = '2026-10-11T09:00:00.000Z';
const initial = { reference: 'TEST-MANAGE', status: 'pending', customerName: 'Synthetic Customer', appointmentAt: firstTime, cancelledAt: null, timezone: 'Europe/London', durationMinutes: 45, vehicleTitle: 'Example car', vehicleUrl: null, calendarIcs: 'SHOULD NOT APPEAR FOR PENDING', canChange: true };

async function fixtures(page: Page, options: { disabled?: boolean; resultStatus?: 'pending' | 'booked' } = {}) {
  await page.clock.setFixedTime(new Date('2026-10-02T08:00:00Z'));
  const settings = {
    testDriveBooking: { enabled: !options.disabled, durationMinutes: 45, bufferMinutes: 15, minimumNoticeHours: 0, dailyCapacity: 8, daysAhead: 10, blockedDates: ['2026-10-04'], weeklyHours: Array.from({ length: 7 }, (_, day) => ({ day, enabled: day === 0, open: '10:00', close: '16:00' })), instructions: 'Bring the documents listed in your confirmation.', confirmationMode: 'approval' },
  };
  let booking = { ...initial };
  const mutations: Array<{ url: string; data: unknown }> = [];
  const dates: string[] = [];
  await page.route('**/api/dealer-settings', async route => { const current = await (await route.fetch()).json(); return route.fulfill({ json: { ...current, ...settings } }); });
  await page.route('**/api/enquiries/availability?*', route => {
    const date = new URL(route.request().url()).searchParams.get('date')!; dates.push(date);
    return route.fulfill({ json: { date, timezone: 'Europe/London', slots: [{ startAt: newTime, label: '10:00 am', available: true }, { startAt: '2026-10-11T10:00:00.000Z', label: '11:00 am', available: false }] } });
  });
  await page.route('**/api/viewings/management-test**', route => {
    const request = route.request();
    if (request.method() === 'POST') {
      mutations.push({ url: request.url(), data: request.postDataJSON() });
      if (request.url().endsWith('/cancel')) booking = { ...booking, status: 'cancelled', cancelledAt: '2026-10-02T08:01:00Z', canChange: false } as typeof booking;
      if (request.url().endsWith('/reschedule')) booking = { ...booking, status: options.resultStatus ?? 'pending', appointmentAt: newTime, calendarIcs: options.resultStatus === 'booked' ? 'BEGIN:VCALENDAR\r\nEND:VCALENDAR' : '' };
    }
    return route.fulfill({ json: booking });
  });
  return { mutations, dates };
}

for (const width of [390, 820, 1440]) {
  test(`pending management respects dealer dates and requests a new time at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const state = await fixtures(page);
    await page.goto('/viewing/management-test');
    await expect(page.getByRole('heading', { name: 'Your test-drive request' })).toBeVisible();
    await expect(page.getByTestId('status-viewing-pending')).toContainText('Awaiting showroom confirmation');
    await expect(page.getByTestId('link-viewing-calendar')).toHaveCount(0);
    await page.getByTestId('button-viewing-reschedule').click();
    await expect(page.getByTestId('group-viewing-dates').getByRole('button')).toHaveCount(1);
    await expect(page.getByTestId('button-viewing-date-2026-10-04')).toHaveCount(0);
    await expect(page.getByTestId('button-viewing-date-2026-10-11')).toBeVisible();
    await expect(page.getByTestId('button-viewing-date-2026-10-11')).toHaveAttribute('aria-label', 'Sunday 11 October');
    await expect(page.getByTestId('button-confirm-reschedule')).toHaveText('Request new time');
    await page.getByTestId(`button-viewing-slot-${newTime}`).click();
    await mkdir('/tmp/luxxy-test-drive-management', { recursive: true });
    await page.screenshot({ path: `/tmp/luxxy-test-drive-management/reschedule-${width}.png`, fullPage: true });
    await page.getByTestId('button-confirm-reschedule').click();
    await expect(page.getByTestId('status-reschedule-success')).toContainText('Please wait for the showroom to confirm');
    await expect(page.getByTestId('status-reschedule-success')).toBeFocused();
    await expect(page.getByTestId('link-viewing-calendar')).toHaveCount(0);
    expect(state.mutations).toHaveLength(1);
    expect(state.mutations[0].data).toEqual({ appointmentAt: newTime });
    expect(state.dates.every(date => date === '2026-10-11')).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test('rescheduling confirmation follows server response when requested time is confirmed', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await fixtures(page, { resultStatus: 'booked' });
  await page.goto('/viewing/management-test');
  await page.getByTestId('button-viewing-reschedule').click();
  await page.getByTestId(`button-viewing-slot-${newTime}`).click();
  await page.getByTestId('button-confirm-reschedule').click();
  await expect(page.getByTestId('status-reschedule-success')).toContainText('your new time is confirmed');
  await expect(page.getByTestId('status-viewing-pending')).toHaveCount(0);
  await expect(page.getByTestId('link-viewing-calendar')).toBeVisible();
});

test('booking cancellation stays available when online scheduling is switched off', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const state = await fixtures(page, { disabled: true });
  await page.goto('/viewing/management-test');
  await expect(page.getByTestId('button-viewing-reschedule')).toBeDisabled();
  await expect(page.getByTestId('status-reschedule-unavailable')).toContainText('existing request is unchanged');
  await page.getByTestId('button-viewing-cancel').click();
  await expect(page.getByRole('heading', { name: 'Cancel your request?' })).toBeFocused();
  await page.getByTestId('button-confirm-cancel').click();
  await expect(page.getByTestId('status-viewing-cancelled')).toBeFocused();
  await expect(page.getByRole('link', { name: 'Browse stock', exact: true })).toHaveAttribute('href', '/stock');
  expect(state.mutations).toHaveLength(1);
  expect(state.mutations[0].url).toMatch(/\/cancel$/);
  expect(state.dates).toHaveLength(0);
});
