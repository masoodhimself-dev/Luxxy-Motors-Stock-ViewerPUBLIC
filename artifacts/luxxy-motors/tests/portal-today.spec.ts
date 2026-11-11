import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  changeSaleWorkspace,
  createSaleWorkspace,
  publicSaleWorkspace,
  saleQueueStatus,
  saleQueueToday,
  saleWorkspaceTotals,
  type SaleWorkspaceContext,
} from '@workspace/vehicle-meta';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'The Today audit uses isolated fixture data.');

const baseURL = 'http://127.0.0.1:4328';
const output = process.env.PORTAL_TODAY_SCREENSHOTS ?? '/private/tmp/dealeros-today-review';
const now = '2026-11-11T10:00:00.000Z';
const enquiryId = '10000000-0000-4000-8000-000000000071';
const bookingId = '10000000-0000-4000-8000-000000000072';
const collectionId = '10000000-0000-4000-8000-000000000073';
const carId = '10000000-0000-4000-8000-000000000074';
const saleId = '10000000-0000-4000-8000-000000000075';
const calendarHref = '/portal?section=notifications&workView=test-drives&deskView=calendar';
const inboxHref = '/portal?section=notifications&workView=customers';
const ownerPermissions = ['sales.manage', 'stock.manage', 'settings.publish', 'payments.record', 'payments.refund', 'sales.handover'];

const car = {
  id: carId, advertId: 'TODAY-PREVIEW', make: 'BMW', model: '2 Series', year: 2018,
  title: 'BMW 2 Series', price: 8990, currency: 'GBP', mileage: 64200,
  registration: 'LM18 JTX', plate: 'LM18 JTX', vrm: 'LM18 JTX', vrmVerified: true,
  fuel: 'Petrol', transmission: 'Automatic', bodyType: 'Coupe',
  heroImage: '/src/assets/demo-car-hero.jpg',
  images: [{ url: '/src/assets/demo-car-hero.jpg', caption: 'Front three-quarter view' }],
  inventoryStatus: 'reserved',
};
const owner = { id: 'preview-alex', authUserId: 'preview-alex', name: 'Alex Morgan', email: 'alex@example.test' };
const settingsIdentity = {
  name: 'Multi Choice Motors',
  logoText: 'MULTICHOICE MOTORS',
  logoAsset: '/brand/multi-choice-motors/multi-choice-wordmark.svg',
};

function fixtureSale() {
  let id = 0;
  const context: SaleWorkspaceContext = {
    now, actor: owner.name, actorId: owner.authUserId,
    nextId: () => id++ === 0 ? saleId : `10000000-0000-4000-8000-${String(100 + id).padStart(12, '0')}`,
    nextNumber: (kind) => `${kind.toUpperCase()}-PREVIEW-001`,
    branding: {
      identity: settingsIdentity, contact: { phone: '020 0000 0123', email: 'sales@example.test' },
      address: { street: '12 Example Road', city: 'Hayes', region: 'London', postcode: 'UB3 1AA' },
      legal: { companyName: 'Multi Choice Motors', companyNumber: '', vatNumber: '' },
    },
    vehicle: { id: carId, title: car.title, registration: car.registration, mileage: car.mileage },
  };
  const { sale } = createSaleWorkspace({
    requestId: 'today-preview-sale-create',
    draft: {
      customer: 'Ellie Carter', email: 'ellie@example.test', phone: '07700900123',
      address: '10 Example Road, Hayes, UB3 1AA', vehicleId: carId, vehicle: car.title,
      registration: car.registration, price: '8990', sourceEnquiryId: enquiryId,
      collection: '2026-11-12',
      fulfilment: {
        method: 'collection', viewed: 'viewed', address: '', recipient: 'Ellie Carter',
        phone: '', scheduledDate: '2026-11-12', timeWindow: '14:00', instructions: '',
      },
    },
  }, context, 'S-2048');
  const reserved = changeSaleWorkspace(sale, {
    action: 'take-deposit',
    payment: { kind: 'deposit', amount: '500', method: 'Bank transfer', status: 'confirmed', date: '2026-11-10', reference: 'PREVIEW-DEPOSIT' },
  }, { expectedRevision: sale.revision, requestId: 'today-preview-sale-deposit' }, context).sale;
  return publicSaleWorkspace(changeSaleWorkspace(reserved, {
    action: 'payment',
    payment: { kind: 'final-payment', amount: '8490', method: 'Bank transfer', status: 'pending', date: '2026-11-11', reference: 'PREVIEW-BALANCE' },
  }, { expectedRevision: reserved.revision, requestId: 'today-preview-sale-pending-payment' }, context).sale);
}

