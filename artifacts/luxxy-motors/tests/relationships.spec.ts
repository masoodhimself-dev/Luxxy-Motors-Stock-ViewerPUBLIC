import { expect, test, type Page } from '@playwright/test';
import type { Enquiry, StaffOnlineReservation } from '@workspace/api-client-react';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Local staff preview with intercepted history records; every API write is blocked.');

type ActivityKind = 'enquiry' | 'appointment' | 'follow_up' | 'reservation' | 'sale' | 'payment' | 'document' | 'note';
type RecordType = 'enquiry' | 'reservation' | 'sale';
type Activity = {
  id: string;
  kind: ActivityKind;
  recordType: RecordType;
  recordId: string;
  reference: string;
  title: string;
  description: string;
  status: string;
  occurredAt: string;
  vehicleId: string | null;
  customerId: string;
  amountPence: number | null;
  url: string;
};

const ids = {
  active: 'history-bmw',
  sold: 'history-audi',
  archived: 'history-mini',
  alex: 'customer-alex',
  sam: 'customer-sam',
  enquiry: 'enquiry-alex',
  reservation: 'reservation-alex',
  sale: 'sale-alex',
};
const counts = (enquiries: number, appointments: number, reservations: number, sales: number) => ({ enquiries, appointments, reservations, sales });

function activity(input: Pick<Activity, 'id' | 'kind' | 'recordType' | 'recordId' | 'title' | 'occurredAt'> & Partial<Activity>): Activity {
  const section = input.recordType === 'enquiry' ? 'enquiries' : input.recordType === 'reservation' ? 'reservations' : 'sales';
  const selection = input.recordType === 'sale' ? 'saleId' : input.recordType === 'reservation' ? 'reservationId' : 'enquiryId';
  return {
    reference: 'FIXTURE-' + input.recordId.toUpperCase(),
    description: '',
    status: 'completed',
    vehicleId: ids.active,
    customerId: ids.alex,
    amountPence: null,
    url: `/portal?section=${section}&${selection}=${input.recordId}`,
    ...input,
  };
}

const activeActivities = [
  activity({ id: 'alex-enquiry', kind: 'enquiry', recordType: 'enquiry', recordId: ids.enquiry, title: 'Alex asked about the BMW', description: 'Please confirm the service history.', occurredAt: '2026-10-01T09:00:00Z', status: 'contacted' }),
  activity({ id: 'alex-appointment', kind: 'appointment', recordType: 'enquiry', recordId: ids.enquiry, title: 'BMW test drive attended', description: 'Customer arrived at the agreed time.', occurredAt: '2026-10-02T10:00:00Z', status: 'attended' }),
  activity({ id: 'alex-follow-up', kind: 'follow_up', recordType: 'enquiry', recordId: ids.enquiry, title: 'Follow up after the test drive', description: 'Alex would like to discuss part exchange.', occurredAt: '2026-10-02T12:00:00Z', status: 'completed' }),
  activity({ id: 'alex-note', kind: 'note', recordType: 'enquiry', recordId: ids.enquiry, title: 'Part exchange discussed', description: 'Keep this staff note in the enquiry history.', occurredAt: '2026-10-02T13:00:00Z' }),
  activity({ id: 'alex-reservation', kind: 'reservation', recordType: 'reservation', recordId: ids.reservation, title: 'BMW online reservation', description: 'Deposit paid; this is an intercepted fixture.', occurredAt: '2026-10-03T08:00:00Z', status: 'reserved', amountPence: 10000 }),
  activity({ id: 'sam-enquiry', kind: 'enquiry', recordType: 'enquiry', recordId: 'enquiry-sam', title: 'Sam asked about the BMW', description: 'A separate customer record for the same car.', occurredAt: '2026-10-03T09:00:00Z', status: 'new', customerId: ids.sam }),
];
const soldActivities = [
  activity({ id: 'alex-sale', kind: 'sale', recordType: 'sale', recordId: ids.sale, title: 'Audi sale completed', description: 'Sold vehicle remains in dealership history.', occurredAt: '2026-10-04T09:00:00Z', vehicleId: ids.sold, status: 'sold', amountPence: 1595000 }),
  activity({ id: 'alex-payment', kind: 'payment', recordType: 'sale', recordId: ids.sale, title: 'Audi balance received', description: 'Confirmed bank transfer.', occurredAt: '2026-10-04T11:00:00Z', vehicleId: ids.sold, status: 'confirmed', amountPence: 1585000 }),
  activity({ id: 'alex-document', kind: 'document', recordType: 'sale', recordId: ids.sale, title: 'Audi sales invoice issued', description: 'Invoice INV-HISTORY-001.', occurredAt: '2026-10-04T12:00:00Z', vehicleId: ids.sold, status: 'issued' }),
];
const archivedActivities = [
  activity({ id: 'sam-archived-enquiry', kind: 'enquiry', recordType: 'enquiry', recordId: 'enquiry-archived', title: 'Archived Mini enquiry', description: 'The car is no longer listed in current stock.', occurredAt: '2026-09-01T09:00:00Z', vehicleId: ids.archived, customerId: ids.sam, status: 'closed' }),
];

