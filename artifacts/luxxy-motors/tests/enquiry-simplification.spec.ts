import { expect, test, type Page } from '@playwright/test';

const now = '2026-10-20T10:00:00Z';
const image = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#dce6ed"/><path d="M170 310h460l-45-100H250z" fill="#315b75"/><circle cx="270" cy="310" r="42" fill="#192e3b"/><circle cx="540" cy="310" r="42" fill="#192e3b"/></svg>').toString('base64')}`;
const car = {
  id: 'fictional-car', advertId: 'fictional-layout-check', title: 'Toyota Yaris', make: 'Toyota', model: 'Yaris',
  year: 2020, price: 11995, mileage: 28000, transmission: 'Automatic', fuel: 'Petrol Hybrid',
  plate: 'ZZ20 TST', colour: 'Blue', inventoryStatus: 'available', heroImage: image, images: [{ url: image, caption: 'Front' }],
  sourceExtras: { advertDescription: 'Fictional vehicle for read-only layout checks.', featureList: ['Rear parking sensors', 'Bluetooth'] },
};
const base = {
  dealerId: 'preview', vehicleId: car.id, vehicleTitle: car.title, vehicleRegistration: car.plate, vehiclePrice: car.price,
  phone: '07700 900101', email: 'fictional.customer.with.a.long.email.address@example.test', preferredContact: 'phone',
  status: 'new', type: 'general', source: 'website', assignedToId: 'preview-staff', assignedToName: 'Sam Dealer',
  callOutcome: null, workspaceRevision: 1, followUpRevision: 0, appointmentRevision: 0, appointmentAt: null,
  appointmentCancelledAt: null, followUpAt: null, followUpCompletedAt: null, staffNote: null,
  createdAt: '2026-10-20T08:30:00Z', updatedAt: now, events: [],
};
const entries = [
  { ...base, id: 'needs-reply', reference: 'INTERNAL-ENQ-101', customerName: 'Alex Morgan', message: 'Is this Yaris still available? I would like to know about the service history.' },
  { ...base, id: 'overdue-followup', reference: 'INTERNAL-ENQ-102', customerName: 'Jamie Taylor', source: 'phone', callOutcome: 'callback_requested', followUpAt: '2026-10-20T08:00:00Z', followUpNote: 'Call Jamie to confirm the service documents.', message: 'Please call after checking the service book.' },
  { ...base, id: 'today-visit', reference: 'INTERNAL-ENQ-103', customerName: 'Casey Patel', type: 'viewing', appointmentAt: '2026-10-20T13:00:00Z', appointmentStatus: 'confirmed', attendance: 'scheduled', message: 'Looking forward to a test drive this afternoon.' },
  { ...base, id: 'closed-record', reference: 'INTERNAL-ENQ-104', customerName: 'Jordan Brown', status: 'closed', callOutcome: 'not_interested', message: 'Thank you, I have bought another car.' },
];
const activities = [
  { id: 'fictional-enquiry-event', kind: 'enquiry', recordType: 'enquiry', recordId: 'needs-reply', reference: 'INTERNAL-ENQ-101', title: 'Enquiry received', description: entries[0].message, status: 'new', occurredAt: entries[0].createdAt, vehicleId: car.id, customerId: 'fictional-customer', amountPence: null, url: '/portal?section=notifications&workView=customers&enquiryId=needs-reply' },
  { id: 'fictional-visit-event', kind: 'appointment', recordType: 'enquiry', recordId: 'today-visit', reference: 'INTERNAL-ENQ-103', title: 'Test drive booked', description: 'Customer would like to check the boot space.', status: 'confirmed', occurredAt: '2026-10-20T13:00:00Z', vehicleId: car.id, customerId: 'fictional-customer', amountPence: null, url: '/portal?section=notifications&workView=test-drives&enquiryId=today-visit' },
];
const counts = { enquiries: 2, appointments: 1, reservations: 0, sales: 0 };
const relationships = {
  generatedAt: now,
  vehicles: [{ id: car.id, title: car.title, registration: car.plate, pricePence: 1199500, imageUrl: image, status: 'available', lastActivityAt: now, customerIds: ['fictional-customer'], counts, activities }],
  customers: [{ id: 'fictional-customer', name: 'Alex Morgan', phone: base.phone, email: base.email, matchingNote: 'Possible match by exact email or phone. Confirm the customer before reusing details.', vehicleIds: [car.id], recordKeys: ['enquiry:needs-reply', 'enquiry:today-visit'], lastActivityAt: now, counts, activities }],
};

