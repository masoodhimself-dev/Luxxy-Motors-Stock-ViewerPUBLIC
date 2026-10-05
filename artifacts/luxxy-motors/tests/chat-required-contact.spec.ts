import { expect, test, type Locator, type Page } from '@playwright/test';
import { defaultChatSettings, type ChatConversationView, type ChatSession } from '@workspace/vehicle-meta';
import { dealerConfig } from '../src/config/dealer';
import stockSnapshot from '../preview/grok-stock-10045264.json' with { type: 'json' };

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Synthetic local preview only; all API writes are intercepted.');

const dealerName = 'Example Motors';
const id = 'synthetic-required-contact-chat';
const vehicleId = 'synthetic-required-contact-car';
const enquiryId = 'synthetic-required-contact-enquiry';
const savedToken = 'synthetic-required-contact-session-token';
const now = new Date().toISOString();
const car = { ...stockSnapshot.cars[0], id: vehicleId, heroImage: null, images: [], imageCount: 0 };
const settings = {
  ...dealerConfig,
  identity: { ...dealerConfig.identity, name: dealerName, logoText: 'EXAMPLE MOTORS', logoAsset: '' },
  contact: { phone: '07700 900101', email: 'showroom@example.test', whatsapp: '' },
  address: { street: '1 Example Road', city: 'Example Town', region: '', postcode: '', mapsUrl: '' },
  recentHandovers: { enabled: false, count: 0 },
  reviews: { data: [] },
};
const availability = { staffOnline: false, showroomState: 'open' as const, nextOpening: null };
const greeting = 'Welcome. How can we help with your next car?';
const legacyQuestion = 'Could I see the service history before visiting?';

function fixture(identified = false): ChatConversationView {
  return {
    conversation: {
      id, reference: 'TEST-CHAT-101',
      vehicle: { id: vehicleId, title: car.title, registration: car.plate, price: car.price, imageUrl: null, url: `/vehicle/${vehicleId}` },
      enquiryId: identified ? enquiryId : null,
      customerName: identified ? 'Alex Morgan' : null, email: null, phone: identified ? '07700 900101' : null,
      status: 'assistant', assignedToId: null, assignedToName: null, callbackRequested: false,
      unreadCount: 0, lastMessage: greeting, createdAt: now, updatedAt: now, revision: 1,
    },
    messages: [{ id: 'synthetic-greeting', conversationId: id, authorRole: 'assistant', authorName: 'Showroom assistant', body: greeting, createdAt: now, actions: [], clientMessageId: null }],
    availability,
  };
}

type Write = { path: string; method: string; body: Record<string, unknown>; token: string | undefined };

