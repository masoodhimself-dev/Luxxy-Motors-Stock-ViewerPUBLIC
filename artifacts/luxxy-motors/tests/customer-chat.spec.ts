import { expect, test, type Page } from '@playwright/test';
import type { ChatConversationView, ChatSettings, DealerRelationships } from '@workspace/vehicle-meta';
import { defaultChatSettings } from '@workspace/vehicle-meta';
import type { DealerSettings } from '@workspace/api-client-react';
import { dealerConfig } from '../src/config/dealer';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Synthetic local preview only; every unexpected API write is blocked.');

const id = 'synthetic-chat-1';
const vehicleId = 'synthetic-chat-car';
const enquiryId = 'synthetic-chat-enquiry';
const conversationHref = `/portal?section=chat&conversationId=${id}`;
const fixtureDealer: DealerSettings = {
  identity: { name: dealerConfig.identity.name, logoText: dealerConfig.identity.logoText || '', logoAsset: dealerConfig.identity.logoAsset || '', brandColors: { primaryHsl: '218 39% 16%', accentHsl: '42 82% 49%' } },
  contact: { phone: '07700 900101', whatsapp: '', email: 'showroom@example.test' },
  address: { street: '1 Example Road', city: 'Example Town', region: '', postcode: '', mapsUrl: '' },
  hours: [{ days: 'Monday – Friday', times: '09:00 – 18:00' }],
  legal: { companyName: 'Example dealership', companyNumber: '', vatNumber: '', termsUrl: '', privacyUrl: '', cookieUrl: '' },
  social: { instagram: '', facebook: '', twitter: '' },
  hero: { announcement: '', copy: 'Choose your next car', subcopy: 'Synthetic showroom data for browser verification.', primaryCta: 'View cars', secondaryCta: 'Contact us' },
  featuredVehicleIds: [],
  warranty: { enabled: false, title: 'Warranty', description: 'Ask the showroom about warranty.', ctaLabel: 'Ask us' },
  delivery: { enabled: false, title: 'Delivery', description: 'Ask the showroom about delivery.', ctaLabel: 'Ask us' },
  partExchange: { enabled: false, title: 'Part exchange', description: 'Ask the showroom about part exchange.', ctaLabel: 'Ask us' },
  bookViewing: { title: 'Book a viewing', description: 'Choose a suitable time with our team.', ctaLabel: 'Book a viewing' },
  recentHandovers: { enabled: false, count: 3 }, trustItems: [], whyBuy: [],
};
function fixture(): ChatConversationView {
  return {
    conversation: {
      id, reference: 'FIXTURE-CHAT-101', vehicle: { id: vehicleId, title: 'BMW 320i M Sport', registration: 'AB20 BMW', price: 18950, imageUrl: null, url: `/vehicle/${vehicleId}` },
      enquiryId, customerName: 'Alex Morgan', email: 'alex@customer.example.test', phone: '07700 900101', status: 'waiting_staff', assignedToId: null, assignedToName: null,
      callbackRequested: true, unreadCount: 2, lastMessage: 'Could I visit on Friday?', createdAt: '2026-10-05T09:00:00Z', updatedAt: '2026-10-05T09:02:00Z', revision: 5,
    },
    availability: { staffOnline: false, showroomState: 'open', nextOpening: null },
    messages: [
      { id: 'synthetic-message-1', conversationId: id, authorRole: 'assistant', authorName: 'Showroom assistant', body: 'Hi, what would you like to know about this car?', createdAt: '2026-10-05T09:00:00Z', actions: [], clientMessageId: null },
      { id: 'synthetic-message-2', conversationId: id, authorRole: 'customer', authorName: 'Alex Morgan', body: 'Could I visit on Friday? I would like to see the service history and arrange a test drive.\nPlease call me when you have a suitable time.', createdAt: '2026-10-05T09:01:00Z', actions: [], clientMessageId: 'synthetic-customer-message-1' },
    ],
  };
}