const enquiries = [
  { id: enquiryId, reference: 'ENQ-2071', customerName: 'Ellie Carter', type: 'general', appointmentAt: null, appointmentStatus: null },
  { id: bookingId, reference: 'ENQ-2072', customerName: 'James Wilson', type: 'viewing', appointmentAt: '2026-11-11T11:30:00.000Z', appointmentStatus: 'pending' },
  { id: collectionId, reference: 'ENQ-2073', customerName: 'Priya Shah', type: 'viewing', appointmentAt: '2026-11-11T15:00:00.000Z', appointmentStatus: 'confirmed' },
].map((entry) => ({
  ...entry, status: 'new', email: `${entry.reference.toLowerCase()}@example.test`, phone: '07700900123', preferredContact: 'email',
  vehicleId: carId, vehicleTitle: car.title, vehicleRegistration: car.registration, vehiclePrice: car.price,
  vehicleUrl: `/vehicle/${carId}`, source: 'website', message: 'Can you confirm what I need to bring?',
  workspaceRevision: 1, appointmentRevision: 1, followUpRevision: 1, appointmentDurationMinutes: 30,
  createdAt: '2026-11-11T09:15:00.000Z', updatedAt: '2026-11-11T09:15:00.000Z',
  attendance: 'scheduled', appointmentCancelledAt: null, followUpAt: null, followUpCompletedAt: null, events: [],
}));

const notificationItems = [
  { category: 'enquiries', entry: enquiries[0], vehicle: car.title, detail: 'Awaiting a reply', at: enquiries[0].createdAt, href: `/portal?section=enquiries&enquiryId=${enquiryId}` },
  { category: 'appointments', entry: enquiries[1], vehicle: 'Audi A5', detail: 'Booking needs approval', at: enquiries[1].appointmentAt, href: `/portal?section=test-drives&enquiryId=${bookingId}` },
  { category: 'appointments', entry: enquiries[2], vehicle: 'Volkswagen Golf', detail: 'Appointment today', at: enquiries[2].appointmentAt, href: `/portal?section=test-drives&enquiryId=${collectionId}` },
].map(({ entry, ...item }) => ({ ...item, id: entry.id, enquiryId: entry.id, customer: entry.customerName, reference: entry.reference }));

