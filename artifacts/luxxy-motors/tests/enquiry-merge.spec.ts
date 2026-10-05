import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import type { Enquiry } from '@workspace/api-client-react';
import { dealerConfig } from '../src/config/dealer';
import { defaultBookingSettings } from '../src/lib/test-drive-dates';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Synthetic local preview only.');

const now = '2026-10-05T08:00:00Z';
const cars = [
  { id: 'merge-car-focus', title: 'Ford Focus', make: 'Ford', model: 'Focus', year: 2019, price: 10995, transmission: 'Manual', plate: 'AB19 XYZ', inventoryStatus: 'available', images: [], heroImage: null, mileage: 42000, fuel: 'Petrol' },
  { id: 'merge-car-qashqai', title: 'Nissan Qashqai', make: 'Nissan', model: 'Qashqai', year: 2020, price: 13995, transmission: 'Manual', plate: 'CD20 XYZ', inventoryStatus: 'available', images: [], heroImage: null, mileage: 38000, fuel: 'Petrol' },
];

function original(id: string, reference: string, extra: Partial<Enquiry> = {}): Enquiry {
  return {
    id, reference, dealerId: 'synthetic-merge', customerName: 'Alex Customer', email: 'alex@example.test', phone: '07700900123',
    vehicleId: cars[0].id, vehicleTitle: cars[0].title, vehicleRegistration: cars[0].plate, vehiclePrice: cars[0].price, vehicleUrl: `/vehicle/${cars[0].id}`,
    status: 'new', type: 'general', source: 'phone', preferredContact: 'phone', message: `Original message from ${reference}.`, staffNote: `Internal note from ${reference}.`,
    assignedToId: null, assignedToName: null, callOutcome: 'information_given', attendance: 'scheduled',
    workspaceRevision: 4, appointmentRevision: 3, followUpRevision: 2,
    appointmentAt: null, appointmentStatus: null, appointmentCancelledAt: null, appointmentDurationMinutes: 30, appointmentBufferMinutes: 0,
    followUpAt: null, followUpNote: null, followUpCompletedAt: null, createdAt: '2026-10-01T09:00:00Z', updatedAt: now,
    events: [{ id: `call-${id}`, kind: 'conversation_logged', actor: 'dealer', summary: 'Conversation logged', note: `Conversation retained from ${reference}.`, staffId: 'staff-me', staffName: 'Sam Dealer', callOutcome: 'information_given', occurredAt: '2026-10-02T11:00:00Z', vehicleId: cars[0].id, vehicleTitle: cars[0].title, vehicleUrl: `/vehicle/${cars[0].id}` }],
    ...extra,
  } as Enquiry;
}

function fixtures(): Enquiry[] {
  return [
    original('main', 'MAIN-101', { callOutcome: 'callback_requested', followUpAt: '2026-10-05T13:00:00Z', followUpNote: 'Main callback remains due.' }),
    original('booking', 'BOOK-202', { type: 'viewing', source: 'website', appointmentAt: '2026-10-05T11:00:00Z', appointmentStatus: 'pending' }),
    original('drive', 'DRIVE-303', { type: 'viewing', appointmentAt: '2026-10-05T12:00:00Z', appointmentStatus: 'confirmed', vehicleId: cars[1].id, vehicleTitle: cars[1].title, vehicleRegistration: cars[1].plate, vehiclePrice: cars[1].price, vehicleUrl: `/vehicle/${cars[1].id}` }),
    original('chat', 'CHAT-404', { source: 'chat', callOutcome: 'callback_requested', followUpAt: '2026-10-05T14:00:00Z', followUpNote: 'Chat callback remains due.' }),
    original('unrelated', 'OTHER-505', { customerName: 'Separate Customer', email: 'separate@example.test', phone: '07700900999', createdAt: '2026-10-04T09:00:00Z' }),
  ];
}