const fixture = {
  generatedAt: '2026-10-05T09:00:00Z',
  vehicles: [
    { id: ids.active, title: 'BMW 320i M Sport', registration: 'AB20 BMW', pricePence: 1895000, imageUrl: null, status: 'available', lastActivityAt: '2026-10-03T09:00:00Z', customerIds: [ids.alex, ids.sam], counts: counts(2, 1, 1, 0), activities: activeActivities },
    { id: ids.sold, title: 'Audi A3 Sport', registration: 'CD19 AUD', pricePence: 1595000, imageUrl: null, status: 'sold', lastActivityAt: '2026-10-04T12:00:00Z', customerIds: [ids.alex], counts: counts(0, 0, 0, 1), activities: soldActivities },
    { id: ids.archived, title: 'Mini Cooper Classic', registration: 'EF18 MIN', pricePence: 995000, imageUrl: null, status: 'archived', lastActivityAt: '2026-09-01T09:00:00Z', customerIds: [ids.sam], counts: counts(1, 0, 0, 0), activities: archivedActivities },
  ],
  customers: [
    { id: ids.alex, name: 'Alex Morgan', email: 'alex@example.test', phone: '07700 900101', matchingNote: 'Matched by email or phone; check the name before reusing details.', vehicleIds: [ids.active, ids.sold], recordKeys: [`enquiry:${ids.enquiry}`, `reservation:${ids.reservation}`, `sale:${ids.sale}`], lastActivityAt: '2026-10-04T12:00:00Z', counts: counts(1, 1, 1, 1), activities: [...activeActivities.filter(item => item.customerId === ids.alex), ...soldActivities] },
    { id: ids.sam, name: 'Sam Taylor', email: 'sam@example.test', phone: '07700 900202', matchingNote: 'Matched by email or phone; check the name before reusing details.', vehicleIds: [ids.active, ids.archived], recordKeys: ['enquiry:enquiry-sam', 'enquiry:enquiry-archived'], lastActivityAt: '2026-10-03T09:00:00Z', counts: counts(2, 0, 0, 0), activities: [activeActivities.find(item => item.id === 'sam-enquiry')!, ...archivedActivities] },
  ],
};