async function installFixture(page: Page, role: 'owner' | 'accounts' = 'owner') {
  const permissions = role === 'owner' ? ownerPermissions : ['payments.record', 'payments.refund', 'finance.export'];
  const sale = fixtureSale();
  const totals = saleWorkspaceTotals(sale.draft, sale.payments);
  const writes: string[] = [];
  const errors: string[] = [];
  const apiReads: string[] = [];
  const [{ identity, ...settings }, stock] = await Promise.all([
    page.request.get('/api/dealer-settings').then((response) => response.json()),
    page.request.get('/api/stock').then((response) => response.json()),
  ]);

  await page.clock.setFixedTime(new Date(now));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (url.origin !== baseURL) return route.abort();
    if (!path.startsWith('/api/')) return route.continue();
    if (path.startsWith('/api/staff/workspace/presence/')) return route.fulfill({ json: { presence: null } });
    if (!['GET', 'HEAD'].includes(request.method())) {
      writes.push(`${request.method()} ${path}`);
      return route.fulfill({ status: 403, json: { error: 'The Today browser fixture blocks record writes.' } });
    }
    apiReads.push(`${path}${url.search}`);
    if (path === '/api/portal/session') return route.fulfill({ json: { state: 'allowed', name: owner.name, email: owner.email } });
    if (path === '/api/staff/access') return route.fulfill({ json: { role, permissions, user: owner } });
    if (path === '/api/dealer-settings') return route.fulfill({ json: { ...settings, identity: { ...identity, ...settingsIdentity } } });
    if (path === '/api/stock') return route.fulfill({ json: { ...stock, dealerName: settingsIdentity.name, count: 1, cars: [car] } });
    if (path === '/api/staff/cars') return route.fulfill({ json: {
      feed: { source: 'Preview stock', state: 'current', scheduled: false, receivedAt: now, appliedAt: now },
      cars: [{ ...car, staff: {
        source: 'autotrader', sourceStatus: 'live', inventoryStatus: 'reserved', published: true,
        firstSeenAt: now, lastSeenAt: now, archivedAt: null, changes: [],
        sale: { id: saleId, reference: sale.reference, status: 'reserved' },
        mot: { state: 'due', tone: 'amber', label: 'MOT due', date: '2026-11-21', checkedAt: now, lastMileage: '64,200 miles' },
      } }],
    } });
    if (path === '/api/staff/notifications') return route.fulfill({ json: {
      generatedAt: now, counts: { enquiries: 1, followups: 0, appointments: 2, drafts: 0, email: 0 },
      items: notificationItems, emailAccess: role === 'owner',
    } });
    if (path === '/api/sale-workspace') {
      const { draft } = sale;
      return route.fulfill({ json: {
        sales: [{
          ...sale,
          listSummary: true, listTotalDue: totals.totalDue, listPaid: totals.confirmedPaid,
          listPending: totals.pending, listBalance: totals.balance, listLedgerKnown: true, listStage: 'Reserved',
          listAttention: saleQueueStatus(sale, saleQueueToday(new Date(now))).attention,
          listHandover: { method: 'collection', status: 'Booked', scheduledDate: draft.fulfilment?.scheduledDate, timeWindow: draft.fulfilment?.timeWindow },
          draft: {
            id: draft.id, customer: draft.customer, email: draft.email, phone: draft.phone,
            vehicleId: draft.vehicleId, vehicle: draft.vehicle, registration: draft.registration, sourceEnquiryId: enquiryId,
          },
          documents: [], payments: [], events: [],
        }],
        hasMore: false,
      } });
    }
    if (path === `/api/sale-workspace/${saleId}`) return route.fulfill({ json: { sale } });
    if (path === '/api/enquiries') return route.fulfill({ json: enquiries });
    if (path === '/api/test-drive-bookings') return route.fulfill({ json: enquiries.slice(1) });
    if (path === '/api/staff/email/reply-attention') return route.fulfill({ json: url.searchParams.has('enquiryId') ? { pending: 0, review: 0 } : { enquiries: [] } });
    if (path === '/api/staff/email') return route.fulfill({ json: { messages: [], hasMore: false } });
    if (path === '/api/staff/email-drafts') return route.fulfill({ json: { drafts: [], hasMore: false } });
    if (/\/conversations$/.test(path)) return route.fulfill({ json: { events: [], total: 0, nextCursor: null } });
    return route.continue();
  });
  return { writes, errors, apiReads };
}

const fits = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

async function showCalendar(page: Page, mobile: boolean) {
  if (mobile) {
    await page.getByRole('navigation', { name: 'Portal sections' }).getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Calendar', exact: true }).click();
  } else {
    await page.getByTestId('tab-calendar').click();
  }
}

