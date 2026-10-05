import { expect, test, type Page } from '@playwright/test';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Mocked local preview only.');
const now = '2026-10-05T10:00:00Z';
const car = { id: 'callback-car', title: 'Ford Focus', make: 'Ford', model: 'Focus', year: 2019, price: 10995, transmission: 'Manual', plate: 'AB19 XYZ', inventoryStatus: 'available', images: [], heroImage: null, mileage: 42000, fuel: 'Petrol' };
const base = { dealerId: 'preview', vehicleId: car.id, vehicleTitle: car.title, vehicleRegistration: car.plate, vehiclePrice: car.price, customerName: 'Website Caller', phone: '07700 900123', email: 'caller@example.test', preferredContact: 'phone', source: 'website_callback', status: 'new', type: 'general', message: 'Please call about the service history.', assignedToId: null, assignedToName: null, callOutcome: 'callback_requested', workspaceRevision: 7, followUpRevision: 2, appointmentRevision: 0, followUpCompletedAt: null, appointmentAt: null, appointmentCancelledAt: null, staffNote: 'Existing internal note', createdAt: '2026-10-05T07:30:00Z', updatedAt: now, events: [{ id: 'earlier-call', kind: 'conversation_logged', actor: 'dealer', summary: 'Earlier conversation', note: 'Earlier note is retained.', staffId: 'colleague', staffName: 'Alex Dealer', callOutcome: 'no_answer', occurredAt: '2026-10-04T12:00:00Z', vehicleId: car.id, vehicleTitle: car.title, vehicleUrl: null }] };
function initialEntries() {
  return [
    { ...base, id: 'overdue', reference: 'CALL-OVERDUE', followUpAt: '2026-10-05T08:00:00Z' },
    { ...base, id: 'upcoming', reference: 'CALL-UPCOMING', customerName: 'Afternoon Caller', source: 'phone', assignedToId: 'staff-me', assignedToName: 'Sam Dealer', followUpAt: '2026-10-05T13:00:00Z' },
    { ...base, id: 'unscheduled', reference: 'CALL-NOTIME', customerName: 'Opening Hours Caller', followUpAt: null, events: [] },
    { ...base, id: 'completed', reference: 'CALL-DONE', customerName: 'Finished Caller', followUpAt: '2026-10-04T08:00:00Z', followUpCompletedAt: '2026-10-04T09:00:00Z' },
    ...Array.from({ length: 24 }, (_, index) => ({ ...base, id: `history-${index}`, reference: `HISTORY-${index}`, customerName: `History Customer ${index}`, source: 'phone', callOutcome: 'information_given', followUpAt: null, assignedToId: 'colleague', assignedToName: 'Alex Dealer', events: [] })),
  ];
}
async function setup(page: Page) {
  const records = { entries: initialEntries() };
  await page.clock.setFixedTime(new Date(now));
  // Every write is blocked unless a test explicitly replaces it with a mock response.
  await page.route('**/api/**', route => ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort());
  await page.route('**/api/stock', route => route.fulfill({ json: { schemaVersion: 1, count: 1, cars: [car] } }));
  await page.route('**/api/enquiries', route => route.fulfill({ json: records.entries }));
  await page.route('**/api/staff/directory', route => route.fulfill({ json: { currentUserId: 'staff-me', members: [{ id: 'staff-me', name: 'Sam Dealer' }, { id: 'colleague', name: 'Alex Dealer' }] } }));
  await page.goto('/portal');
  await page.getByTestId('tab-enquiries').click();
  return records;
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
  test(`callbacks show correct timing and retain unassigned work at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await setup(page);
    await page.getByRole('tab', { name: 'Callbacks (3)', exact: true }).click();
    await expect(page.getByLabel('Search the workspace', { exact: true })).toHaveCount(0);
    await expect(page.locator('.enquiry-workspace-ribbon input')).toHaveCount(1);
    await expect(page.locator('#desk-panel-callbacks input')).toHaveCount(0);
    await page.getByLabel('Find a callback', { exact: true }).fill('Afternoon');
    await expect(page.getByTestId('enquiry-upcoming')).toBeVisible();
    await expect(page.getByTestId('enquiry-overdue')).toHaveCount(0);
    await page.getByLabel('Find a callback', { exact: true }).fill('');
    await expect(page.getByText('1 overdue now', { exact: true })).toBeVisible();
    await expect(page.getByText('1 upcoming', { exact: true })).toBeVisible();
    await expect(page.getByText('1 need a time', { exact: true })).toBeVisible();
    await expect(page.getByTestId('enquiry-completed')).toHaveCount(0);
    await page.getByLabel('Show callbacks').selectOption('overdue');
    await expect(page.getByTestId('enquiry-overdue')).toBeVisible();
    await expect(page.getByTestId('enquiry-upcoming')).toHaveCount(0);
    await page.getByLabel('Show callbacks').selectOption('all');
    await page.getByLabel('Enquiry ownership').selectOption('mine');
    await expect(page.getByText('My queue includes unassigned requests so they can be claimed.')).toBeVisible();
    await expect(page.getByTestId('enquiry-unscheduled')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Overdue now (1)', exact: true })).toBeVisible();
    await page.getByLabel('Find a callback', { exact: true }).fill('Afternoon');
    await page.getByRole('button', { name: 'Overdue now (1)', exact: true }).click();
    await expect(page.getByLabel('Find a callback', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Show callbacks')).toHaveValue('overdue');
    await expect(page.getByTestId('enquiry-unscheduled')).toHaveCount(0);
    await page.getByLabel('Show callbacks').selectOption('all');
    await page.getByRole('button', { name: 'Open enquiry for Website Caller, CALL-OVERDUE' }).click();
    const selected = page.getByRole('region', { name: 'Selected enquiry: Website Caller' });
    await expect(selected).toBeVisible();
    await expect(selected.getByRole('button', { name: 'Assign to me' })).toBeVisible();
    await expect(selected.getByRole('button', { name: 'Log another conversation' })).toBeVisible();
    await expect(selected.getByRole('link', { name: 'Vehicle history', exact: true })).toBeVisible();
    if (viewport.width < 900) {
      await expect(page.getByTestId('enquiry-overdue')).toBeHidden();
      await selected.getByRole('button', { name: 'Back to callbacks' }).click();
      await expect(page.getByTestId('enquiry-overdue')).toBeVisible();
      await expect(selected).toBeHidden();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    if (viewport.width < 900) await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); });
    await page.screenshot({ path: `/tmp/luxxy-callback-queue-${viewport.width}.png` });
  });

  test(`history preserves actions with a compact selected record at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await setup(page);
    await page.getByRole('tab', { name: 'Find enquiry or appointment', exact: true }).click();
    await expect(page.getByLabel('Search the workspace', { exact: true })).toHaveCount(0);
    await expect(page.locator('.enquiry-workspace-ribbon input')).toHaveCount(1);
    await expect(page.locator('#desk-panel-history input')).toHaveCount(0);
    if (viewport.width < 900) await expect(page.getByRole('button', { name: 'Log another conversation' })).toBeHidden();
    await page.getByRole('button', { name: 'Open enquiry for Website Caller, CALL-OVERDUE' }).click();
    const selected = page.getByRole('region', { name: 'Selected enquiry: Website Caller' });
    await expect(selected.getByRole('button', { name: 'Manage follow-up' })).toBeVisible();
    await expect(selected.getByRole('button', { name: 'Update enquiry' })).toBeVisible();
    await expect(selected.getByRole('button', { name: 'Book test drive', exact: true })).toBeVisible();
    await expect(selected.getByRole('link', { name: 'Start sale' })).toHaveAttribute('href', '/portal?section=sales&enquiryId=overdue');
    await expect(selected.getByText('Earlier note is retained.')).toBeVisible();
    if (viewport.width >= 1024) {
      const bounds = await page.locator('.enquiry-record-browser').evaluate(element => {
        const list = element.querySelector('.enquiry-record-list-pane') as HTMLElement;
        const detail = element.querySelector('.enquiry-record-detail-pane') as HTMLElement;
        return { listOverflow: getComputedStyle(list).overflowY, detailOverflow: getComputedStyle(detail).overflowY, listScrolls: list.scrollHeight > list.clientHeight, bottom: element.getBoundingClientRect().bottom };
      });
      expect(bounds.listOverflow).toBe('auto');
      expect(bounds.detailOverflow).toBe('auto');
      expect(bounds.listScrolls).toBe(true);
      expect(bounds.bottom).toBeLessThanOrEqual(viewport.height);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    if (viewport.width < 900) {
      await selected.evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }));
      await page.screenshot({ path: `/tmp/luxxy-enquiry-history-${viewport.width}-detail.png` });
      await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); });
    }
    await page.screenshot({ path: `/tmp/luxxy-enquiry-history-${viewport.width}.png` });
  });
}