async function setup(page: Page, enquiryEntries: readonly Record<string, unknown>[] = entries) {
  const writes: string[] = [];
  const runtimeErrors: string[] = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  await page.clock.setFixedTime(new Date(now));
  // No test is allowed to send email or change saved application data.
  await page.route('**/api/**', route => {
    if (!['GET', 'HEAD'].includes(route.request().method())) {
      writes.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
      return route.abort();
    }
    return route.continue();
  });
  await page.route('**/api/stock', route => route.fulfill({ json: { schemaVersion: 1, count: 1, cars: [car] } }));
  await page.route(/\/api\/enquiries(?:\?|$)/, route => route.fulfill({ json: enquiryEntries }));
  await page.route('**/api/staff/directory', route => route.fulfill({ json: { currentUserId: 'preview-staff', members: [{ id: 'preview-staff', name: 'Sam Dealer' }] } }));
  await page.route('**/api/staff/enquiries/*/conversations*', route => route.fulfill({ json: { events: [{ id: 'earlier-conversation', kind: 'conversation_logged', actor: 'dealer', note: 'Service book checked. Customer would like to see it at the appointment.', summary: 'Conversation recorded', callOutcome: 'information_given', staffName: 'Sam Dealer', occurredAt: '2026-10-20T09:00:00Z' }], total: 1, nextCursor: null } }));
  await page.route('**/api/staff/email?*', route => route.fulfill({ json: { messages: [], hasMore: false } }));
  await page.route('**/api/staff/email-drafts?*', route => route.fulfill({ json: { drafts: [], hasMore: false } }));
  await page.route('**/api/staff/relationships', route => route.fulfill({ json: relationships }));
  await page.goto('/portal?section=notifications&workView=customers');
  return { writes, runtimeErrors };
}

test('a closed merged case keeps its original overdue task visible and actionable', async ({ page }) => {
  const width = 390;
  await page.setViewportSize({ width, height: 1000 });
  const root = entries.find(entry => entry.id === 'closed-record')!;
  const child = {
    ...entries.find(entry => entry.id === 'overdue-followup')!,
    id: 'merged-overdue', reference: 'INTERNAL-MERGED-105', customerName: root.customerName,
    mergedIntoId: root.id, message: 'Earlier enquiry: please confirm the service documents before calling.',
  };
  const { writes, runtimeErrors } = await setup(page, [root, child]);
  const caseRow = page.getByTestId(`enquiry-${root.id}`);
  await expect(caseRow).toBeVisible();
  await expect(page.locator('.enquiry-compact-list > li')).toHaveCount(1);
  await expect(caseRow.locator('.enquiry-state-label')).toHaveText('Follow-up overdue');
  await expect(caseRow).toContainText('Next step is on a linked enquiry');
  const queues = page.getByRole('group', { name: 'Filter enquiries by next step' });
  await queues.getByRole('button', { name: /^Follow-ups/ }).click();
  await expect(caseRow).toBeVisible();
  await caseRow.getByRole('button').click();
  const detail = page.getByRole('region', { name: `Selected enquiry: ${root.customerName}` });
  const linkedWork = detail.getByRole('region', { name: 'Work on linked enquiries' });
  await expect(linkedWork).toBeVisible();
  await expect(linkedWork).toContainText('Follow-up overdue');
  await linkedWork.getByRole('button', { name: 'Open linked task', exact: true }).click();
  const original = detail.locator(`#linked-enquiry-${child.id}`);
  await expect(original).toHaveAttribute('open', '');
  await expect(original).toContainText(child.message);
  await expect(original.getByRole('region', { name: 'Recommended next action' })).toContainText('Complete follow-up');
  await noOverflow(page, width);
  await page.screenshot({ path: '../../output/enquiry-simplification/merged-overdue-390.png', fullPage: true });
  await queues.getByRole('button', { name: /^No task scheduled/ }).click();
  await expect(caseRow).toHaveCount(0);
  await expect(page.locator('.enquiry-compact-list > li')).toHaveCount(0);
  await expect(page.getByText('No matching enquiries. Try another name or phone number.', { exact: true })).toBeVisible();
  await noOverflow(page, width);
  expect(writes).toEqual([]);
  expect(runtimeErrors).toEqual([]);
});

async function noOverflow(page: Page, width: number) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
}