type MergeInput = {
  recordIds: string[];
  expectedRevisions: { id: string; workspaceRevision: number; appointmentRevision: number; followUpRevision: number }[];
  keepAppointmentIds: string[];
  reason: string;
  confirmDifferentCustomers: boolean;
  allowOverlappingAppointments: boolean;
};
type Audit = {
  entries: Enquiry[];
  writes: { path: string; method: string; body: MergeInput }[];
  rejectedWrites: string[];
  enquiryReads: number;
  merge?: (route: Route, body: MergeInput, primaryId: string) => Promise<void>;
};

function applySyntheticMerge(audit: Audit, body: MergeInput, primaryId = 'main') {
  const cancelledAppointmentIds = audit.entries.filter(entry => body.recordIds.includes(entry.id) && entry.appointmentAt && !entry.appointmentCancelledAt && !body.keepAppointmentIds.includes(entry.id)).map(entry => entry.id);
  audit.entries = audit.entries.map(entry => !body.recordIds.includes(entry.id) ? entry : {
    ...entry, mergedIntoId: entry.id === primaryId ? null : primaryId, mergedAt: now, mergedBy: 'staff-me',
    workspaceRevision: (entry.workspaceRevision ?? 0) + 1,
    ...(cancelledAppointmentIds.includes(entry.id) ? { appointmentCancelledAt: now, appointmentRevision: (entry.appointmentRevision ?? 0) + 1 } : {}),
  });
  return { primaryId, recordIds: body.recordIds, cancelledAppointmentIds };
}

async function setup(page: Page, entries = fixtures(), section = 'enquiries'): Promise<Audit> {
  const audit: Audit = { entries, writes: [], rejectedWrites: [], enquiryReads: 0 };
  await page.clock.setFixedTime(new Date(now));
  // No API request reaches a server: writes must be the explicitly mocked merge operation.
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    if (!['GET', 'HEAD'].includes(method)) {
      const match = /^\/api\/staff\/enquiries\/([^/]+)\/merge$/.exec(path);
      if (method === 'POST' && match) {
        const body = request.postDataJSON() as MergeInput;
        audit.writes.push({ path, method, body });
        if (audit.merge) await audit.merge(route, body, match[1]);
        else await route.fulfill({ json: applySyntheticMerge(audit, body, match[1]) });
      } else {
        audit.rejectedWrites.push(`${method} ${path}`);
        await route.abort();
      }
      return;
    }
    if (path === '/api/enquiries') { audit.enquiryReads++; await route.fulfill({ json: audit.entries }); return; }
    if (path === '/api/test-drive-bookings') { await route.fulfill({ json: audit.entries.filter(entry => entry.type === 'viewing') }); return; }
    const data: Record<string, unknown> = {
      '/api/portal/session': { state: 'allowed', name: 'Sam Dealer', email: 'sam@example.test' },
      '/api/staff/access': { role: 'owner', permissions: ['sales.manage', 'settings.publish', 'stock.manage'], user: { authUserId: 'staff-me', name: 'Sam Dealer', email: 'sam@example.test' } },
      '/api/staff/directory': { currentUserId: 'staff-me', members: [{ id: 'staff-me', name: 'Sam Dealer' }] },
      '/api/stock': { schemaVersion: 1, count: cars.length, cars },
      '/api/dealer-settings': { ...dealerConfig, identity: { ...dealerConfig.identity, name: 'Synthetic Showroom' }, contact: { phone: '07700900123', email: 'showroom@example.test' }, testDriveBooking: defaultBookingSettings },
      '/api/chat/config': { settings: { enabled: false }, availability: { staffOnline: false }, dealerName: 'Synthetic Showroom' },
      '/api/recent-handovers': { schemaVersion: 1, handovers: [] },
    };
    await route.fulfill({ status: path in data ? 200 : 404, json: data[path] ?? { error: `No synthetic fixture for ${path}` } });
  });
  await page.goto(`/portal?section=${section}`);
  if (section === 'enquiries') await page.getByRole('tab', { name: 'Find enquiry or appointment', exact: true }).click();
  return audit;
}