test('Today opens each existing workflow from the appropriate record', async ({ page }, info) => {
  const fixture = await installFixture(page);
  const mobile = info.project.use.viewport!.width < 768;
  const nav = page.getByRole('navigation', { name: 'Portal sections' });
  await page.goto('/portal');
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(page.getByTestId('tab-today')).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('button')).toHaveText(mobile
    ? ['Today', /^Inbox(?:\s*\d+)?$/, 'Stock', 'Sales', 'More']
    : ['Today', /^Inbox(?:\s*\d+)?$/, 'Stock', 'Sales', 'Calendar']);
  if (mobile) {
    const rect = await nav.boundingBox();
    expect(rect!.y + rect!.height).toBeLessThanOrEqual(info.project.use.viewport!.height + 1);
    expect(rect!.y).toBeGreaterThan(info.project.use.viewport!.height - 110);
  } else {
    const rect = await nav.boundingBox();
    expect(rect!.x).toBeLessThan(80);
    expect(rect!.width).toBeGreaterThanOrEqual(145);
    for (const button of await nav.getByRole('button').all()) {
      expect(await button.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    }
  }

  const attention = page.getByRole('region', { name: 'Needs attention', exact: true });
  await expect(attention).toContainText('Ellie Carter');
  await expect(attention).toContainText('James Wilson');
  await expect(attention).toContainText(/£8,490/);
  await expect(attention).toContainText('BMW 2 Series');
  await expect(page.getByRole('region', { name: /Today.s appointments/i })).toContainText('Priya Shah');
  await expect(page.getByRole('region', { name: 'Upcoming collection', exact: true })).toContainText('BMW 2 Series');
  await expect(page.getByRole('button', { name: 'New', exact: true })).toBeVisible();
  await expect(fits(page)).resolves.toBe(true);
  await mkdir(output, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(output, `${info.project.name}-today.png`), animations: 'disabled' });

  await attention.getByRole('button', { name: 'Customers', exact: true }).click();
  await expect(attention.getByRole('link', { name: 'Open sale', exact: true })).toHaveCount(0);
  await expect(attention.getByRole('link', { name: 'Open booking', exact: true })).toBeVisible();
  await attention.getByRole('button', { name: 'All work', exact: true }).click();
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'New enquiry', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Write a letter', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Check MOT', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'New', exact: true })).toBeFocused();

  await attention.getByRole('link', { name: /reply|enquiry/i }).first().click();
  await expect(page).toHaveURL(new RegExp(`enquiryId=${enquiryId}`));
  await expect(page.getByRole('article', { name: 'Customer workspace for Ellie Carter', exact: true })).toBeVisible();
  await expect(fits(page)).resolves.toBe(true);
  await page.screenshot({ path: join(output, `${info.project.name}-inbox.png`), animations: 'disabled' });
  await page.getByTestId('tab-today').click();
  await attention.getByRole('link', { name: /booking/i }).first().click();
  await expect(page).toHaveURL(new RegExp(`enquiryId=${bookingId}`));
  await expect(page.getByTestId(`staff-test-drive-${bookingId}`)).toBeVisible();
  await page.getByTestId('tab-today').click();
  await attention.getByRole('link', { name: /vehicle file|stock/i }).click();
  await expect(page).toHaveURL(new RegExp(`carId=${carId}`));
  await expect(page.getByRole('heading', { name: /vehicle file/i })).toBeVisible();
  await expect(fits(page)).resolves.toBe(true);
  await page.getByTestId('tab-today').click();
  await attention.getByRole('link', { name: /sale|payment/i }).click();
  await expect.poll(() => fixture.apiReads.includes(`/api/sale-workspace/${saleId}`)).toBe(true);
  await expect(page.getByRole('heading', { name: 'Payments and documents', exact: true })).toBeVisible();
  await expect(fits(page)).resolves.toBe(true);
  await page.goto('/portal?section=today');
  await showCalendar(page, mobile);
  await expect(page).toHaveURL(new RegExp(calendarHref.split('?')[1]));
  await expect(page.getByRole('region', { name: 'Appointment calendar', exact: true })).toBeVisible();
  await expect(fits(page)).resolves.toBe(true);
  if (mobile) {
    await nav.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  } else {
    await page.getByTestId('tab-settings').click();
  }
  await expect(page).toHaveURL(/section=settings/);
  await expect(page.getByRole('tablist', { name: 'Settings categories', exact: true })).toBeVisible();
  await expect(fits(page)).resolves.toBe(true);
  await page.goto(`${inboxHref}&enquiryId=${enquiryId}`);
  await expect(page.getByRole('article', { name: 'Customer workspace for Ellie Carter', exact: true })).toBeVisible();
  expect(fixture.writes).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test('accounts staff can still open Sales and do not get owner controls', async ({ page }, info) => {
  const fixture = await installFixture(page, 'accounts');
  const mobile = info.project.use.viewport!.width < 768;
  await page.goto('/portal');
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Needs attention', exact: true })).toContainText(/£8,490/);
  await expect(page.getByRole('button', { name: 'New', exact: true })).toHaveCount(0);
  if (mobile) {
    await page.getByRole('navigation', { name: 'Portal sections' }).getByRole('button', { name: 'More', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: 'Calendar', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Settings', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
  } else {
    await expect(page.getByTestId('tab-settings')).toHaveCount(0);
  }
  await page.getByTestId('tab-sales').click();
  await expect(page).toHaveURL(/section=sales/);
  await expect(page.getByRole('heading', { name: 'Sales', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'New sale', exact: true })).toHaveCount(0);
  await expect(fits(page)).resolves.toBe(true);
  expect(fixture.writes).toEqual([]);
  expect(fixture.errors).toEqual([]);
});
