import { expect, test, type Page } from '@playwright/test';
import type { StockChangeTask } from '../src/lib/stock-change-tasks';

const now = '2026-10-20T10:00:00Z';
const image = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#dce6ed"/><path d="M170 310h460l-45-100H250z" fill="#315b75"/><circle cx="270" cy="310" r="42" fill="#192e3b"/><circle cx="540" cy="310" r="42" fill="#192e3b"/></svg>').toString('base64')}`;
const priceCustomer = {
  enquiryId: 'fictional-price-enquiry', customerName: 'Alex Morgan',
  email: 'fictional.customer.with.a.long.email.address@example.test', phone: '07700 900101',
  preferredContact: 'email', appointmentAt: null, appointmentStatus: null,
};
const missingCustomer = {
  enquiryId: 'fictional-missing-enquiry', customerName: 'Casey Patel', email: 'casey@example.test',
  phone: '07700 900102', preferredContact: 'phone', appointmentAt: '2026-10-20T13:00:00Z', appointmentStatus: 'confirmed',
};
const priceTask: StockChangeTask = {
  id: 'fictional-price-task', kind: 'price_drop', status: 'open', revision: 7,
  createdAt: '2026-10-20T09:30:00Z', updatedAt: now, vehicleId: 'fictional-yaris', vehicleTitle: 'Toyota Yaris',
  registration: 'ZZ20 TST', imageUrl: image, previousPrice: 8995, currentPrice: 8495, reduction: 500,
  missingCount: 0, lastSeenAt: now, publiclyVisible: true, urgency: 'normal',
  affectedCustomers: [priceCustomer, { ...priceCustomer, enquiryId: 'fictional-no-email', customerName: 'Jamie Taylor', email: null }],
  upcomingAppointments: 0, paidReservations: 0,
};
const missingTask: StockChangeTask = {
  ...priceTask, id: 'fictional-missing-task', kind: 'missing_stock', revision: 3,
  vehicleId: 'fictional-civic', vehicleTitle: 'Honda Civic', registration: 'ZZ19 TST',
  createdAt: '2026-10-20T09:00:00Z', previousPrice: null, currentPrice: 9995, reduction: null,
  missingCount: 2, lastSeenAt: '2026-10-19T19:00:00Z', publiclyVisible: false, urgency: 'urgent',
  affectedCustomers: [missingCustomer], upcomingAppointments: 1, paidReservations: 1,
};
const notifications = {
  generatedAt: now, emailAccess: true,
  counts: { enquiries: 0, followups: 0, appointments: 0, drafts: 0, email: 0 }, items: [],
};
const operations = {
  generatedAt: now, unansweredEnquiries: 0, upcomingAppointments: 0, pendingAppointments: 0,
  overdueFollowUps: 0, outstandingBalancePence: 0, salesWithBalance: 0, upcomingDeliveries: 0,
  stockCount: 2, completedSales: 0, totalEnquiries: 0, convertedEnquiries: 0,
  enquiryConversionPercent: 0, completedConversionPercent: 0,
  stock: { lastSuccessfulSync: now, stale: false, alerts: [] }, appointments: [], balances: [], deliveries: [],
};
const enquiry = (customer: typeof priceCustomer, task: StockChangeTask) => ({
  id: customer.enquiryId, dealerId: 'preview', reference: `INTERNAL-${customer.enquiryId}`, type: 'general',
  customerName: customer.customerName, email: customer.email, phone: customer.phone, preferredContact: customer.preferredContact,
  vehicleId: task.vehicleId, vehicleTitle: task.vehicleTitle, vehicleRegistration: task.registration, vehiclePrice: task.currentPrice,
  message: 'Please let me know about this car.', status: 'new', source: 'website', workspaceRevision: 1,
  followUpRevision: 0, appointmentRevision: 0, appointmentAt: customer.appointmentAt,
  appointmentCancelledAt: null, appointmentStatus: customer.appointmentStatus,
  attendance: customer.appointmentAt ? 'scheduled' : null, createdAt: task.createdAt, updatedAt: now, events: [],
});
const enquiries = [enquiry(priceCustomer, priceTask), enquiry(missingCustomer, missingTask)];
const savedContent = {
  to: 'kept-recipient@example.test', subject: 'My carefully prepared subject', message: 'Keep this saved customer wording exactly.',
  includeVehicle: false, includeAppointment: true, photoIds: [], documentIds: [], expectedRevision: 17,
};