function relationships(view: ChatConversationView): DealerRelationships {
  const activity = { id: 'synthetic-chat-activity', kind: 'chat' as const, recordType: 'enquiry' as const, recordId: enquiryId, reference: view.conversation.reference, title: 'Website conversation', description: view.messages.map(message => `${message.authorName}: ${message.body}`).join('\n'), status: view.conversation.status, occurredAt: view.conversation.updatedAt, vehicleId, customerId: 'synthetic-chat-customer', amountPence: null, url: conversationHref };
  const counts = { enquiries: 1, appointments: 0, reservations: 0, sales: 0 };
  return {
    generatedAt: '2026-10-05T09:05:00Z',
    vehicles: [{ id: vehicleId, title: 'BMW 320i M Sport', registration: 'AB20 BMW', pricePence: 1895000, imageUrl: null, status: 'available', lastActivityAt: activity.occurredAt, customerIds: ['synthetic-chat-customer'], counts, activities: [activity] }],
    customers: [{ id: 'synthetic-chat-customer', name: 'Alex Morgan', email: 'alex@customer.example.test', phone: '07700 900101', matchingNote: 'Matched through the linked enquiry.', vehicleIds: [vehicleId], recordKeys: [`enquiry:${enquiryId}`], lastActivityAt: activity.occurredAt, counts, activities: [activity] }],
  };
}

async function interceptedChat(page: Page) {
  const state = {
    view: fixture(), settings: { ...defaultChatSettings } as ChatSettings, configFailure: false,
    blockedWrites: [] as string[], writes: [] as { path: string; method: string; body: Record<string, unknown> }[], reads: new Map<string, number>(), errors: [] as string[],
  };
  page.on('pageerror', error => state.errors.push(error.message));
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const isRead = ['GET', 'HEAD', 'OPTIONS'].includes(method);
    if (isRead) state.reads.set(path, (state.reads.get(path) || 0) + 1);
    const json = (data: unknown, status = 200) => route.fulfill({ status, json: data });
    if (isRead && path === '/api/portal/session') return json({ state: 'allowed', name: 'Sam Dealer', email: 'sam@dealer.example.test' });
    if (isRead && path === '/api/staff/access') return json({ role: 'owner', permissions: ['settings.publish', 'sales.manage', 'enquiries.manage'], user: { name: 'Sam Dealer', email: 'sam@dealer.example.test' } });
    if (isRead && path === '/api/dealer-settings') return json(fixtureDealer);
    if (isRead && path === '/api/stock') return json({ schemaVersion: 1, dealerName: fixtureDealer.identity.name, dealerLocation: 'Example Town', count: 0, scrapedAt: '2026-10-05T09:00:00Z', cars: [] });
    if (isRead && path === '/api/recent-handovers') return json({ schemaVersion: 1, handovers: [] });
    if (isRead && path === '/api/staff/directory') return json({ currentUserId: 'synthetic-staff-1', members: [{ id: 'synthetic-staff-1', name: 'Sam Dealer' }, { id: 'synthetic-staff-2', name: 'Taylor Dealer' }] });
    if (isRead && path === '/api/staff/relationships') return json(relationships(state.view));
    if (isRead && path === '/api/chat/config') return json(state.configFailure ? { error: 'Unavailable' } : { settings: state.settings, availability: state.view.availability, dealerName: 'Example Motors' }, state.configFailure ? 503 : 200);
    if (isRead && path === '/api/staff/chat/settings') return json(state.settings);
    if (isRead && path === '/api/staff/chat/conversations') return json({ conversations: [state.view.conversation], totalUnread: state.view.conversation.unreadCount, staffOnline: false });
    if (isRead && path === `/api/staff/chat/conversations/${id}`) return json(state.view);
    if (!isRead) {
      const body = request.postDataJSON() || {};
      const mutation = { path, method, body };
      if (method === 'POST' && path === `/api/staff/chat/conversations/${id}/read`) {
        state.writes.push(mutation);
        if (state.view.conversation.unreadCount) state.view.conversation = { ...state.view.conversation, unreadCount: 0, revision: state.view.conversation.revision + 1 };
        return json(state.view);
      }
      if (method === 'PATCH' && path === `/api/staff/chat/conversations/${id}`) {
        state.writes.push(mutation);
        if (body.expectedRevision !== state.view.conversation.revision) return json({ error: 'This conversation changed.' }, 409);
        state.view.conversation = { ...state.view.conversation, ...(body.status ? { status: body.status } : {}), ...(body.assignedToId !== undefined ? { assignedToId: body.assignedToId, assignedToName: body.assignedToId === 'synthetic-staff-1' ? 'Sam Dealer' : body.assignedToId === 'synthetic-staff-2' ? 'Taylor Dealer' : null } : {}), revision: state.view.conversation.revision + 1 };
        return json(state.view);
      }
      if (method === 'POST' && path === `/api/staff/chat/conversations/${id}/messages`) {
        state.writes.push(mutation);
        if (!state.view.messages.some(message => message.clientMessageId === body.clientMessageId)) {
          state.view.messages.push({ id: 'synthetic-reply-' + body.clientMessageId, conversationId: id, authorRole: 'staff', authorName: 'Sam Dealer', body: body.body, createdAt: '2026-10-05T09:04:00Z', actions: [], clientMessageId: body.clientMessageId });
          state.view.conversation = { ...state.view.conversation, lastMessage: body.body, updatedAt: '2026-10-05T09:04:00Z', revision: state.view.conversation.revision + 1 };
        }
        return json(state.view);
      }
      if (method === 'PATCH' && path === '/api/staff/chat/settings') {
        state.writes.push(mutation); state.settings = { ...state.settings, ...body }; return json(state.settings);
      }
      if (method === 'POST' && path === '/api/staff/chat/presence') { state.writes.push(mutation); return json({ staffOnline: Boolean(body.available) }); }
      state.blockedWrites.push(`${method} ${path}`);
      return json({ error: 'Unexpected API write blocked by synthetic browser review.' }, 403);
    }
    return json({ error: 'This endpoint has no synthetic test fixture.' }, 404);
  });
  return state;
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function screenshot(page: Page, path: string) {
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); window.scrollTo({ top: 0, behavior: 'instant' }); });
  await page.screenshot({ path, fullPage: true });
}