for (const width of [390, 820, 1440]) {
  test(`clear enquiry queue, detail and history at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const { writes, runtimeErrors } = await setup(page);
    await expect(page.getByRole('textbox', { name: 'Find a customer or car' })).toBeVisible();
    await expect(page.getByTestId('enquiry-needs-reply')).toBeVisible();
    const queue = page.getByRole('group', { name: 'Filter enquiries by next step' });
    await expect(page.locator('.enquiry-compact-list > li').first()).toHaveAttribute('data-testid', 'enquiry-overdue-followup');
    for (const [label, id] of [
      ['Needs reply', 'needs-reply'], ['Follow-ups', 'overdue-followup'],
      ['Test drives', 'today-visit'], ['No task scheduled', 'closed-record'],
    ]) {
      await queue.getByRole('button', { name: new RegExp(`^${label}`) }).click();
      await expect(page.locator('.enquiry-compact-list > li')).toHaveCount(1);
      await expect(page.getByTestId(`enquiry-${id}`)).toBeVisible();
    }
    await queue.getByRole('button', { name: /^All enquiries/ }).click();
    await expect(page.locator('.enquiry-compact-list > li')).toHaveCount(4);
    for (const button of await queue.getByRole('button').all()) {
      const box = (await button.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    }
    const tools = page.locator('details.enquiry-simple-filters');
    const toolsSummary = tools.locator('summary');
    await toolsSummary.click();
    await tools.getByRole('combobox', { name: 'Enquiry ownership', exact: true }).selectOption('unassigned');
    await expect(page.locator('.enquiry-compact-list > li')).toHaveCount(0);
    await toolsSummary.click();
    await expect(toolsSummary).toContainText('active');
    await noOverflow(page, width);
    await toolsSummary.click();
    await tools.getByRole('combobox', { name: 'Enquiry ownership', exact: true }).selectOption('all');
    await tools.getByRole('combobox', { name: 'Show', exact: true }).selectOption('due');
    await expect(page.locator('.enquiry-compact-list > li')).toHaveCount(1);
    await expect(page.getByTestId('enquiry-overdue-followup')).toBeVisible();
    await toolsSummary.click();
    await expect(toolsSummary).toContainText('active');
    await toolsSummary.click();
    await tools.getByRole('combobox', { name: 'Show', exact: true }).selectOption('all');
    await toolsSummary.click();
    await expect(toolsSummary).not.toContainText('active');
    await expect(page.locator('.enquiry-compact-list > li')).toHaveCount(4);
    await noOverflow(page, width);
    await page.screenshot({ path: `../../output/enquiry-simplification/enquiries-${width}.png`, fullPage: true });
    await page.getByTestId('enquiry-needs-reply').getByRole('button').click();
    const detail = page.getByRole('region', { name: 'Selected enquiry: Alex Morgan' });
    await expect(detail).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Find a customer or car' })).toHaveValue('');
    await expect(page.locator('.enquiry-compact-list > li')).toHaveCount(4);
    await expect(detail).toContainText('Is this Yaris still available?');
    await expect(detail).not.toContainText('INTERNAL-ENQ-101');
    const nextStep = detail.getByRole('region', { name: 'Recommended next action' });
    await expect(nextStep).toContainText('Call the customer');
    if (width < 900) {
      for (const link of await detail.locator('.enquiry-detail-contact a').all()) {
        expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
    }
    await nextStep.getByRole('button', { name: 'Record the response', exact: true }).click();
    const conversation = page.getByRole('dialog', { name: 'Log another conversation', exact: true });
    await expect(conversation).toBeVisible();
    await expect(conversation).toContainText('Alex Morgan');
    await conversation.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(conversation).toHaveCount(0);
    await detail.getByRole('button', { name: 'Customer history', exact: true }).click();
    const customerHistory = page.getByRole('dialog', { name: 'Alex Morgan — customer history' });
    await expect(customerHistory).toBeVisible();
    await expect(customerHistory).toContainText('Most recent first');
    await noOverflow(page, width);
    await page.keyboard.press('Escape');
    await expect(customerHistory).toHaveCount(0);
    await noOverflow(page, width);
    await detail.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `../../output/enquiry-simplification/detail-${width}.png`, fullPage: true });
    if (width < 900) {
      await expect(page.getByTestId('enquiry-needs-reply')).toBeHidden();
      await detail.getByRole('button', { name: 'Back to enquiries' }).click();
      await expect(page.getByTestId('enquiry-needs-reply')).toBeVisible();
    }
    await expect(page.locator('.enquiry-compact-list > li')).toHaveCount(4);
    if (width >= 900) {
      await page.getByTestId('enquiry-today-visit').getByRole('button').click();
      await expect(page.getByRole('region', { name: 'Selected enquiry: Casey Patel' })).toBeVisible();
      await expect(page.locator('.enquiry-compact-list > li')).toHaveCount(4);
      await expect(page.getByRole('textbox', { name: 'Find a customer or car' })).toHaveValue('');
    }
    const search = page.getByRole('textbox', { name: 'Find a customer or car' });
    await search.fill('Alex');
    await expect(page.getByTestId('enquiry-needs-reply')).toBeVisible();
    await expect(page.getByTestId('enquiry-overdue-followup')).toHaveCount(0);
    await search.fill('');
    await noOverflow(page, width);
    expect(writes).toEqual([]);
    expect(runtimeErrors).toEqual([]);
  });

  test(`vehicle and customer histories stay readable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const { writes, runtimeErrors } = await setup(page);
    await page.goto(`/portal?section=history&view=vehicles&vehicleId=${car.id}`);
    const history = page.getByTestId('history-panel');
    await expect(history).toBeVisible();
    await expect(history.getByRole('heading', { name: 'Toyota Yaris', exact: true })).toBeVisible();
    await expect(history).toContainText('Enquiry received');
    await expect(history).toContainText('Test drive booked');
    await expect(history).not.toContainText('INTERNAL-ENQ-101');
    const filters = history.getByRole('group', { name: 'Filter activity timeline' });
    await filters.getByRole('button', { name: 'Appointments', exact: true }).click();
    await expect(history.getByTestId('relationship-activity-fictional-visit-event')).toBeVisible();
    await expect(history.getByTestId('relationship-activity-fictional-enquiry-event')).toHaveCount(0);
    await filters.getByRole('button', { name: 'All activity', exact: true }).click();
    await expect(history.getByTestId('relationship-activity-fictional-enquiry-event')).toBeVisible();
    await noOverflow(page, width);
    await page.screenshot({ path: `../../output/enquiry-simplification/vehicle-history-${width}.png`, fullPage: true });
    await page.goto('/portal?section=history&view=customers&record=enquiry%3Aneeds-reply');
    await expect(history.getByRole('heading', { name: 'Alex Morgan', exact: true })).toBeVisible();
    await expect(history).toContainText(base.email);
    await noOverflow(page, width);
    await page.screenshot({ path: `../../output/enquiry-simplification/customer-history-${width}.png`, fullPage: true });
    if (width < 900) await history.getByRole('button', { name: 'Back to customers', exact: true }).click();
    const customerSearch = history.getByRole('searchbox', { name: 'Search customer history' });
    await customerSearch.fill('07700900101');
    await expect(history.getByTestId('relationship-customer-fictional-customer')).toBeVisible();
    await customerSearch.fill('no matching fictional customer');
    await expect(history.getByRole('heading', { name: 'No matching histories' })).toBeVisible();
    await history.getByRole('button', { name: 'Clear search', exact: true }).click();
    await expect(history.getByTestId('relationship-customer-fictional-customer')).toBeVisible();
    await noOverflow(page, width);
    expect(writes).toEqual([]);
    expect(runtimeErrors).toEqual([]);
  });
}