/** Every request is fulfilled locally, including a catch-all block for unexpected mutations. */
async function interceptedChat(page: Page, options: { saved?: 'identified' | 'anonymous' } = {}) {
  const state = {
    view: fixture(options.saved === 'identified'),
    writes: [] as Write[], blockedWrites: [] as string[], errors: [] as string[],
    reads: new Map<string, number>(), createAttempts: 0, created: false,
    createResponses: [] as ('lost' | 'unavailable')[],
    holdCreate: null as Promise<void> | null,
    createKey: null as string | null,
    token: options.saved ? savedToken : '',
  };
  if (options.saved) {
    state.view.messages.push({ id: 'synthetic-legacy-question', conversationId: id, authorRole: 'customer', authorName: 'You', body: legacyQuestion, createdAt: now, actions: [], clientMessageId: 'legacy-question-1' });
    state.view.conversation.lastMessage = legacyQuestion;
    await page.addInitScript(({ dealer, conversationId, token, updatedAt, title }) => {
      const key = `dealer.chat.v1:${encodeURIComponent(location.origin)}:${encodeURIComponent(dealer)}`;
      localStorage.setItem(key, JSON.stringify([{ id: conversationId, token, title, updatedAt }]));
    }, { dealer: dealerName, conversationId: id, token: savedToken, updatedAt: now, title: car.title });
  }
  page.on('pageerror', error => state.errors.push(error.message));
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const isRead = ['GET', 'HEAD', 'OPTIONS'].includes(method);
    const json = (value: unknown, status = 200) => route.fulfill({ status, json: value });
    if (isRead) {
      state.reads.set(path, (state.reads.get(path) || 0) + 1);
      if (path === '/api/dealer-settings') return json(settings);
      if (path === '/api/stock') return json({ schemaVersion: 1, dealerName, dealerLocation: 'Example Town', scrapedAt: now, count: 1, cars: [car] });
      if (path === '/api/recent-handovers') return json({ schemaVersion: 1, handovers: [] });
      if (path === '/api/chat/config') return json({ settings: { ...defaultChatSettings, greeting }, availability, dealerName });
      if (path === `/api/chat/conversations/${id}`) return json(state.view);
      return json({ error: 'No synthetic read fixture for this endpoint.' }, 404);
    }
    const body = (request.postDataJSON() || {}) as Record<string, unknown>;
    const mutation = { path, method, body, token: request.headers()['x-chat-token'] };
    if (method === 'POST' && path === '/api/chat/conversations') {
      state.writes.push(mutation);
      state.createAttempts += 1;
      const response = state.createResponses.shift();
      if (state.holdCreate) await state.holdCreate;
      if (response === 'unavailable') return json({ error: 'Chat temporarily unavailable.' }, 503);
      const key = `${body.requestId}:${mutation.token}`;
      if (!state.created) {
        state.created = true;
        state.createKey = key;
        state.token = mutation.token || '';
        state.view.conversation = { ...state.view.conversation, customerName: String(body.name), phone: body.phone ? String(body.phone) : null, email: body.email ? String(body.email) : null, enquiryId, vehicle: body.vehicleId ? state.view.conversation.vehicle : null, revision: 2 };
      } else if (state.createKey !== key) {
        return json({ error: 'A retry must reuse the same request and session.' }, 409);
      }
      if (response === 'lost') return route.abort('failed');
      return json({ ...state.view, sessionToken: state.token } satisfies ChatSession);
    }
    if (method === 'POST' && path === `/api/chat/conversations/${id}/contact`) {
      state.writes.push(mutation);
      state.view.conversation = { ...state.view.conversation, customerName: String(body.name), phone: body.phone ? String(body.phone) : null, email: body.email ? String(body.email) : null, callbackRequested: Boolean(body.callbackRequested), enquiryId, revision: state.view.conversation.revision + 1 };
      return json(state.view);
    }
    if (method === 'POST' && path === `/api/chat/conversations/${id}/messages`) {
      state.writes.push(mutation);
      if (!state.view.messages.some(message => message.clientMessageId === body.clientMessageId)) {
        state.view.messages.push({ id: `synthetic-question-${state.view.messages.length}`, conversationId: id, authorRole: 'customer', authorName: 'You', body: String(body.body), createdAt: now, actions: [], clientMessageId: String(body.clientMessageId) });
        state.view.messages.push({ id: `synthetic-answer-${state.view.messages.length}`, conversationId: id, authorRole: 'assistant', authorName: 'Showroom assistant', body: 'The advertised mileage is 74,200 miles.', createdAt: now, actions: [], clientMessageId: null });
        state.view.conversation = { ...state.view.conversation, lastMessage: 'The advertised mileage is 74,200 miles.', revision: state.view.conversation.revision + 1 };
      }
      return json(state.view);
    }
    state.blockedWrites.push(`${method} ${path}`);
    return json({ error: 'Unexpected API write blocked by required-contact browser tests.' }, 403);
  });
  return state;
}