for (const width of [390, 820, 1440]) {
  test(`staff chat and website chat settings work at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1050 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.clock.install();
    const state = await interceptedChat(page);
    await page.goto(conversationHref);
    const thread = page.getByRole('article', { name: 'Selected chat conversation' });
    await expect(thread).toBeVisible();
    await expect(page.getByTestId('tab-chat')).toHaveAttribute('aria-current', 'page');
    await expect.poll(() => state.view.conversation.unreadCount).toBe(0);
    await expect(thread.getByText('Callback requested')).toBeVisible();
    await expect(thread.getByText('Showroom assistant')).toBeVisible();
    await noOverflow(page);
    if (width < 901) {
      await expect(page.getByRole('complementary', { name: 'Chat conversations' })).toBeHidden();
      await expect(thread.getByRole('button', { name: 'Back to chats' })).toBeVisible();
    } else {
      await expect(page.getByRole('complementary', { name: 'Chat conversations' })).toBeVisible();
      await expect(page.getByLabel('Search chats')).toHaveCSS('padding-left', '37px');
    }
    await thread.getByRole('button', { name: 'Take over' }).click();
    await expect(thread.getByText('Assigned to Sam Dealer')).toBeVisible();
    const takeover = state.writes.find(write => write.method === 'PATCH' && write.path.endsWith(id));
    expect(takeover?.body).toEqual({ assignedToId: 'synthetic-staff-1', status: 'with_staff', expectedRevision: 6 });
    await thread.getByLabel('Reply to customer').fill('Friday works. Please let us know a suitable time.');
    await thread.getByRole('button', { name: 'Send reply' }).click();
    const reply = thread.getByRole('region', { name: 'Chat messages' }).locator('li').filter({ hasText: 'Friday works. Please let us know a suitable time.' });
    await expect(reply).toContainText('Sam Dealer');
    await expect(thread.getByLabel('Reply to customer')).toHaveValue('');
    await thread.getByLabel('Reply to customer').fill('Draft waiting for the customer’s next question.');
    const beforeInbox = state.reads.get('/api/staff/chat/conversations') || 0;
    const beforeMessages = state.reads.get(`/api/staff/chat/conversations/${id}`) || 0;
    await page.clock.runFor(10_050);
    await expect.poll(() => state.reads.get('/api/staff/chat/conversations') || 0).toBeGreaterThan(beforeInbox);
    await expect.poll(() => state.reads.get(`/api/staff/chat/conversations/${id}`) || 0).toBeGreaterThan(beforeMessages);
    await expect(reply).toContainText('Sam Dealer');
    await expect(thread.getByLabel('Reply to customer')).toHaveValue('Draft waiting for the customer’s next question.');
    expect(new URL(page.url()).searchParams.get('conversationId')).toBe(id);
    await noOverflow(page);
    await screenshot(page, `/private/tmp/luxxy-chat-inbox-${width}.png`);
    if (width < 901) {
      await thread.getByRole('button', { name: 'Back to chats' }).click();
      await expect(page.getByTestId(`chat-conversation-${id}`)).toBeVisible();
      await page.getByTestId(`chat-conversation-${id}`).click();
      await expect(thread.getByLabel('Reply to customer')).toHaveValue('Draft waiting for the customer’s next question.');
    }

    await page.getByTestId('tab-settings').click();
    await page.getByRole('navigation', { name: 'Dealership settings' }).getByRole('button', { name: 'Website chat' }).click();
    const settings = page.getByRole('region', { name: 'Customer chat settings' });
    await expect(settings.getByRole('heading', { name: 'Website chat' })).toBeVisible();
    await settings.getByLabel('Show chat on the customer website').uncheck();
    await settings.getByLabel('Answer common questions automatically').uncheck();
    await settings.getByLabel('Chat button', { exact: true }).fill('Ask the showroom');
    await settings.getByRole('button', { name: 'Save chat settings' }).click();
    await expect(settings.getByRole('status')).toHaveText('Customer chat settings saved.');
    expect(state.settings.enabled).toBe(false);
    expect(state.settings.automaticAnswers).toBe(false);
    expect(state.settings.buttonLabel).toBe('Ask the showroom');
    await settings.getByLabel('Show chat on the customer website').check();
    await settings.getByRole('button', { name: 'Save chat settings' }).click();
    await expect(settings.getByRole('status')).toHaveText('Customer chat settings saved.');
    expect(state.settings.enabled).toBe(true);
    await noOverflow(page);
    await screenshot(page, `/private/tmp/luxxy-chat-settings-${width}.png`);
    expect(state.blockedWrites).toEqual([]);
    expect(state.errors).toEqual([]);
  });
}

test('links a chat to vehicle and customer history and back to the same conversation', async ({ page }) => {
  const state = await interceptedChat(page);
  await page.goto(conversationHref);
  const thread = page.getByRole('article', { name: 'Selected chat conversation' });
  await expect(thread).toBeVisible();
  for (const [link, profile] of [['Vehicle history', 'Selected vehicle history'], ['Customer history', 'Selected customer history']]) {
    await thread.getByRole('link', { name: link, exact: true }).click();
    await expect(page.getByRole('article', { name: profile })).toBeVisible();
    await expect(page.getByTestId('history-timeline').getByText('Website conversation')).toBeVisible();
    await page.getByTestId('history-timeline').getByRole('button', { name: 'Chat', exact: true }).click();
    const conversationLink = page.getByTestId('history-timeline').getByRole('link', { name: 'Open conversation' });
    await expect(conversationLink).toHaveAttribute('href', conversationHref);
    await conversationLink.click();
    await expect(thread).toBeVisible();
    expect(new URL(page.url()).searchParams.get('conversationId')).toBe(id);
  }
  expect(state.blockedWrites).toEqual([]);
  expect(state.errors).toEqual([]);
});

for (const mode of ['disabled', 'unavailable'] as const) {
  test(`customer chat stays discreet when its configuration is ${mode}`, async ({ page }) => {
    const state = await interceptedChat(page);
    state.settings.enabled = mode !== 'disabled';
    state.configFailure = mode === 'unavailable';
    await page.goto('/stock');
    await expect.poll(() => state.reads.get('/api/chat/config') || 0).toBeGreaterThan(0);
    await expect(page.locator('.customer-chat__launcher')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(state.blockedWrites).toEqual([]);
    expect(state.errors).toEqual([]);
  });
}