async function openMain(page: Page) {
  await page.getByRole('button', { name: 'Open enquiry for Alex Customer, MAIN-101', exact: true }).click();
  await page.getByRole('region', { name: 'Selected enquiry: Alex Customer', exact: true }).getByRole('button', { name: 'Merge records', exact: true }).click();
  return page.getByRole('dialog', { name: 'Merge enquiries & appointments', exact: true });
}

async function include(dialog: Locator, reference: string, customer = 'Alex Customer') {
  await dialog.getByRole('textbox', { name: 'Search records to merge', exact: true }).fill(reference);
  await dialog.getByRole('checkbox', { name: `Include ${reference}, ${customer}`, exact: true }).check();
}

async function review(dialog: Locator, reason = 'Same customer discussing separate cars and visits.') {
  await dialog.getByRole('textbox', { name: 'Reason for merging', exact: true }).fill(reason);
  await dialog.getByRole('button', { name: 'Review merge', exact: true }).click();
}

async function checkDialogLayout(page: Page, dialog: Locator, width: number) {
  const dimensions = await dialog.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, overflowY: getComputedStyle(element).overflowY };
  });
  expect(dimensions.left).toBeGreaterThanOrEqual(0);
  expect(dimensions.right).toBeLessThanOrEqual(width);
  expect(dimensions.top).toBeGreaterThanOrEqual(0);
  expect(dimensions.bottom).toBeLessThanOrEqual(page.viewportSize()!.height);
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  expect(dimensions.overflowY).toBe('auto');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
}

for (const width of [390, 820, 1440]) {
  test(`merge search, review and original histories remain usable at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const audit = await setup(page);
    const dialog = await openMain(page);
    await expect(dialog.getByRole('region', { name: 'Main record' })).toContainText('MAIN-101');
    await dialog.getByRole('textbox', { name: 'Search records to merge' }).fill('CD20XYZ');
    await expect(dialog.getByRole('checkbox', { name: 'Include DRIVE-303, Alex Customer', exact: true })).toBeVisible();
    await expect(dialog.getByRole('checkbox', { name: 'Include BOOK-202, Alex Customer', exact: true })).toHaveCount(0);
    await include(dialog, 'DRIVE-303');
    await include(dialog, 'BOOK-202');
    await include(dialog, 'CHAT-404');
    await expect(dialog.getByRole('checkbox', { name: 'Keep appointment BOOK-202', exact: true })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: 'Keep appointment DRIVE-303', exact: true })).toBeChecked();
    expect(audit.writes).toHaveLength(0);
    await checkDialogLayout(page, dialog, width);
    await dialog.evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: `/private/tmp/luxxy-merge-choices-${width}.png` });
    await review(dialog);
    await expect(dialog.getByText('4 original records → MAIN-101. 2 appointments kept; 0 cancelled. Follow-up tasks and all conversation history are retained.', { exact: true })).toBeVisible();
    await checkDialogLayout(page, dialog, width);
    await dialog.getByRole('button', { name: 'Merge records', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/private/tmp/luxxy-merge-review-${width}.png` });
    await dialog.getByRole('button', { name: 'Merge records', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(audit.writes).toHaveLength(1);
    expect(audit.writes[0]).toEqual({ path: '/api/staff/enquiries/main/merge', method: 'POST', body: {
      recordIds: ['main', 'booking', 'drive', 'chat'],
      expectedRevisions: ['main', 'booking', 'drive', 'chat'].map(id => ({ id, workspaceRevision: 4, appointmentRevision: 3, followUpRevision: 2 })),
      keepAppointmentIds: ['booking', 'drive'], reason: 'Same customer discussing separate cars and visits.', confirmDifferentCustomers: false, allowOverlappingAppointments: false,
    } });
    await expect(page.getByTestId('enquiry-main')).toContainText('4 merged records');
    await expect(page.getByTestId('enquiry-booking')).toHaveCount(0);
    await expect(page.getByTestId('enquiry-drive')).toHaveCount(0);
    await expect(page.getByTestId('enquiry-chat')).toHaveCount(0);
    await page.getByLabel('Find a customer or car', { exact: true }).fill('Nissan Qashqai');
    await expect(page.getByTestId('enquiry-main')).toBeAttached();
    await page.getByRole('button', { name: 'Open enquiry for Alex Customer, MAIN-101', exact: true }).click();
    const selected = page.getByRole('region', { name: 'Selected enquiry: Alex Customer', exact: true });
    const originals = selected.getByRole('region', { name: 'Merged case original records', exact: true });
    await expect(selected.getByTestId('conversation-call-main')).toContainText('Conversation retained from MAIN-101.');
    for (const [id, reference] of [['booking', 'BOOK-202'], ['drive', 'DRIVE-303'], ['chat', 'CHAT-404']]) {
      const originalRecord = originals.locator('details').filter({ has: page.locator('summary', { hasText: reference }) });
      await originalRecord.locator('summary').click();
      await expect(originalRecord.getByTestId(`conversation-call-${id}`)).toContainText(`Conversation retained from ${reference}.`);
      await expect(originalRecord.getByText(`Original message from ${reference}.`, { exact: true })).toBeVisible();
      await expect(originalRecord.getByRole('link', { name: 'Customer history', exact: true })).toHaveAttribute('href', `/portal?section=history&view=customers&record=enquiry%3A${id}`);
      await expect(originalRecord.getByRole('link', { name: 'Vehicle history', exact: true })).toHaveAttribute('href', `/portal?section=history&view=vehicles&vehicleId=${id === 'drive' ? cars[1].id : cars[0].id}`);
      await originalRecord.locator('summary').click();
    }
    expect(audit.rejectedWrites).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });
}

