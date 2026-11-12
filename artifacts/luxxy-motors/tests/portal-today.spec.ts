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
  type SaleHandoffTask,
  type SaleWorkspaceContext,
  type SaleWorkspaceRecord,
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

function fixtureSale(mode: 'pending' | 'refund' = 'pending', recordedRefunds: string[] = []) {
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
      customer: mode === 'refund' ? 'Refund fixture buyer' : 'Ellie Carter', email: 'ellie@example.test', phone: '07700900123',
      address: '10 Example Road, Hayes, UB3 1AA', vehicleId: carId, vehicle: car.title,
      registration: car.registration, price: '8990', sourceEnquiryId: enquiryId,
      ...(mode === 'pending' ? {
        collection: '2026-11-12',
        fulfilment: {
          method: 'collection', viewed: 'viewed', address: '', recipient: 'Ellie Carter',
          phone: '', scheduledDate: '2026-11-12', timeWindow: '14:00', instructions: '',
        },
      } : {}),
    },
  }, context, 'S-2048');
  if (mode === 'refund') {
    let refundSale = changeSaleWorkspace(sale, {
      action: 'invoice-payment',
      payment: { kind: 'part-payment', amount: '100', method: 'Bank transfer', status: 'confirmed', date: '2026-11-11', reference: 'FIXTURE-REFUND-100' },
      stockConflictReconciliation: { reason: 'The car was reserved for another buyer.', acknowledge: true },
    }, { expectedRevision: sale.revision, requestId: 'today-preview-conflict-payment' }, context).sale;
    const paymentId = refundSale.payments[0].id;
    for (const [index, amount] of recordedRefunds.entries()) {
      refundSale = changeSaleWorkspace(refundSale, {
        action: 'reverse', paymentId, kind: 'refund', amount, date: '2026-11-11',
        reason: 'Refund recorded in the fixture.', invoiceOnly: true,
      }, { expectedRevision: refundSale.revision, requestId: `today-preview-conflict-refund-${index}` }, context).sale;
    }
    return publicSaleWorkspace(refundSale);
  }
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