const sourceEnquiry: Enquiry = {
  id: ids.enquiry,
  reference: activeActivities[0].reference,
  dealerId: 'history-fixture-dealer',
  vehicleId: ids.active,
  vehicleTitle: fixture.vehicles[0].title,
  vehicleRegistration: fixture.vehicles[0].registration,
  vehiclePrice: 18950,
  vehicleUrl: null,
  appointmentAt: null,
  appointmentCancelledAt: null,
  managePath: null,
  calendarIcs: null,
  events: [],
  type: 'general',
  status: 'contacted',
  customerName: fixture.customers[0].name,
  email: fixture.customers[0].email,
  phone: fixture.customers[0].phone,
  preferredContact: 'phone',
  message: 'Please confirm the service history.',
  partExchangeRegistration: null,
  partExchangeMileage: null,
  partExchangeCondition: null,
  customerNotificationStatus: 'prepared',
  customerNotificationError: null,
  customerNotificationSentAt: null,
  dealerNotificationStatus: 'prepared',
  dealerNotificationError: null,
  dealerNotificationSentAt: null,
  reminderStatus: 'disabled',
  reminderError: null,
  reminderSentAt: null,
  source: 'phone',
  createdAt: '2026-10-01T09:00:00Z',
  updatedAt: '2026-10-02T13:00:00Z',
};
const otherEnquiry: Enquiry = {
  ...sourceEnquiry,
  id: 'enquiry-sam',
  reference: 'FIXTURE-ENQUIRY-SAM',
  customerName: fixture.customers[1].name,
  email: fixture.customers[1].email,
  phone: fixture.customers[1].phone,
};
const cancelledReservation: StaffOnlineReservation = {
  id: ids.reservation,
  reference: activeActivities.find(item => item.kind === 'reservation')!.reference,
  vehicleId: ids.active,
  vehicleTitle: fixture.vehicles[0].title,
  vehicleRegistration: fixture.vehicles[0].registration,
  depositPence: 10000,
  amountReceivedPence: 0,
  paymentStatus: 'simulated',
  status: 'cancelled',
  createdAt: '2026-10-03T08:00:00Z',
  customerName: fixture.customers[0].name,
  email: fixture.customers[0].email,
  phone: fixture.customers[0].phone,
  leadId: null,
};
const otherReservation: StaffOnlineReservation = {
  ...cancelledReservation,
  id: 'reservation-sam',
  reference: 'FIXTURE-RESERVATION-SAM',
  status: 'reserved',
  customerName: fixture.customers[1].name,
  email: fixture.customers[1].email,
  phone: fixture.customers[1].phone,
};

async function interceptHistory(page: Page, options: { empty?: boolean; fail?: boolean; forbidden?: boolean; sources?: boolean } = {}) {
  const writes: string[] = [];
  const errors: string[] = [];
  let failed = options.fail ?? false;
  let historyRequests = 0;
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      writes.push(`${request.method()} ${path}`);
      return route.fulfill({ status: 403, json: { error: 'History tests block all API writes.' } });
    }
    if (path === '/api/portal/session') return route.fulfill({ json: { state: options.forbidden ? 'forbidden' : 'allowed', name: 'History fixture staff', email: 'staff@example.test' } });
    if (path === '/api/staff/access') return route.fulfill({ json: { role: 'owner', permissions: ['sales.manage', 'settings.publish', 'finance.export'], user: { id: 'history-staff', name: 'History fixture staff', email: 'staff@example.test' } } });
    if (options.sources) {
      if (path === '/api/enquiries') return route.fulfill({ json: [sourceEnquiry, otherEnquiry] });
      if (path === '/api/reservations') return route.fulfill({ json: { reservations: [cancelledReservation, otherReservation] } });
      if (path === '/api/staff/stripe-reservations') return route.fulfill({ json: { reservations: [] } });
      if (path === '/api/sale-workspace') return route.fulfill({ json: { sales: [], preview: true } });
      if (path === '/api/staff/directory') return route.fulfill({ json: { currentUserId: 'history-staff', members: [{ id: 'history-staff', name: 'History fixture staff' }] } });
      if (path === '/api/stock') return route.fulfill({ json: { schemaVersion: 1, dealerName: 'History Motors', scrapedAt: fixture.generatedAt, count: 1, cars: [{ id: ids.active, title: fixture.vehicles[0].title, make: 'BMW', model: '320i', year: 2020, price: 18950, currency: 'GBP', registration: fixture.vehicles[0].registration, plate: fixture.vehicles[0].registration, inventoryStatus: 'available', images: [] }] } });
    }
    if (path === '/api/staff/relationships') {
      historyRequests++;
      return route.fulfill(failed
        ? { status: 503, json: { error: 'History fixture temporarily unavailable.' } }
        : { json: options.empty ? { generatedAt: fixture.generatedAt, vehicles: [], customers: [] } : fixture });
    }
    return route.continue();
  });
  return {
    recover: () => { failed = false; },
    historyRequests: () => historyRequests,
    assertReadOnly: () => { expect(writes).toEqual([]); expect(errors).toEqual([]); },
  };
}