async function setup(page: Page, options: {
  tasks?: StockChangeTask[];
  savedDraft?: boolean;
  permissions?: string[];
  taskError?: boolean;
  paused?: boolean;
  conflict?: boolean;
} = {}) {
  const writes: string[] = [], patches: { path: string; body: unknown }[] = [], runtimeErrors: string[] = [];
  let tasks = structuredClone(options.tasks ?? [priceTask, missingTask]);
  let taskError = options.taskError ?? false, taskReads = 0;
  let release: (() => void) | undefined;
  const released = new Promise<void>(resolve => { release = resolve; });
  page.on('pageerror', error => runtimeErrors.push(error.message));
  await page.clock.setFixedTime(new Date(now));
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === '/api/staff/stock-change-tasks' && request.method() === 'GET') {
      taskReads++;
      if (options.paused) await released;
      return taskError ? route.fulfill({ status: 503, json: { error: 'Fictional temporary busy response' } })
        : route.fulfill({ json: { tasks, total: tasks.length, generatedAt: now } });
    }
    if (path.startsWith('/api/staff/stock-change-tasks/')) {
      const id = decodeURIComponent(path.split('/').at(-1)!);
      const task = tasks.find(item => item.id === id);
      if (request.method() === 'PATCH') {
        patches.push({ path, body: request.postDataJSON() });
        if (options.conflict) {
          tasks = tasks.map(item => item.id === id ? { ...item, revision: item.revision + 1, currentPrice: 8295, reduction: 700 } : item);
          return route.fulfill({ status: 409, json: { error: 'This stock change has been updated. Reload and review it again.' } });
        }
        tasks = tasks.filter(item => item.id !== id);
        return route.fulfill({ json: { ...task, status: 'reviewed', revision: (task?.revision ?? 0) + 1 } });
      }
      if (request.method() === 'GET') return route.fulfill({ status: task ? 200 : 404, json: task ?? { error: 'Not found' } });
    }
    // No request may change preview files, send an email, alter a booking,
    // change a sale/deposit/invoice or contact an external provider.
    if (!['GET', 'HEAD'].includes(request.method())) {
      writes.push(`${request.method()} ${path}`);
      return route.abort();
    }
    if (path === '/api/staff/notifications') return route.fulfill({ json: notifications });
    if (path === '/api/dealer-operations') return route.fulfill({ json: operations });
    if (path === '/api/staff/access') return route.fulfill({ json: {
      role: 'owner', permissions: options.permissions ?? ['stock.manage', 'settings.publish', 'sales.manage', 'payments.record'],
      user: { authUserId: 'fictional-staff', name: 'Sam Dealer', email: 'sam@example.test' },
    } });
    if (path === '/api/enquiries') return route.fulfill({ json: enquiries });
    if (path === '/api/staff/email') return route.fulfill({ json: { messages: [], hasMore: false } });
    if (path === '/api/staff/email-drafts') return route.fulfill({ json: { drafts: [], hasMore: false } });
    if (path.endsWith('/email-context')) {
      const customer = path.includes(missingCustomer.enquiryId) ? missingCustomer : priceCustomer;
      const task = customer === missingCustomer ? missingTask : priceTask;
      return route.fulfill({ json: {
        version: options.savedDraft ? 4 : 0,
        savedDraft: options.savedDraft ? { version: 4, status: 'draft', content: savedContent, updatedAt: now } : null,
        email: customer.email, customerName: customer.customerName, vehicleId: task.vehicleId,
        vehicleTitle: task.vehicleTitle, reference: 'INTERNAL-DO-NOT-SHOW', revision: 17,
        vehicleAvailable: task.publiclyVisible, appointmentAvailable: true,
        defaults: { subject: 'Generic subject', message: 'Generic message' }, ready: true,
        templates: [], invoices: [], photos: [], deliveries: [],
      } });
    }
    return route.continue();
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  return {
    writes, patches, runtimeErrors, release: () => release!(), recover: () => { taskError = false; }, taskReads: () => taskReads,
    changeTask: (id: string, fields: Partial<StockChangeTask>) => { tasks = tasks.map(task => task.id === id ? { ...task, ...fields } : task); },
  };
}