test('a dated conversation appends its author, outcome and next follow-up while preserving earlier notes', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  const records = await setup(page);
  let payload: unknown;
  await page.route('**/api/staff/enquiries/overdue/conversations', route => {
    const body = route.request().postDataJSON(); payload = body;
    records.entries = records.entries.map(entry => entry.id === 'overdue' ? { ...entry, callOutcome: body.callOutcome, followUpAt: body.followUpAt, followUpNote: body.followUpNote, workspaceRevision: 8, followUpRevision: 3, events: [...entry.events, { ...entry.events[0], id: 'new-call', note: body.note, summary: 'Conversation logged', staffId: 'staff-me', staffName: 'Sam Dealer', callOutcome: body.callOutcome, followUpAt: body.followUpAt, occurredAt: now }] } : entry);
    return route.fulfill({ json: records.entries.find(entry => entry.id === 'overdue') });
  });
  await page.getByRole('tab', { name: 'Callbacks (3)', exact: true }).click();
  await page.getByRole('button', { name: 'Open enquiry for Website Caller, CALL-OVERDUE' }).click();
  await page.getByRole('button', { name: 'Log another conversation' }).click();
  await page.getByLabel('Conversation note').fill('Discussed the service history; call after lunch tomorrow.');
  await page.getByLabel('Conversation outcome').selectOption('callback_requested');
  await page.getByLabel('Schedule the next follow-up').check();
  await page.getByLabel('Follow-up date and time (UK)').fill('2026-10-06T14:30');
  await page.getByLabel('Follow-up note (optional)').fill('Confirm the service documents.');
  await page.getByRole('button', { name: 'Save conversation' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(payload).toEqual({ expectedRevision: 7, expectedFollowUpRevision: 2, note: 'Discussed the service history; call after lunch tomorrow.', callOutcome: 'callback_requested', followUpAt: '2026-10-06T13:30:00.000Z', followUpNote: 'Confirm the service documents.' });
  const selected = page.getByRole('region', { name: 'Selected enquiry: Website Caller' });
  await expect(selected.getByTestId('conversation-new-call')).toContainText('Sam Dealer');
  await expect(selected.getByTestId('conversation-new-call')).toContainText('Discussed the service history');
  await expect(selected.getByTestId('conversation-earlier-call')).toContainText('Earlier note is retained.');
  await expect(selected.getByText('Existing internal note')).toBeVisible();
});

test('claim uses current staff identity and a failed conversation leaves the typed note intact', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const records = await setup(page);
  let claim: unknown;
  await page.route('**/api/staff/enquiries/overdue/workspace', route => {
    claim = route.request().postDataJSON();
    records.entries = records.entries.map(entry => entry.id === 'overdue' ? { ...entry, assignedToId: 'staff-me', assignedToName: 'Sam Dealer', workspaceRevision: 8 } : entry);
    return route.fulfill({ json: records.entries.find(entry => entry.id === 'overdue') });
  });
  await page.route('**/api/staff/enquiries/overdue/conversations', route => route.fulfill({ status: 409, json: { error: 'This enquiry has changed. Refresh before saving.' } }));
  await page.getByRole('tab', { name: 'Callbacks (3)', exact: true }).click();
  await page.getByRole('button', { name: 'Open enquiry for Website Caller, CALL-OVERDUE' }).click();
  await page.getByRole('button', { name: 'Assign to me' }).click();
  await expect.poll(() => claim).toEqual({ expectedRevision: 7, assignedToId: 'staff-me' });
  await expect(page.getByRole('button', { name: 'Assign to me' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Log another conversation' }).click();
  await page.getByLabel('Conversation note').fill('Keep this note after a conflicting update.');
  await page.getByRole('button', { name: 'Save conversation' }).click();
  await expect(page.getByRole('alert')).toContainText('This enquiry has changed.');
  await expect(page.getByLabel('Conversation note')).toHaveValue('Keep this note after a conflicting update.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});


test('a completed call save opens its record even if workspace search changed while saving', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  const records = await setup(page);
  let releaseResponse!: () => void;
  let started = false;
  const pendingResponse = new Promise<void>(resolve => { releaseResponse = resolve; });
  await page.route('**/api/staff/enquiries', async route => {
    started = true;
    await pendingResponse;
    const saved = { ...base, id: 'saved-call', reference: 'CALL-SAVED', customerName: 'New Caller', source: 'phone', callOutcome: 'information_given', followUpAt: null, events: [] };
    records.entries.push(saved);
    await route.fulfill({ status: 201, json: saved });
  });
  await page.getByLabel('Vehicle source', { exact: true }).selectOption('none');
  await page.getByLabel('Customer name', { exact: true }).fill('New Caller');
  await page.getByLabel('Phone number', { exact: true }).fill('07700 900456');
  await page.getByRole('button', { name: 'Save phone enquiry', exact: true }).click();
  await expect.poll(() => started).toBe(true);
  await page.getByLabel('Search the workspace', { exact: true }).fill('CALL-UPCOMING');
  await expect(page.getByRole('button', { name: 'Clear workspace search' })).toBeVisible();
  releaseResponse();
  await expect(page.getByRole('region', { name: 'Selected enquiry: New Caller' })).toBeVisible();
  await expect(page.getByLabel('Find a customer or car', { exact: true })).toHaveValue('CALL-SAVED');
  await expect(page.getByRole('button', { name: 'Clear workspace search' })).toHaveCount(0);
  await expect(page.getByLabel('Search the workspace', { exact: true })).toHaveCount(0);
});