async function expectNoOverflow(page: Page) {
  const widths = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(widths.document, 'The page must fit the viewport.').toBeLessThanOrEqual(widths.viewport + 1);
  expect(widths.body, 'The history content must fit the viewport.').toBeLessThanOrEqual(widths.viewport + 1);
}

const timeline = (page: Page) => page.getByRole('region', { name: 'Activity history', exact: true });
const vehicleProfile = (page: Page) => page.getByRole('article', { name: 'Selected vehicle history', exact: true });
const customerProfile = (page: Page) => page.getByRole('article', { name: 'Selected customer history', exact: true });
const viewButtons = (page: Page) => page.getByRole('navigation', { name: 'History views', exact: true });

async function expectHistoryUrl(page: Page, values: Record<string, string>) {
  await expect.poll(() => Object.fromEntries(new URL(page.url()).searchParams)).toEqual(expect.objectContaining({ section: 'history', ...values }));
}

async function expectEvents(page: Page, expectedIds: string[]) {
  await expect.poll(() => timeline(page).locator('[data-testid^="relationship-activity-"]').evaluateAll(rows => rows.map(row => row.getAttribute('data-testid')?.replace('relationship-activity-', '')))).toEqual(expectedIds);
}

test('vehicle and customer profiles connect all related records and preserve navigation', async ({ page }) => {
  const state = await interceptHistory(page);
  await page.goto('/portal?section=history&view=vehicles');
  await expect(page.getByTestId('tab-history')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { name: 'Vehicle & customer history', exact: true })).toBeVisible();
  await page.getByTestId(`relationship-vehicle-${ids.active}`).click();
  await expectHistoryUrl(page, { view: 'vehicles', vehicleId: ids.active });
  await expect(vehicleProfile(page).getByRole('heading', { name: 'BMW 320i M Sport', exact: true })).toBeVisible();
  await expect(page.getByTestId(`relationship-vehicle-${ids.active}`)).toHaveAttribute('aria-current', 'true');
  const customers = page.getByRole('region', { name: 'Interested customers', exact: true });
  await expect(customers.getByRole('button')).toHaveCount(2);
  await customers.getByRole('button', { name: /Alex Morgan/ }).click();
  await expectHistoryUrl(page, { view: 'customers', customerId: ids.alex, record: `enquiry:${ids.enquiry}` });
  await expect(customerProfile(page).getByRole('heading', { name: 'Alex Morgan', exact: true })).toBeVisible();
  await expect(customerProfile(page).getByText(fixture.customers[0].matchingNote, { exact: true })).toBeVisible();
  await expectEvents(page, ['alex-document', 'alex-payment', 'alex-sale', 'alex-reservation', 'alex-note', 'alex-follow-up', 'alex-appointment', 'alex-enquiry']);
  const cars = page.getByRole('region', { name: 'Cars in this history', exact: true });
  await expect(cars.getByRole('button')).toHaveCount(2);
  await cars.getByRole('button', { name: /Audi A3 Sport/ }).click();
  await expectHistoryUrl(page, { view: 'vehicles', vehicleId: ids.sold });
  await expect(vehicleProfile(page).getByText('Sold', { exact: true })).toBeVisible();
  await expectEvents(page, ['alex-document', 'alex-payment', 'alex-sale']);
  await page.goBack();
  await expect(customerProfile(page).getByRole('heading', { name: 'Alex Morgan', exact: true })).toBeVisible();
  await page.goForward();
  await expect(vehicleProfile(page).getByRole('heading', { name: 'Audi A3 Sport', exact: true })).toBeVisible();
  await page.reload();
  await expect(vehicleProfile(page).getByRole('heading', { name: 'Audi A3 Sport', exact: true })).toBeVisible();
  state.assertReadOnly();
});