async function noOverflow(page: Page, width: number) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
}

for (const width of [320, 390, 820, 1440]) test(`stock tasks and reviewed price email remain usable at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const state = await setup(page);
  await page.goto('/portal?section=notifications');
  const section = page.getByRole('region', { name: 'Stock changes', exact: true });
  await expect(section).toBeVisible();
  await expect(page.getByText('You’re up to date', { exact: true })).toHaveCount(0);
  const filter = page.getByRole('button', { name: /^Stock changes 2$/ });
  await filter.click();
  await expect(filter).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: 'Customers to contact', exact: true })).toHaveCount(0);
  await expect(section.locator('.stock-change-list > li').first()).toHaveAttribute('data-testid', 'stock-change-fictional-missing-task');
  const price = page.getByTestId('stock-change-fictional-price-task');
  await expect(price).toContainText('£8,995');
  await expect(price).toContainText('£8,495');
  await expect(price).toContainText('Reduced by £500');
  const missing = page.getByTestId('stock-change-fictional-missing-task');
  await expect(missing).toContainText('This does not confirm it is sold.');
  await expect(missing).toContainText('1 booked visit');
  await expect(missing).toContainText('1 paid reservation');
  await expect(missing).toContainText('Hidden from public stock');
  await missing.getByRole('button', { name: 'Review affected customers', exact: true }).click();
  await expect(missing).toContainText('Casey Patel');
  await expect(missing).toContainText('confirmed');
  await price.getByRole('button', { name: 'Review interested customers', exact: true }).click();
  await expect(price.getByRole('list', { name: 'Customers affected by Toyota Yaris', exact: true }).getByRole('listitem')).toHaveCount(2);
  await expect(price).toContainText('No email address');
  await expect(price.getByRole('link', { name: 'Prepare email draft', exact: true })).toHaveCount(1);
  await expect(price).not.toContainText('INTERNAL-');
  await noOverflow(page, width);
  if (width <= 820) {
    for (const control of await section.locator('.stock-change-actions > button,.stock-change-actions > a,.stock-change-customer-actions > a').all()) {
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
  }
  await section.screenshot({ path: `../../output/stock-change-tasks/tasks-${width}.png`, animations: 'disabled' });
  await price.getByRole('link', { name: 'Prepare email draft', exact: true }).click();
  await expect(page).toHaveURL(/compose=fictional-price-enquiry&stockChangeId=fictional-price-task/);
  const composer = page.getByRole('dialog', { name: 'Prepare customer email', exact: true });
  await expect(composer).toBeVisible();
  const message = composer.getByRole('textbox', { name: 'Message', exact: true });
  await expect(message).toHaveValue(/£8,495/);
  await expect(message).toHaveValue(/£8,995/);
  await expect(message).not.toHaveValue(/guaranteed|your deposit|agreed price/i);
  await expect(composer.getByRole('checkbox', { name: 'Appointment details', exact: true })).not.toBeChecked();
  await noOverflow(page, width);
  await composer.screenshot({ path: `../../output/stock-change-tasks/price-draft-${width}.png`, animations: 'disabled' });
  expect(state.writes).toEqual([]);
  expect(state.patches).toEqual([]);
  expect(state.runtimeErrors).toEqual([]);
});

test('missing-stock draft does not call the car sold or cancel the existing appointment', async ({ page }) => {
  const state = await setup(page);
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.goto('/portal?section=notifications&workView=email&compose=fictional-missing-enquiry&stockChangeId=fictional-missing-task');
  const composer = page.getByRole('dialog', { name: 'Prepare customer email', exact: true });
  const message = composer.getByRole('textbox', { name: 'Message', exact: true });
  await expect(message).toHaveValue(/availability|checking/i);
  await expect(message).not.toHaveValue(/\bsold\b|cancelled|canceled|refund/i);
  await expect(composer.getByRole('checkbox', { name: 'Appointment details', exact: true })).not.toBeChecked();
  await composer.screenshot({ path: '../../output/stock-change-tasks/missing-draft-390.png', animations: 'disabled' });
  await noOverflow(page, 390);
  expect(state.writes).toEqual([]);
  expect(state.runtimeErrors).toEqual([]);
});

test('a saved email draft remains unchanged until staff explicitly choose stock-change wording', async ({ page }) => {
  const state = await setup(page, { savedDraft: true });
  await page.goto('/portal?section=notifications&workView=email&compose=fictional-price-enquiry&stockChangeId=fictional-price-task');
  const composer = page.getByRole('dialog', { name: 'Prepare customer email', exact: true });
  await expect(composer.getByRole('textbox', { name: 'Subject', exact: true })).toHaveValue(savedContent.subject);
  const message = composer.getByRole('textbox', { name: 'Message', exact: true });
  await expect(message).toHaveValue(savedContent.message);
  await expect(composer.getByRole('textbox', { name: 'Customer email', exact: true })).toHaveValue(savedContent.to);
  await expect(composer.getByRole('checkbox', { name: 'Appointment details', exact: true })).toBeChecked();
  await composer.getByRole('button', { name: /Use .*wording/ }).click();
  await expect(message).toHaveValue(/£8,495/);
  await expect(composer.getByRole('textbox', { name: 'Customer email', exact: true })).toHaveValue(savedContent.to);
  await expect(composer.getByRole('checkbox', { name: 'Appointment details', exact: true })).not.toBeChecked();
  expect(state.writes).toEqual([]);
  expect(state.runtimeErrors).toEqual([]);
});

test('review rechecks current stock and keeps the draft when the price changes again', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/portal?section=notifications&workView=email&compose=fictional-price-enquiry&stockChangeId=fictional-price-task');
  const composer = page.getByRole('dialog', { name: 'Prepare customer email', exact: true });
  const message = composer.getByRole('textbox', { name: 'Message', exact: true });
  await expect(message).toHaveValue(/£8,495/);
  state.changeTask(priceTask.id, { revision: priceTask.revision + 1, currentPrice: 7995, reduction: 1000 });
  await composer.getByRole('button', { name: 'Review email', exact: true }).click();
  await expect(composer.getByRole('alert').filter({ hasText: /stock update has changed/ })).toBeVisible();
  await expect(message).toHaveValue(/£8,495/);
  await expect(message).not.toHaveValue(/£7,995/);
  await expect(page.getByRole('dialog', { name: 'Review customer email', exact: true })).toHaveCount(0);
  expect(state.writes).toEqual([]);
  expect(state.runtimeErrors).toEqual([]);
});

for (const scenario of ['resolved', 'different customer'] as const) test(`a ${scenario} stock update cannot prepare an unrelated email`, async ({ page }) => {
  const state = await setup(page, { tasks: [{ ...priceTask, ...(scenario === 'resolved' ? { status: 'resolved' as const } : {}) }] });
  const customerId = scenario === 'resolved' ? priceCustomer.enquiryId : missingCustomer.enquiryId;
  await page.goto(`/portal?section=notifications&workView=email&compose=${customerId}&stockChangeId=fictional-price-task`);
  const dialog = page.getByRole('dialog', { name: 'Prepare stock update', exact: true });
  await expect(dialog.getByRole('alert')).toContainText(scenario === 'resolved' ? 'This stock update has changed' : 'This customer is no longer eligible');
  await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toHaveCount(0);
  expect(state.writes).toEqual([]);
  expect(state.runtimeErrors).toEqual([]);
});

test('mark reviewed acknowledges only the displayed task revision', async ({ page }) => {
  const state = await setup(page);
  await page.goto('/portal?section=notifications');
  await page.getByTestId('stock-change-fictional-price-task').getByRole('button', { name: 'Mark reviewed', exact: true }).click();
  await expect(page.getByTestId('stock-change-fictional-price-task')).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Toyota Yaris marked reviewed' })).toContainText('Stock and customer commitments are unchanged.');
  expect(state.patches).toEqual([{ path: '/api/staff/stock-change-tasks/fictional-price-task', body: { expectedRevision: 7, action: 'reviewed' } }]);
  expect(state.writes).toEqual([]);
  expect(state.runtimeErrors).toEqual([]);
});

test('a stale task acknowledgement reloads the latest details without retrying its PATCH', async ({ page }) => {
  const state = await setup(page, { conflict: true });
  await page.goto('/portal?section=notifications');
  const price = page.getByTestId('stock-change-fictional-price-task');
  await price.getByRole('button', { name: 'Mark reviewed', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'This stock change has been updated' })).toBeVisible();
  await expect(price).toContainText('£8,295');
  await expect.poll(state.taskReads).toBeGreaterThanOrEqual(2);
  expect(state.patches).toHaveLength(1);
  expect(state.patches[0].body).toEqual({ expectedRevision: 7, action: 'reviewed' });
  expect(state.writes).toEqual([]);
});

test('staff without stock management cannot acknowledge tasks', async ({ page }) => {
  const state = await setup(page, { permissions: [] });
  await page.goto('/portal?section=notifications');
  const section = page.getByRole('region', { name: 'Stock changes', exact: true });
  await expect(section).toBeVisible();
  await expect(section.getByRole('button', { name: 'Mark reviewed', exact: true })).toHaveCount(0);
  expect(state.writes).toEqual([]);
  expect(state.patches).toEqual([]);
});

test('loading stock changes does not incorrectly claim all work is complete', async ({ page }) => {
  const state = await setup(page, { paused: true });
  await page.goto('/portal?section=notifications');
  await expect(page.getByText('Checking stock changes…', { exact: true })).toBeVisible();
  await expect(page.getByText('You’re up to date', { exact: true })).toHaveCount(0);
  state.release();
  await expect(page.getByTestId('stock-change-fictional-price-task')).toBeVisible();
  expect(state.writes).toEqual([]);
});

test('empty stock changes keep Home clear', async ({ page }) => {
  const state = await setup(page, { tasks: [] });
  await page.goto('/portal?section=notifications');
  await expect(page.getByRole('button', { name: /^Stock changes 0$/ })).toHaveCount(0);
  await expect(page.getByText('You’re up to date', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Stock changes', exact: true })).toHaveCount(0);
  expect(state.writes).toEqual([]);
});

test('stock-change loading failure stays separate from normal Home and can recover', async ({ page }) => {
  const state = await setup(page, { taskError: true });
  await page.goto('/portal?section=notifications');
  await expect(page.getByRole('alert').filter({ hasText: 'Stock changes could not be refreshed' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Customers to contact', exact: true })).toBeVisible();
  await expect(page.getByText('You’re up to date', { exact: true })).toHaveCount(0);
  state.recover();
  await page.getByRole('button', { name: 'Retry stock changes', exact: true }).click();
  await expect(page.getByTestId('stock-change-fictional-price-task')).toBeVisible();
  expect(state.writes).toEqual([]);
});