async function openChat(page: Page, path = '/stock') {
  await page.goto(path);
  await page.locator('.customer-chat__launcher').click();
  const dialog = page.getByRole('dialog', { name: `${dealerName} chat` });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function gateIsLocked(dialog: Locator, action = 'Start chat') {
  await expect(dialog.getByLabel('Name', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: action, exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Your question', { exact: true })).toBeHidden();
  await expect(dialog.getByRole('log', { name: 'Chat messages' })).toBeHidden();
  await expect(dialog.locator('.customer-chat__suggestions')).toBeHidden();
  await expect(dialog.getByRole('button', { name: 'Close contact form' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: /skip/i })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Close chat', exact: true })).toBeVisible();
}

async function fits(page: Page, dialog: Locator) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect.poll(() => dialog.evaluate(element => {
    const box = element.getBoundingClientRect();
    return box.left >= 0 && box.top >= 0 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1 && element.scrollWidth <= element.clientWidth + 1;
  })).toBe(true);
}

async function contactDetails(dialog: Locator, method: 'phone' | 'email' = 'phone') {
  await dialog.getByLabel('Name', { exact: true }).fill('  Alex Morgan  ');
  await dialog.getByLabel('Reply by').selectOption(method);
  await dialog.getByLabel(method === 'phone' ? 'Phone number' : 'Email address', { exact: true }).fill(method === 'phone' ? '07700 900101' : 'alex@customer.example.test');
}

async function safeFinish(state: Awaited<ReturnType<typeof interceptedChat>>) {
  expect(state.blockedWrites).toEqual([]);
  expect(state.errors).toEqual([]);
}

for (const width of [390, 820, 1440]) {
  test(`requires valid name and phone before a vehicle chat at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1050 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const state = await interceptedChat(page);
    const dialog = await openChat(page, `/vehicle/${vehicleId}`);
    await gateIsLocked(dialog);
    await expect(dialog.getByLabel('Reply by')).toHaveValue('phone');
    await expect(dialog.getByLabel('Phone number', { exact: true })).toHaveAttribute('type', 'tel');
    expect(state.writes).toEqual([]);

    const start = dialog.getByRole('button', { name: 'Start chat', exact: true });
    await dialog.getByLabel('Name', { exact: true }).fill('   ');
    await dialog.getByLabel('Phone number', { exact: true }).fill('07700 900101');
    await start.click();
    await gateIsLocked(dialog);
    expect(state.writes).toEqual([]);
    await dialog.getByLabel('Name', { exact: true }).fill('Alex Morgan');
    await dialog.getByLabel('Phone number', { exact: true }).fill('not a phone number');
    await start.click();
    await gateIsLocked(dialog);
    expect(state.writes).toEqual([]);

    await contactDetails(dialog);
    await fits(page, dialog);
    await page.screenshot({ path: `/tmp/luxxy-chat-contact-${width}.png`, animations: 'disabled' });
    await start.click();
    await expect(dialog.getByLabel('Your question', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('log', { name: 'Chat messages' })).toContainText(greeting);
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0].path).toBe('/api/chat/conversations');
    expect(state.writes[0].body).toEqual({ requestId: expect.any(String), vehicleId, name: 'Alex Morgan', phone: '07700900101' });
    expect(state.writes[0].token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(state.view.conversation.enquiryId).toBe(enquiryId);
    expect(state.view.conversation.vehicle?.id).toBe(vehicleId);

    await dialog.getByRole('button', { name: 'What’s the mileage?', exact: true }).click();
    await dialog.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(dialog.getByRole('log', { name: 'Chat messages' })).toContainText('The advertised mileage is 74,200 miles.');
    expect(state.writes.filter(write => write.path.endsWith('/messages'))).toHaveLength(1);
    expect(state.writes[1].token).toBe(state.writes[0].token);
    await fits(page, dialog);
    await safeFinish(state);
  });
}

test('offers email instead of phone and keeps contact updates available after starting', async ({ page }) => {
  const state = await interceptedChat(page);
  const dialog = await openChat(page);
  await dialog.getByLabel('Reply by').selectOption('email');
  await expect(dialog.getByLabel('Phone number', { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel('Email address', { exact: true })).toHaveAttribute('type', 'email');
  await dialog.getByLabel('Name', { exact: true }).fill('Alex Morgan');
  await dialog.getByLabel('Email address', { exact: true }).fill('invalid-email');
  await dialog.getByRole('button', { name: 'Start chat', exact: true }).click();
  expect(state.writes).toEqual([]);
  await contactDetails(dialog, 'email');
  await dialog.getByRole('button', { name: 'Start chat', exact: true }).click();
  await expect(dialog.getByLabel('Your question', { exact: true })).toBeVisible();
  expect(state.writes[0].body).toEqual({ requestId: expect.any(String), name: 'Alex Morgan', email: 'alex@customer.example.test' });
  await dialog.getByLabel('Your question', { exact: true }).fill('A question still being drafted.');
  await dialog.getByRole('button', { name: 'Contact details', exact: true }).click();
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Alex Morgan');
  await expect(dialog.getByLabel('Email address', { exact: true })).toHaveValue('alex@customer.example.test');
  await expect(dialog.getByRole('button', { name: 'Close contact form' })).toBeVisible();
  await dialog.getByLabel('Name', { exact: true }).fill('Alex Updated');
  await dialog.getByRole('button', { name: 'Save contact details', exact: true }).click();
  await expect(dialog.getByLabel('Your question', { exact: true })).toHaveValue('A question still being drafted.');
  await expect(dialog.getByRole('log', { name: 'Chat messages' })).toContainText(greeting);
  expect(state.writes[1].path).toBe(`/api/chat/conversations/${id}/contact`);
  expect(state.writes[1].body).toMatchObject({ name: 'Alex Updated', email: 'alex@customer.example.test' });
  expect(state.writes[1].body).not.toHaveProperty('phone');
  await safeFinish(state);
});

test('blocks duplicate starts and reuses the request and token after a lost response', async ({ page }) => {
  const state = await interceptedChat(page);
  state.createResponses.push('lost');
  let releaseCreate!: () => void;
  state.holdCreate = new Promise(resolve => { releaseCreate = resolve; });
  const dialog = await openChat(page);
  await contactDetails(dialog);
  // Two submits in the same turn also exercise the synchronous duplicate guard.
  await dialog.locator('form.customer-chat__contact').evaluate(form => {
    (form as HTMLFormElement).requestSubmit();
    (form as HTMLFormElement).requestSubmit();
  });
  await expect.poll(() => state.createAttempts).toBe(1);
  await expect(dialog.getByLabel('Name', { exact: true })).toBeDisabled();
  releaseCreate();
  state.holdCreate = null;
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('  Alex Morgan  ');
  await expect(dialog.getByLabel('Phone number', { exact: true })).toHaveValue('07700 900101');
  await gateIsLocked(dialog);
  await dialog.getByRole('button', { name: 'Start chat', exact: true }).click();
  await expect(dialog.getByLabel('Your question', { exact: true })).toBeVisible();
  expect(state.createAttempts).toBe(2);
  expect(state.writes[1].body).toEqual(state.writes[0].body);
  expect(state.writes[1].token).toBe(state.writes[0].token);
  expect(state.view.conversation.reference).toBe('TEST-CHAT-101');
  const stored = await page.evaluate(dealer => JSON.parse(localStorage.getItem(`dealer.chat.v1:${encodeURIComponent(location.origin)}:${encodeURIComponent(dealer)}`) || '[]'), dealerName);
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ id, token: state.writes[0].token });
  await safeFinish(state);
});

test('keeps contact details and the gate after a server failure, then allows retry', async ({ page }) => {
  const state = await interceptedChat(page);
  state.createResponses.push('unavailable');
  const dialog = await openChat(page);
  await contactDetails(dialog, 'email');
  await dialog.getByRole('button', { name: 'Start chat', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('unavailable');
  await gateIsLocked(dialog);
  await expect(dialog.getByLabel('Email address', { exact: true })).toHaveValue('alex@customer.example.test');
  expect(state.created).toBe(false);
  await dialog.getByRole('button', { name: 'Start chat', exact: true }).click();
  await expect(dialog.getByLabel('Your question', { exact: true })).toBeVisible();
  expect(state.writes[1].body).toEqual(state.writes[0].body);
  expect(state.writes[1].token).toBe(state.writes[0].token);
  await safeFinish(state);
});

test('an identified saved conversation resumes without another required-contact step', async ({ page }) => {
  const state = await interceptedChat(page, { saved: 'identified' });
  const dialog = await openChat(page);
  await expect(dialog.getByLabel('Your question', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('log', { name: 'Chat messages' })).toContainText(legacyQuestion);
  await expect(dialog.getByRole('button', { name: 'Start chat', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Continue to chat', exact: true })).toHaveCount(0);
  expect(state.writes).toEqual([]);
  await dialog.getByRole('button', { name: 'Close chat', exact: true }).click();
  await page.locator('.customer-chat__launcher').click();
  await expect(dialog.getByLabel('Your question', { exact: true })).toBeVisible();
  expect(state.writes).toEqual([]);
  await safeFinish(state);
});

test('a saved anonymous chat requires contact and keeps its transcript on continuation', async ({ page }) => {
  const state = await interceptedChat(page, { saved: 'anonymous' });
  const originalMessages = structuredClone(state.view.messages);
  const dialog = await openChat(page);
  await gateIsLocked(dialog, 'Continue to chat');
  expect(state.writes).toEqual([]);
  await dialog.getByLabel('Name', { exact: true }).fill('   ');
  await dialog.getByLabel('Phone number', { exact: true }).fill('07700 900101');
  await dialog.getByRole('button', { name: 'Continue to chat', exact: true }).click();
  expect(state.writes).toEqual([]);
  await contactDetails(dialog);
  await dialog.getByRole('button', { name: 'Continue to chat', exact: true }).click();
  await expect(dialog.getByLabel('Your question', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('log', { name: 'Chat messages' })).toContainText(legacyQuestion);
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0]).toMatchObject({ path: `/api/chat/conversations/${id}/contact`, token: savedToken, body: { name: 'Alex Morgan', phone: '07700900101' } });
  expect(state.view.messages).toEqual(originalMessages);
  expect(state.view.conversation.enquiryId).toBe(enquiryId);
  await safeFinish(state);
});

test('a draft survives a contact gate discovered when an existing chat refreshes', async ({ page }) => {
  await page.clock.install();
  const state = await interceptedChat(page, { saved: 'identified' });
  const dialog = await openChat(page);
  const draft = 'Please keep this unsent question while I add my details.';
  await dialog.getByLabel('Your question', { exact: true }).fill(draft);
  state.view.conversation = { ...state.view.conversation, customerName: null, phone: null, email: null, enquiryId: null, revision: 2 };
  await page.clock.runFor(6_050);
  await gateIsLocked(dialog, 'Continue to chat');
  await contactDetails(dialog, 'email');
  await dialog.getByRole('button', { name: 'Continue to chat', exact: true }).click();
  await expect(dialog.getByLabel('Your question', { exact: true })).toHaveValue(draft);
  await expect(dialog.getByRole('log', { name: 'Chat messages' })).toContainText(legacyQuestion);
  expect(state.writes).toHaveLength(1);
  await safeFinish(state);
});

test('phone contact fields and controls fit a short mobile viewport with keyboard focus contained', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await interceptedChat(page);
  const dialog = await openChat(page);
  const phone = dialog.getByLabel('Phone number', { exact: true });
  await expect(phone).toHaveAttribute('type', 'tel');
  await expect(phone).toHaveAttribute('inputmode', 'tel');
  expect(Number.parseFloat(await phone.evaluate(element => getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(16);
  await phone.focus();
  // Chromium desktop cannot display the phone keyboard; shrink the visible viewport as it does.
  await page.setViewportSize({ width: 390, height: 430 });
  await fits(page, dialog);
  await dialog.getByRole('button', { name: 'Start chat', exact: true }).scrollIntoViewIfNeeded();
  const buttonBox = await dialog.getByRole('button', { name: 'Start chat', exact: true }).boundingBox();
  expect(buttonBox!.y).toBeGreaterThanOrEqual(0);
  expect(buttonBox!.y + buttonBox!.height).toBeLessThanOrEqual(430);
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  }
  await gateIsLocked(dialog);
  expect(state.writes).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.locator('.customer-chat__launcher')).toBeFocused();
  await safeFinish(state);
});