test('timeline categories include follow-ups, notes, payments and documents in the correct histories', async ({ page }) => {
  const state = await interceptHistory(page);
  await page.goto(`/portal?section=history&view=customers&customerId=${ids.alex}`);
  const filters = timeline(page).getByRole('group', { name: 'Filter activity timeline', exact: true });
  await expectEvents(page, ['alex-document', 'alex-payment', 'alex-sale', 'alex-reservation', 'alex-note', 'alex-follow-up', 'alex-appointment', 'alex-enquiry']);
  for (const [category, activities] of [
    ['Enquiries', ['alex-note', 'alex-follow-up', 'alex-enquiry']],
    ['Appointments', ['alex-appointment']],
    ['Reservations', ['alex-reservation']],
    ['Sales', ['alex-document', 'alex-payment', 'alex-sale']],
  ] as const) {
    await filters.getByRole('button', { name: category, exact: true }).click();
    await expect(filters.getByRole('button', { name: category, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expectEvents(page, [...activities]);
  }
  const payment = page.getByTestId('relationship-activity-alex-payment');
  await expect(payment.getByText('£15,850.00', { exact: true })).toBeVisible();
  await expect(payment.getByText('Confirmed', { exact: true })).toBeVisible();
  await expect(payment.getByRole('link', { name: 'Open sale file', exact: true })).toHaveAttribute('href', `/portal?section=sales&saleId=${ids.sale}`);
  await filters.getByRole('button', { name: 'All activity', exact: true }).click();
  await expectEvents(page, ['alex-document', 'alex-payment', 'alex-sale', 'alex-reservation', 'alex-note', 'alex-follow-up', 'alex-appointment', 'alex-enquiry']);
  await expect(page.getByTestId('relationship-activity-alex-reservation').getByRole('link', { name: 'Open reservation', exact: true })).toHaveAttribute('href', `/portal?section=reservations&reservationId=${ids.reservation}`);
  await expect(page.getByTestId('relationship-activity-alex-enquiry').getByRole('link', { name: 'Open enquiry', exact: true })).toHaveAttribute('href', `/portal?section=enquiries&enquiryId=${ids.enquiry}`);
  await expect(timeline(page).getByText('Dates and times shown in London time.', { exact: true })).toBeVisible();
  state.assertReadOnly();
});

for (const [type, id, title] of [
  ['enquiry', ids.enquiry, 'BMW 320i M Sport'],
  ['reservation', ids.reservation, 'BMW 320i M Sport'],
  ['sale', ids.sale, 'Audi A3 Sport'],
] as const) {
  test(`${type} record deep links resolve the vehicle and customer without a profile ID`, async ({ page }) => {
    const state = await interceptHistory(page);
    const record = `${type}:${id}`;
    await page.goto(`/portal?section=history&view=vehicles&record=${encodeURIComponent(record)}`);
    await expect(vehicleProfile(page).getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expectHistoryUrl(page, { view: 'vehicles', record });
    await page.goto(`/portal?section=history&view=customers&record=${encodeURIComponent(record)}`);
    await expect(customerProfile(page).getByRole('heading', { name: 'Alex Morgan', exact: true })).toBeVisible();
    await expectHistoryUrl(page, { view: 'customers', record });
    state.assertReadOnly();
  });
}

test('sold and archived vehicles remain searchable and linked to customer history', async ({ page }) => {
  const state = await interceptHistory(page);
  await page.goto('/portal?section=history&view=vehicles');
  const search = page.getByLabel('Search vehicle history', { exact: true });
  await search.fill('CD19AUD');
  await expect(page.getByTestId(`relationship-vehicle-${ids.sold}`)).toBeVisible();
  await expect(page.getByTestId(`relationship-vehicle-${ids.active}`)).toHaveCount(0);
  await page.getByTestId(`relationship-vehicle-${ids.sold}`).click();
  await expect(vehicleProfile(page).getByText('Sold', { exact: true })).toBeVisible();
  await viewButtons(page).getByRole('button', { name: /Vehicle history/ }).click();
  await search.fill('EF18MIN');
  await page.getByTestId(`relationship-vehicle-${ids.archived}`).click();
  await expect(vehicleProfile(page).getByText('Archived', { exact: true })).toBeVisible();
  await expect(page.getByTestId('relationship-activity-sam-archived-enquiry')).toBeVisible();
  await page.getByRole('region', { name: 'Interested customers', exact: true }).getByRole('button', { name: /Sam Taylor/ }).click();
  await expect(customerProfile(page).getByRole('heading', { name: 'Sam Taylor', exact: true })).toBeVisible();
  await expectEvents(page, ['sam-enquiry', 'sam-archived-enquiry']);
  state.assertReadOnly();
});

test('customer contact search and empty timeline categories can be cleared', async ({ page }) => {
  const state = await interceptHistory(page);
  await page.goto('/portal?section=history&view=customers');
  await page.getByLabel('Search customer history', { exact: true }).fill('07700900202');
  await expect(page.getByTestId(`relationship-customer-${ids.sam}`)).toBeVisible();
  await expect(page.getByTestId(`relationship-customer-${ids.alex}`)).toHaveCount(0);
  await page.getByTestId(`relationship-customer-${ids.sam}`).click();
  await timeline(page).getByRole('button', { name: 'Sales', exact: true }).click();
  await expect(timeline(page).getByRole('heading', { name: 'No activity in this category', exact: true })).toBeVisible();
  await expectEvents(page, []);
  await timeline(page).getByRole('button', { name: 'Show all activity', exact: true }).click();
  await expectEvents(page, ['sam-enquiry', 'sam-archived-enquiry']);
  await viewButtons(page).getByRole('button', { name: /Customer history/ }).click();
  await page.getByLabel('Search customer history', { exact: true }).fill('no-such-customer@example.test');
  await expect(page.getByRole('heading', { name: 'No matching histories', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(page.getByTestId(`relationship-customer-${ids.alex}`)).toBeVisible();
  await expect(page.getByTestId(`relationship-customer-${ids.sam}`)).toBeVisible();
  state.assertReadOnly();
});

test('empty histories and missing deep links provide a route back to the directory', async ({ page }) => {
  const state = await interceptHistory(page, { empty: true });
  await page.goto('/portal?section=history&view=vehicles');
  await expect(page.getByRole('heading', { name: 'No vehicle history yet', exact: true })).toBeVisible();
  await viewButtons(page).getByRole('button', { name: /Customer history/ }).click();
  await expect(page.getByRole('heading', { name: 'No customer history yet', exact: true })).toBeVisible();
  await page.goto('/portal?section=history&view=customers&record=enquiry%3Amissing');
  await expect(page.getByRole('heading', { name: 'This history could not be found', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Browse customers', exact: true }).click();
  await expectHistoryUrl(page, { view: 'customers' });
  expect(new URL(page.url()).searchParams.has('record')).toBe(false);
  await expect(page.getByRole('heading', { name: 'This history could not be found', exact: true })).toHaveCount(0);
  state.assertReadOnly();
});

test('a history load failure can be retried without losing the requested profile', async ({ page }) => {
  const state = await interceptHistory(page, { fail: true });
  await page.goto(`/portal?section=history&view=vehicles&vehicleId=${ids.sold}`);
  await expect(page.getByRole('alert').getByText('History could not be loaded.', { exact: true })).toBeVisible();
  await expect(vehicleProfile(page)).toHaveCount(0);
  const attemptsBeforeRetry = state.historyRequests();
  state.recover();
  await page.getByRole('alert').getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(vehicleProfile(page).getByRole('heading', { name: 'Audi A3 Sport', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expectHistoryUrl(page, { view: 'vehicles', vehicleId: ids.sold });
  expect(state.historyRequests()).toBeGreaterThan(attemptsBeforeRetry);
  state.assertReadOnly();
});

for (const width of [390, 820, 1440]) {
  test(`vehicle and customer history fit ${width}px without JavaScript errors`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const state = await interceptHistory(page);
    await page.goto(`/portal?section=history&view=vehicles&vehicleId=${ids.active}`);
    await expect(vehicleProfile(page).getByRole('heading', { name: 'BMW 320i M Sport', exact: true })).toBeVisible();
    await expect(page.getByTestId('relationship-activity-alex-appointment')).toBeVisible();
    await expectNoOverflow(page);
    await page.screenshot({ path: `/private/tmp/luxxy-history-vehicles-${width}.png`, fullPage: true });
    await page.getByRole('region', { name: 'Interested customers', exact: true }).getByRole('button', { name: /Alex Morgan/ }).click();
    await expect(customerProfile(page).getByRole('heading', { name: 'Alex Morgan', exact: true })).toBeVisible();
    await expect(page.getByTestId('relationship-activity-alex-document')).toBeVisible();
    await expectNoOverflow(page);
    await page.screenshot({ path: `/private/tmp/luxxy-history-customers-${width}.png`, fullPage: true });
    if (width < 1024) await page.getByRole('button', { name: 'Back to customers', exact: true }).click();
    else await viewButtons(page).getByRole('button', { name: /Customer history/ }).click();
    await expect(page.getByTestId(`relationship-customer-${ids.alex}`)).toBeVisible();
    await expectNoOverflow(page);
    state.assertReadOnly();
  });
}

async function expectOriginalEnquiry(page: Page) {
  await expect.poll(() => Object.fromEntries(new URL(page.url()).searchParams)).toEqual(expect.objectContaining({ section: 'enquiries', enquiryId: ids.enquiry }));
  await expect(page.getByRole('tab', { name: 'Find enquiry or appointment', exact: true })).toHaveAttribute('aria-selected', 'true');
  const desk = page.getByRole('tabpanel', { name: 'Find enquiry or appointment', exact: true });
  await expect(desk.getByLabel('Find a customer or car', { exact: true })).toHaveValue(sourceEnquiry.reference);
  await expect(desk.getByTestId(`enquiry-${ids.enquiry}`)).toContainText(sourceEnquiry.customerName);
  await expect(desk.getByTestId('enquiry-enquiry-sam')).toHaveCount(0);
}

async function openOriginalEnquiryFromHistory(page: Page) {
  await page.getByTestId('tab-history').click();
  await viewButtons(page).getByRole('button', { name: /Customer history/ }).click();
  await page.getByTestId(`relationship-customer-${ids.alex}`).click();
  await page.getByTestId('relationship-activity-alex-enquiry').getByRole('link', { name: 'Open enquiry', exact: true }).click();
  await expectOriginalEnquiry(page);
}

test('enquiry customer-name and vehicle links open history and return to the exact source record', async ({ page }) => {
  const state = await interceptHistory(page, { sources: true });
  await page.goto(`/portal?section=enquiries&enquiryId=${ids.enquiry}`);
  await expectOriginalEnquiry(page);
  const enquiry = page.getByTestId(`enquiry-${ids.enquiry}`);
  await enquiry.getByRole('link', { name: 'Alex Morgan', exact: true }).click();
  await expectHistoryUrl(page, { view: 'customers', record: `enquiry:${ids.enquiry}` });
  await expect(customerProfile(page).getByRole('heading', { name: 'Alex Morgan', exact: true })).toBeVisible();
  await page.getByTestId('relationship-activity-alex-enquiry').getByRole('link', { name: 'Open enquiry', exact: true }).click();
  await expectOriginalEnquiry(page);
  await enquiry.getByRole('link', { name: 'Vehicle history', exact: true }).click();
  await expectHistoryUrl(page, { view: 'vehicles', vehicleId: ids.active });
  await expect(vehicleProfile(page).getByRole('heading', { name: fixture.vehicles[0].title, exact: true })).toBeVisible();
  state.assertReadOnly();
});

test('opening a cancelled reservation from history shows all records and selects the exact source', async ({ page }) => {
  const state = await interceptHistory(page, { sources: true });
  await page.goto(`/portal?section=history&view=customers&customerId=${ids.alex}`);
  await page.getByTestId('relationship-activity-alex-reservation').getByRole('link', { name: 'Open reservation', exact: true }).click();
  await expect.poll(() => Object.fromEntries(new URL(page.url()).searchParams)).toEqual(expect.objectContaining({ section: 'reservations', reservationId: ids.reservation }));
  await expect(page.getByLabel('Reservation status', { exact: true })).toHaveValue('all');
  const reservation = page.getByTestId(`staff-reservation-${ids.reservation}`);
  await expect(reservation).toContainText(cancelledReservation.reference);
  await expect(reservation).toContainText('Cancelled');
  await expect(reservation).toHaveAttribute('tabindex', '-1');
  await expect(reservation).toBeFocused();
  await expect(reservation.getByRole('button', { name: 'Cancel reservation', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('staff-reservation-reservation-sam')).toBeVisible();
  await reservation.getByRole('link', { name: 'Customer history', exact: true }).click();
  await expectHistoryUrl(page, { view: 'customers', record: `reservation:${ids.reservation}` });
  await expect(customerProfile(page).getByRole('heading', { name: 'Alex Morgan', exact: true })).toBeVisible();
  state.assertReadOnly();
});

test('history enquiry links neither start a hidden sale nor replace an unsaved sale or prompt to discard it', async ({ page }) => {
  const state = await interceptHistory(page, { sources: true });
  const dialogs: string[] = [];
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.goto('/portal?section=sales');
  const sales = page.locator('#portal-content-sales');
  await expect(sales.getByRole('heading', { name: 'Your first sale starts here', exact: true })).toBeVisible();
  await openOriginalEnquiryFromHistory(page);
  await expect(sales).toBeHidden();
  await expect(sales.locator('.sales-drafts-home')).toHaveCount(1);
  await expect(sales.getByLabel('Customer name', { exact: true })).toHaveCount(0);
  expect(dialogs).toEqual([]);

  await page.getByTestId('tab-sales').click();
  await page.locator('.portal-workspace-heading').getByRole('button', { name: 'New sale', exact: true }).click();
  await sales.getByLabel('Customer name', { exact: true }).fill('Unrelated unsaved buyer');
  await sales.getByLabel('Email', { exact: true }).fill('unsaved-buyer@example.test');
  await expect(sales.locator('.sales-draft-state')).toHaveAttribute('data-dirty', 'true');
  await openOriginalEnquiryFromHistory(page);
  await expect(sales).toBeHidden();
  await expect(sales.getByLabel('Customer name', { exact: true })).toHaveValue('Unrelated unsaved buyer');
  await expect(sales.getByLabel('Email', { exact: true })).toHaveValue('unsaved-buyer@example.test');
  expect(dialogs).toEqual([]);
  await page.getByTestId('tab-sales').click();
  await expect(sales.getByLabel('Customer name', { exact: true })).toBeVisible();
  await expect(sales.getByLabel('Customer name', { exact: true })).toHaveValue('Unrelated unsaved buyer');
  await expect(sales.getByLabel('Email', { exact: true })).toHaveValue('unsaved-buyer@example.test');
  await expect(sales.locator('.sales-draft-state')).toHaveAttribute('data-dirty', 'true');
  expect(dialogs).toEqual([]);
  state.assertReadOnly();
});

test('history stays behind the staff access boundary', async ({ page }) => {
  const state = await interceptHistory(page, { forbidden: true });
  await page.goto(`/portal?section=history&view=customers&customerId=${ids.alex}`);
  await expect(page.getByRole('heading', { name: 'Access unavailable', exact: true })).toBeVisible();
  await expect(page.getByTestId('tab-history')).toHaveCount(0);
  await expect(page.getByText('Alex Morgan', { exact: true })).toHaveCount(0);
  expect(state.historyRequests()).toBe(0);
  state.assertReadOnly();
});