for (const width of [390, 820, 1440]) test(`appointment follow-up stays a reviewed draft at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const missed = width === 390;
  const appointment = { ...entries[2], appointmentAt: '2026-10-18T13:00:00Z', attendance: missed ? 'no_show' : 'completed' };
  const { writes, runtimeErrors } = await setup(page, [appointment]);
  await page.route('**/api/staff/enquiries/*/email-context', route => route.fulfill({ json: {
    version: 0, savedDraft: null, email: 'alex@example.test', customerName: appointment.customerName,
    vehicleId: car.id, vehicleTitle: car.title, reference: appointment.reference, revision: 1,
    vehicleAvailable: true, appointmentAvailable: true, defaults: { subject: 'Original subject', message: 'Original message' },
    ready: true, templates: [], invoices: [], photos: [], deliveries: [],
  } }));
  await page.getByTestId(`enquiry-${appointment.id}`).getByRole('button').click();
  const selected = page.getByRole('region', { name: `Selected enquiry: ${appointment.customerName}` });
  await selected.getByRole('button', { name: 'Follow-up email', exact: true }).click();
  const composer = page.getByRole('dialog', { name: 'Prepare customer email', exact: true });
  await expect(composer).toBeVisible();
  await expect(composer.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue('Any questions about the Toyota Yaris?');
  const message = composer.getByRole('textbox', { name: 'Message', exact: true });
  await expect(message).toHaveValue(new RegExp(missed ? 'We missed you' : 'Thanks for coming'));
  await expect(message).toHaveValue(/If you’d like to leave a deposit/);
  await expect(message).toHaveValue(/confirm availability/);
  await expect(composer.getByRole('checkbox', { name: 'Appointment details', exact: true })).not.toBeChecked();
  await message.scrollIntoViewIfNeeded();
  await noOverflow(page, width);
  await page.screenshot({ path: `../../output/enquiry-simplification/appointment-follow-up-${width}.png`, fullPage: true });
  expect(writes).toEqual([]);
  expect(runtimeErrors).toEqual([]);
  await composer.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(composer).toHaveCount(0);
  expect(writes).toEqual([]);
});