test('appointment cancellation needs its own acknowledgement and retained calendar/callback tasks keep their original links', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1000 });
  const audit = await setup(page);
  const dialog = await openMain(page);
  for (const reference of ['BOOK-202', 'DRIVE-303', 'CHAT-404']) await include(dialog, reference);
  await dialog.getByRole('checkbox', { name: 'Keep appointment DRIVE-303', exact: true }).uncheck();
  await dialog.getByRole('textbox', { name: 'Reason for merging' }).fill('Keep the Ford visit and cancel the later Nissan visit.');
  await expect(dialog.getByText(/Cancel 1 appointment: DRIVE-303/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Review merge', exact: true })).toBeDisabled();
  expect(audit.writes).toHaveLength(0);
  await dialog.getByRole('checkbox', { name: 'I confirm cancellation of the appointments listed above.', exact: true }).check();
  await dialog.getByRole('button', { name: 'Review merge', exact: true }).click();
  await expect(dialog.getByText(/2 appointments kept/)).toHaveCount(0);
  await expect(dialog.getByText(/1 appointments kept; 1 cancelled/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Merge records', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(audit.writes[0].body.keepAppointmentIds).toEqual(['booking']);
  await page.getByRole('tab', { name: 'Calendar', exact: true }).click();
  const agenda = page.locator('.enquiry-calendar-agenda');
  await expect(agenda.locator('li')).toHaveCount(1);
  await expect(agenda.locator('li')).toContainText('BOOK-202');
  await expect(agenda.getByRole('link', { name: 'MAIN-101', exact: true })).toHaveAttribute('href', '/portal?section=enquiries&enquiryId=main');
  await page.getByRole('checkbox', { name: 'Show cancelled', exact: true }).check();
  await expect(agenda.locator('li')).toHaveCount(2);
  await expect(agenda.locator('li').filter({ hasText: 'DRIVE-303' })).toContainText('Cancelled');
  await page.getByRole('tab', { name: 'Callbacks (2)', exact: true }).click();
  const callback = page.locator('#desk-panel-callbacks');
  await callback.getByRole('button', { name: 'Back to callbacks', exact: true }).click();
  await expect(callback.getByTestId('enquiry-main')).toBeVisible();
  await expect(callback.getByTestId('enquiry-chat')).toBeVisible();
  await callback.getByRole('button', { name: 'Open enquiry for Alex Customer, CHAT-404', exact: true }).click();
  await expect(callback.getByRole('region', { name: 'Selected enquiry: Alex Customer' }).locator('.enquiry-detail-followup').getByText('Chat callback remains due.', { exact: true })).toBeVisible();
  await expect(callback.getByRole('link', { name: 'MAIN-101', exact: true })).toHaveAttribute('href', '/portal?section=enquiries&enquiryId=main');
  expect(audit.entries.find(entry => entry.id === 'chat')?.followUpCompletedAt).toBeNull();
  expect(audit.rejectedWrites).toEqual([]);
});

test('different contacts and overlapping appointments each require review acknowledgement', async ({ page }) => {
  const entries = fixtures().map(entry => entry.id === 'drive' ? { ...entry, customerName: 'Different Customer', phone: '07700900998', email: 'different@example.test', appointmentAt: '2026-10-05T11:00:00Z' } : entry);
  const audit = await setup(page, entries);
  const dialog = await openMain(page);
  await include(dialog, 'BOOK-202');
  await include(dialog, 'DRIVE-303', 'Different Customer');
  await dialog.getByRole('textbox', { name: 'Reason for merging' }).fill('Joint family viewing, with both original contacts retained.');
  await expect(dialog.getByText('Kept appointments overlap: BOOK-202 + DRIVE-303.', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Review merge', exact: true })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: 'I have checked the different customer contacts and want one case.', exact: true }).check();
  await expect(dialog.getByRole('button', { name: 'Review merge', exact: true })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: 'Keep these overlapping appointments.', exact: true }).check();
  await dialog.getByRole('button', { name: 'Review merge', exact: true }).click();
  await dialog.getByRole('button', { name: 'Merge records', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(audit.writes[0].body).toMatchObject({ confirmDifferentCustomers: true, allowOverlappingAppointments: true, keepAppointmentIds: ['booking', 'drive'] });
  expect(audit.rejectedWrites).toEqual([]);
});

test('409 preserves choices and reason, refreshes revisions and requires a new review without automatic retry', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const audit = await setup(page);
  audit.merge = async route => route.fulfill({ status: 409, json: { error: 'This enquiry changed. Refresh and review it before saving.' } });
  const dialog = await openMain(page);
  await include(dialog, 'BOOK-202');
  await include(dialog, 'DRIVE-303');
  await dialog.getByRole('checkbox', { name: 'Keep appointment DRIVE-303', exact: true }).uncheck();
  const reason = 'Retain these decisions after a conflicting staff edit.';
  await dialog.getByRole('textbox', { name: 'Reason for merging' }).fill(reason);
  await dialog.getByRole('checkbox', { name: 'I confirm cancellation of the appointments listed above.', exact: true }).check();
  await dialog.getByRole('button', { name: 'Review merge', exact: true }).click();
  await dialog.getByRole('button', { name: 'Merge records', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('This enquiry changed.');
  await expect(dialog.getByRole('textbox', { name: 'Reason for merging' })).toHaveValue(reason);
  await expect(dialog.getByRole('checkbox', { name: 'Keep appointment BOOK-202', exact: true })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'Keep appointment DRIVE-303', exact: true })).not.toBeChecked();
  await expect(dialog.getByRole('button', { name: 'Merge records', exact: true })).toHaveCount(0);
  await page.waitForTimeout(1200);
  expect(audit.writes).toHaveLength(1);
  audit.entries = audit.entries.map(entry => entry.id === 'drive' ? { ...entry, workspaceRevision: 9, staffNote: 'Latest staff note after conflicting edit.' } : entry);
  audit.merge = undefined;
  const reads = audit.enquiryReads;
  await dialog.getByRole('button', { name: 'Refresh records', exact: true }).click();
  await expect.poll(() => audit.enquiryReads).toBeGreaterThan(reads);
  await expect(dialog.getByRole('alert')).toContainText('Records refreshed.');
  await expect(dialog.getByRole('textbox', { name: 'Reason for merging' })).toHaveValue(reason);
  await expect(dialog.getByRole('checkbox', { name: 'Include BOOK-202, Alex Customer', exact: true })).toHaveCount(0);
  await dialog.getByRole('textbox', { name: 'Search records to merge' }).fill('BOOK-202');
  await expect(dialog.getByRole('checkbox', { name: 'Include BOOK-202, Alex Customer', exact: true })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'Keep appointment DRIVE-303', exact: true })).not.toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'I confirm cancellation of the appointments listed above.', exact: true })).not.toBeChecked();
  await expect(dialog.getByRole('button', { name: 'Review merge', exact: true })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: 'I confirm cancellation of the appointments listed above.', exact: true }).check();
  await dialog.getByRole('button', { name: 'Review merge', exact: true }).click();
  await dialog.getByRole('button', { name: 'Merge records', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(audit.writes).toHaveLength(2);
  expect(audit.writes[1].body.expectedRevisions.find(entry => entry.id === 'drive')).toEqual({ id: 'drive', workspaceRevision: 9, appointmentRevision: 3, followUpRevision: 2 });
  expect(audit.writes[1].body.reason).toBe(reason);
  expect(audit.rejectedWrites).toEqual([]);
});