async function installFixture(page: Page, role: 'owner' | 'accounts' = 'owner', initialSale = fixtureSale(), runClock = false) {
  const permissions = role === 'owner' ? ownerPermissions : ['payments.record', 'payments.refund', 'finance.export'];
  let sale = initialSale;
  const writes: string[] = [];
  const errors: string[] = [];
  const apiReads: string[] = [];
  const [{ identity, ...settings }, stock] = await Promise.all([
    page.request.get('/api/dealer-settings').then((response) => response.json()),
    page.request.get('/api/stock').then((response) => response.json()),
  ]);

  if (runClock) await page.clock.install({ time: new Date(now) });
  else await page.clock.setFixedTime(new Date(now));
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
    if (path === '/api/sale-workspace/handoff-tasks') return route.fulfill({ json: {
      tasks: (url.searchParams.get('view') === 'needs-reassignment' ? [] : sale.handoffTasks ?? []).filter(task => task.status === 'open' && task.assigneeId === owner.authUserId)
        .map(task => ({ saleId: sale.id, reference: sale.reference, customer: sale.draft.customer, vehicle: sale.draft.vehicle, task })),
      hasMore: false,
    } });
    if (path === '/api/sale-workspace') {
      const { draft } = sale;
      const totals = saleWorkspaceTotals(draft, sale.payments);
      const { attention, refundDue } = saleQueueStatus(sale, saleQueueToday(new Date(now)), now);
      return route.fulfill({ json: {
        sales: url.searchParams.get('queue') === 'attention' && !attention ? [] : [{
          ...sale,
          listSummary: true, listTotalDue: totals.totalDue, listPaid: totals.confirmedPaid,
          listPending: totals.pending, listBalance: totals.balance, listLedgerKnown: true,
          listStage: sale.lifecycle?.status === 'reserved' ? 'Reserved' : 'Draft',
          listAttention: attention, ...(refundDue ? { listRefundDue: refundDue } : {}),
          listHandover: draft.fulfilment?.scheduledDate ? { method: 'collection', status: 'Booked', scheduledDate: draft.fulfilment.scheduledDate, timeWindow: draft.fulfilment.timeWindow } : null,
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
    if (path === `/api/sale-workspace/${saleId}/handoff-tasks`) return route.fulfill({ json: {
      members: [{ id: owner.authUserId, name: owner.name }, { id: 'preview-jo', name: 'Jo West' }],
    } });
    if (path === '/api/enquiries') return route.fulfill({ json: enquiries });
    if (path === '/api/test-drive-bookings') return route.fulfill({ json: enquiries.slice(1) });
    if (path === '/api/staff/email/reply-attention') return route.fulfill({ json: url.searchParams.has('enquiryId') ? { pending: 0, review: 0 } : { enquiries: [] } });
    if (path === '/api/staff/email') return route.fulfill({ json: { messages: [], hasMore: false } });
    if (path === '/api/staff/email-drafts') return route.fulfill({ json: { drafts: [], hasMore: false } });
    if (/\/conversations$/.test(path)) return route.fulfill({ json: { events: [], total: 0, nextCursor: null } });
    return route.continue();
  });
  return { writes, errors, apiReads, replaceSale: (updated: SaleWorkspaceRecord) => { sale = updated; } };
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
  await page.goto(`/portal?section=sales&saleId=${saleId}`);
  const handoverAction = page.getByRole('button', { name: 'Arrange collection or delivery', exact: true });
  await expect(handoverAction).toBeDisabled();
  await expect(handoverAction).toHaveAccessibleDescription('Ask someone with handover access.');
  await expect(fits(page)).resolves.toBe(true);
  expect(fixture.writes).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test('unsettled refund appears on Today and in the Sales queue until the whole refund is recorded', async ({ page }) => {
  // Accounts can follow a payment task without permission to manage the sale.
  const fixture = await installFixture(page, 'accounts', fixtureSale('refund'));
  const attention = page.getByRole('region', { name: 'Needs attention', exact: true });
  const task = attention.getByRole('listitem').filter({ hasText: 'Refund to record' });
  const history = page.locator('.invoice-payment-list');
  const originalPayment = history.getByText(/FIXTURE-REFUND-100/).filter({ hasText: 'Received for refund' });

  await page.goto('/portal');
  await expect(task).toContainText('Refund fixture buyer');
  await expect(task).toContainText('£100.00');
  await expect(task).not.toContainText('£8,890');
  const todayShortcut = task.getByRole('link', { name: 'Open sale', exact: true });
  await expect(todayShortcut).toHaveAttribute('href', `/portal?section=sales&saleId=${saleId}&saleAction=payments`);
  await todayShortcut.click();
  await expect(page.getByRole('heading', { name: 'Payments and documents', exact: true })).toBeVisible();
  await expect(originalPayment).toBeVisible();
  await expect(history).toContainText('£100.00');
  await expect(page.getByText(/Record the £100\.00 refund here once it has been paid/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Take a payment', exact: true })).toHaveCount(0);
  await expect(fits(page)).resolves.toBe(true);

  fixture.replaceSale(fixtureSale('refund', ['40']));
  await page.goto('/portal?section=sales');
  await page.getByRole('button', { name: 'Needs attention', exact: true }).click();
  const row = page.getByRole('article').filter({ hasText: 'Refund fixture buyer' });
  await expect(row).toContainText('Refund to record');
  await expect(row).toContainText('£60.00');
  await expect(row).not.toContainText('£8,930');
  await row.getByRole('button', { name: 'Review payment for refund', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Payments and documents', exact: true })).toBeVisible();
  await expect(originalPayment).toBeVisible();
  await expect(history).toContainText('Refund recorded');
  await expect(history).toContainText('£40.00');
  await expect(page.getByText(/Record the £60\.00 refund here once it has been paid/)).toBeVisible();

  fixture.replaceSale(fixtureSale('refund', ['40', '60']));
  await page.goto('/portal');
  await expect(attention.getByText('Nothing needs attention right now.', { exact: true })).toBeVisible();
  await expect(task).toHaveCount(0);
  await page.getByTestId('tab-sales').click();
  await expect(row).toBeVisible();
  await page.getByRole('button', { name: 'Needs attention', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nothing needs attention' })).toBeVisible();
  await expect(row).toHaveCount(0);
  expect(fixture.apiReads).toContain('/api/sale-workspace?queue=attention');
  expect(fixture.apiReads).toContain(`/api/sale-workspace/${saleId}`);
  expect(fixture.writes).toEqual([]);
  expect(fixture.errors).toEqual([]);
});


test('assigned staff tasks on Today open the exact Sales screen with their private note', async ({ page }, info) => {
  const initial = fixtureSale();
  const payment: SaleHandoffTask = {
    id: '10000000-0000-4000-8000-000000000081', kind: 'check-payment', status: 'open',
    assigneeId: owner.authUserId, assigneeName: owner.name, note: 'Check the £500 deposit has reached the bank.',
    createdAt: now, createdBy: owner.name, updatedAt: now, updatedBy: owner.name,
  };
  const collection: SaleHandoffTask = {
    ...payment, id: '10000000-0000-4000-8000-000000000082', kind: 'arrange-collection', note: 'Ask which morning works.',
  };
  const fixture = await installFixture(page, 'owner', { ...initial, handoffTasks: [payment, collection] });
  const attention = page.getByRole('region', { name: 'Needs attention', exact: true });
  const paymentLink = attention.getByRole('link', { name: 'Open payments', exact: true });
  const collectionLink = attention.getByRole('link', { name: 'Open handover', exact: true });
  const taskList = page.getByRole('list', { name: 'Open staff tasks' });
  await page.goto('/portal');
  await expect(paymentLink).toHaveAttribute('href', `/portal?section=sales&saleId=${saleId}&saleAction=payments&saleTaskId=${payment.id}`);
  await expect(collectionLink).toHaveAttribute('href', `/portal?section=sales&saleId=${saleId}&saleAction=handover&saleTaskId=${collection.id}`);
  await expect(attention.getByText('Payment to confirm', { exact: true })).toBeVisible();
  await expect(attention).toContainText('£8,490.00 due');
  await expect(attention).not.toContainText(payment.note);
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: join(output, `${info.project.name}-today-staff-tasks.png`), animations: 'disabled' });
  await paymentLink.click();
  await expect(page.getByRole('heading', { name: 'Payments and documents', exact: true })).toBeVisible();
  await expect(taskList).toContainText(payment.note);
  await expect(taskList).not.toContainText(collection.note);
  await expect(taskList.getByText('Check payment', { exact: true })).toBeFocused();
  await expect(taskList.getByRole('button', { name: 'Mark check payment done' })).toBeVisible();
  await expect(fits(page)).resolves.toBe(true);
  await page.screenshot({ path: join(output, `${info.project.name}-handoff-payments.png`), animations: 'disabled' });

  await page.getByRole('button', { name: 'All actions', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Sale overview', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await paymentLink.click();
  await expect(page.getByRole('heading', { name: 'Payments and documents', exact: true })).toBeVisible();
  await expect(taskList.getByText('Check payment', { exact: true })).toBeFocused();

  await page.goBack();
  await collectionLink.click();
  await expect(page.getByRole('region', { name: 'Collection and delivery', exact: true })).toBeVisible();
  await expect(taskList).toContainText(collection.note);
  await expect(taskList).not.toContainText(payment.note);
  await expect(taskList.getByRole('button', { name: 'Mark arrange collection done' })).toBeVisible();
  await expect(fits(page)).resolves.toBe(true);

  await page.goto(`/portal?section=sales&saleId=${saleId}`);
  await expect(page.getByRole('heading', { name: 'Sale overview', exact: true })).toBeVisible();
  await page.getByText('Staff tasks', { exact: true }).click();
  await taskList.getByRole('button', { name: 'Edit check payment task' }).click();
  const editor = page.getByRole('form', { name: 'Edit staff task', exact: true });
  await expect(editor.getByRole('option', { name: 'Jo West' })).toBeAttached();
  await expect(editor.getByRole('textbox', { name: 'Staff note (optional)' })).toHaveValue(payment.note);
  await expect(editor.getByRole('button', { name: 'Save task' })).toBeDisabled();
  await expect(fits(page)).resolves.toBe(true);
  await editor.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(output, `${info.project.name}-staff-task-editor.png`), animations: 'disabled' });
  expect(fixture.writes).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test('Today loads the next assigned task even if an earlier task was completed', async ({ page }) => {
  const fixture = await installFixture(page);
  const entries = Array.from({ length: 10 }, (_, index) => ({
    saleId: `10000000-0000-4000-8000-${String(100 + index).padStart(12, '0')}`,
    customer: `Assigned customer ${index + 1}`, vehicle: car.title, reference: `S-${index + 1}`,
    task: {
      id: `10000000-0000-4000-8000-${String(200 + index).padStart(12, '0')}`, status: 'open', kind: 'check-payment',
      assigneeId: owner.authUserId, assigneeName: owner.name, note: 'Confirm the transfer.',
      createdAt: now, createdBy: owner.name, updatedAt: now, updatedBy: owner.name,
    },
  }));
  const reads: Array<string | null> = [];
  const nextCursor = 'fixture-after-customer-9';
  await page.route('**/api/sale-workspace/handoff-tasks*', route => {
    const query = new URL(route.request().url()).searchParams;
    if (query.get('view') === 'needs-reassignment') return route.fallback();
    const cursor = query.get('cursor');
    reads.push(cursor);
    if (!cursor) return route.fulfill({ json: { tasks: entries.slice(0, 9), hasMore: true, nextCursor } });
    expect(cursor).toBe(nextCursor);
    // A colleague closed customer 1's task after we loaded the first page.
    const remaining = entries.slice(1);
    const previousPageEnd = remaining.findIndex(entry => entry.saleId === entries[8].saleId);
    return route.fulfill({ json: { tasks: remaining.slice(previousPageEnd + 1), hasMore: false } });
  });
  await page.goto('/portal');
  const attention = page.getByRole('region', { name: 'Needs attention' });
  await attention.getByRole('button', { name: 'Sales', exact: true }).click();
  const payments = attention.getByRole('link', { name: 'Open payments', exact: true });
  await expect(attention.getByRole('listitem')).toHaveCount(8);
  await expect(payments).toHaveCount(7);
  const more = attention.getByRole('button', { name: 'Show more jobs', exact: true });
  await more.click();
  await expect(payments).toHaveCount(9);
  expect(reads).toEqual([null]);
  await more.click();
  await expect(payments).toHaveCount(10);
  await expect(attention).toContainText('Assigned customer 10');
  expect(reads).toEqual([null, nextCursor]);
  expect(fixture.writes).toEqual([]);
});

test('Today picks up a task assigned from another device while the page remains open', async ({ page }) => {
  const initial = fixtureSale();
  const fixture = await installFixture(page, 'owner', initial, true);
  await page.goto('/portal');
  await expect(page.locator('.today-summary')).toBeVisible();
  const attention = page.getByRole('region', { name: 'Needs attention' });
  await expect(attention.getByRole('link', { name: 'Open payments', exact: true })).toHaveCount(0);
  fixture.replaceSale({
    ...initial,
    handoffTasks: [{
      id: '10000000-0000-4000-8000-000000000085', kind: 'check-payment', status: 'open',
      assigneeId: owner.authUserId, assigneeName: owner.name, note: 'Find the bank transfer.',
      createdAt: now, createdBy: owner.name, updatedAt: now, updatedBy: owner.name,
    }],
  });
  await page.clock.fastForward(61_000);
  await expect(attention.getByRole('link', { name: 'Open payments', exact: true })).toBeVisible();
  expect(fixture.writes).toEqual([]);
});

test('Today focuses the completed collection task status if it closes after the list loads', async ({ page }) => {
  const initial = fixtureSale();
  const collection: SaleHandoffTask = {
    id: '10000000-0000-4000-8000-000000000083', kind: 'arrange-collection', status: 'open',
    assigneeId: owner.authUserId, assigneeName: owner.name, note: 'Ask which morning works.',
    createdAt: now, createdBy: owner.name, updatedAt: now, updatedBy: owner.name,
  };
  const fixture = await installFixture(page, 'owner', { ...initial, handoffTasks: [collection] });
  await page.goto('/portal');
  const open = page.getByRole('region', { name: 'Needs attention' }).getByRole('link', { name: 'Open handover', exact: true });
  await expect(open).toBeVisible();
  fixture.replaceSale({
    ...initial,
    draft: { ...initial.draft, fulfilment: { ...initial.draft.fulfilment!, completedAt: now } },
    handoffTasks: [{ ...collection, status: 'cancelled', resolutionReason: 'handover-completed' }],
  });
  await open.click();
  await expect(page.getByRole('heading', { name: 'Sale overview', exact: true })).toBeVisible();
  const status = page.getByText('This task was closed when the handover was recorded.');
  await expect(status).toBeVisible();
  await expect(status).toBeFocused();
  await expect(page.getByRole('button', { name: 'Mark arrange collection done' })).toHaveCount(0);
  expect(fixture.writes).toEqual([]);
});

test('Today directs the manager to the task that needs reassignment', async ({ page }) => {
  const task: SaleHandoffTask = {
    id: '10000000-0000-4000-8000-000000000084', kind: 'check-payment', status: 'open',
    assigneeId: 'disabled-staff', assigneeName: 'Old Assignee', note: 'Confirm the transfer.',
    createdAt: now, createdBy: owner.name, updatedAt: now, updatedBy: owner.name,
  };
  const initial = fixtureSale();
  const fixture = await installFixture(page, 'owner', { ...initial, handoffTasks: [task] });
  await page.route('**/api/sale-workspace/handoff-tasks?view=needs-reassignment', route => route.fulfill({ json: {
    tasks: [{ task, saleId, reference: initial.reference, customer: initial.draft.customer, vehicle: initial.draft.vehicle, assignmentIssue: 'inactive' }],
    hasMore: false,
  } }));
  await page.goto('/portal');
  const attention = page.getByRole('region', { name: 'Needs attention' });
  const reassign = attention.getByRole('link', { name: 'Reassign task', exact: true });
  await expect(reassign).toHaveAttribute('href', `/portal?section=sales&saleId=${saleId}&saleAction=tasks&saleTaskId=${task.id}`);
  await reassign.click();
  const tasks = page.getByRole('list', { name: 'Open staff tasks' });
  await expect(tasks.getByText('Check payment', { exact: true })).toBeFocused();
  await expect(tasks).toContainText(task.note);
  await expect(tasks.getByRole('button', { name: 'Edit check payment task' })).toBeVisible();
  expect(fixture.writes).toEqual([]);
});