test('a pending merge accepts only one submit and keeps the dialog open', async ({ page }) => {
  const audit = await setup(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  audit.merge = async (route, body, primaryId) => { await pending; await route.fulfill({ json: applySyntheticMerge(audit, body, primaryId) }); };
  const dialog = await openMain(page);
  await include(dialog, 'BOOK-202');
  await review(dialog);
  // Two events in one task exercise the synchronous guard before React rerenders.
  await dialog.getByRole('button', { name: 'Merge records', exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect.poll(() => audit.writes.length).toBe(1);
  await expect(dialog.getByRole('button', { name: 'Merging…', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  expect(audit.writes).toHaveLength(1);
  release();
  await expect(dialog).toHaveCount(0);
  expect(audit.writes).toHaveLength(1);
  expect(audit.rejectedWrites).toEqual([]);
});

test('test-drive entry point includes an existing merged group and retains each appointment row', async ({ page }) => {
  const entries = fixtures().map(entry => entry.id === 'chat' ? { ...entry, mergedIntoId: 'booking', mergedAt: now, mergedBy: 'staff-me' } : entry);
  const audit = await setup(page, entries, 'test-drives');
  await page.getByTestId('staff-test-drive-booking').getByRole('button', { name: 'Merge records', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Merge enquiries & appointments', exact: true });
  await expect(dialog.getByRole('region', { name: 'Main record' })).toContainText('BOOK-202');
  await expect(dialog.getByText('1 already linked record is included automatically.', { exact: true })).toBeVisible();
  await include(dialog, 'DRIVE-303');
  await review(dialog, 'Combine related test drives and preserve the earlier chat.');
  await dialog.getByRole('button', { name: 'Merge records', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(audit.writes[0].path).toBe('/api/staff/enquiries/booking/merge');
  expect(audit.writes[0].body.recordIds).toEqual(['booking', 'drive', 'chat']);
  expect(audit.writes[0].body.keepAppointmentIds).toEqual(['booking', 'drive']);
  await expect(page.getByTestId('staff-test-drive-booking')).toBeVisible();
  await expect(page.getByTestId('staff-test-drive-drive')).toBeVisible();
  expect(audit.rejectedWrites).toEqual([]);
});
