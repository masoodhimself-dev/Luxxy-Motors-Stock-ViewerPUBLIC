import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ChatConversationView, type ChatPublicConfig, type ChatSession } from '@workspace/vehicle-meta';
import { CustomerChat, customerChatStorageKey, routeAllowsCustomerChat, safeChatAction } from './customer-chat';

const browsing = vi.hoisted(() => ({ location: '/vehicle/car-a', vehicleId: 'car-a' as string | null }));
vi.mock('wouter', () => ({
  useLocation: () => [browsing.location, vi.fn()],
  useRoute: () => [Boolean(browsing.vehicleId), browsing.vehicleId ? { id: browsing.vehicleId } : null],
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
}));
vi.mock('@/lib/stock-context', () => ({ useStock: () => ({ stock: { cars: [
  { id: 'car-a', title: 'Ford Fiesta', year: 2015, images: [] },
  { id: 'car-b', title: 'Honda Jazz', year: 2016, images: [] },
] } }) }));

const configuration: ChatPublicConfig = {
  dealerName: 'Luxxy Motors',
  settings: { enabled: true, automaticAnswers: true, buttonLabel: 'Ask us', greeting: 'Hi, welcome. What would you like to know?', offlineMessage: 'The team will pick up your message when they’re available.', notificationsEnabled: true },
  availability: { staffOnline: false, showroomState: 'open', nextOpening: null },
};

function conversation(id = 'chat-a', vehicleId = 'car-a'): ChatConversationView {
  return {
    conversation: {
      id, reference: 'CHAT-123', vehicle: { id: vehicleId, title: vehicleId === 'car-a' ? '2015 Ford Fiesta' : '2016 Honda Jazz', registration: null, price: 5000, imageUrl: null, url: `/vehicle/${vehicleId}` },
      enquiryId: 'linked-enquiry', customerName: 'Alex Morgan', email: null, phone: '07700900123', status: 'assistant', assignedToId: null, assignedToName: null, callbackRequested: false, unreadCount: 0, lastMessage: 'The published mileage is 38,000 miles.', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), revision: 1,
    },
    availability: configuration.availability,
    messages: [
      { id: `${id}-1`, conversationId: id, authorRole: 'customer', authorName: 'Customer', body: 'What’s the mileage?', createdAt: new Date().toISOString(), actions: [], clientMessageId: 'client-1' },
      { id: `${id}-2`, conversationId: id, authorRole: 'assistant', authorName: 'Showroom assistant', body: 'The published mileage is 38,000 miles.', createdAt: new Date().toISOString(), actions: [], clientMessageId: null },
    ],
  };
}

function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }); }
function tokenOf(init?: RequestInit) { return new Headers(init?.headers).get('X-Chat-Token'); }
function bodyOf(init?: RequestInit) { return JSON.parse(String(init?.body)) as Record<string, unknown>; }
function savedChat(id = 'chat-a', token = 'private-chat-token') { return { id, token, title: '2015 Ford Fiesta', updatedAt: new Date().toISOString() }; }

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  browsing.location = '/vehicle/car-a';
  browsing.vehicleId = 'car-a';
  window.localStorage.clear();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: undefined });
  fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    if (input === '/api/chat/config') return json(configuration);
    if (input === '/api/chat/conversations') return json({ ...conversation(), sessionToken: tokenOf(init)! } satisfies ChatSession);
    return json(conversation());
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function openChat() {
  fireEvent.click(await screen.findByRole('button', { name: 'Ask us' }));
  return screen.findByRole('dialog');
}
function fillContact(name = 'Alex Morgan', phone = '07700 900123') {
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: name } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Phone number' }), { target: { value: phone } });
}
function submitDetails() {
  fireEvent.submit(screen.getByRole('textbox', { name: 'Name' }).closest('form')!);
}
async function beginChat() {
  fillContact();
  submitDetails();
  await screen.findByRole('textbox', { name: 'Your question' });
}
function sendQuestion(body = 'What’s the mileage?') {
  const input = screen.getByRole('textbox', { name: 'Your question' });
  fireEvent.change(input, { target: { value: body } });
  fireEvent.submit(input.closest('form')!);
}
function createCalls() { return fetchMock.mock.calls.filter(([path]) => path === '/api/chat/conversations'); }
function getCalls() { return fetchMock.mock.calls.filter(([path, init]) => String(path).startsWith('/api/chat/conversations/') && init?.method !== 'POST'); }

describe('quiet customer chat', () => {
  it('waits for a click and requires name and one contact channel before opening a conversation', async () => {
    render(<CustomerChat />);
    await screen.findByRole('button', { name: 'Ask us' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(createCalls()).toHaveLength(0);
    await openChat();
    expect(screen.getByText('2015 Ford Fiesta', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Email address')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Your question' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close contact form' })).not.toBeInTheDocument();
    expect(createCalls()).toHaveLength(0);
    await beginChat();
    await screen.findByText('The published mileage is 38,000 miles.');
    const request = createCalls()[0][1] as RequestInit;
    expect(bodyOf(request)).toMatchObject({ vehicleId: 'car-a', name: 'Alex Morgan', phone: '07700900123' });
    expect(bodyOf(request)).not.toHaveProperty('message');
    expect(bodyOf(request)).not.toHaveProperty('email');
    expect(tokenOf(request)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.parse(window.localStorage.getItem(customerChatStorageKey('Luxxy Motors'))!)[0].token).toBe(tokenOf(request));
  });

  it('hides the widget when the dealership disables chat', async () => {
    fetchMock.mockResolvedValue(json({ ...configuration, settings: { ...configuration.settings, enabled: false } }));
    const result = render(<CustomerChat />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(result.container).toBeEmptyDOMElement();
  });

  it('refreshes settings after a staff save and closes a newly disabled chat', async () => {
    render(<CustomerChat />);
    await openChat();
    fetchMock.mockResolvedValue(json({ ...configuration, settings: { ...configuration.settings, enabled: false } }));
    act(() => window.dispatchEvent(new Event('dealer-chat-settings-saved')));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Ask us' })).not.toBeInTheDocument());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
  });

  it('closes on Escape and restores keyboard focus to the launcher', async () => {
    render(<CustomerChat />);
    await openChat();
    expect(screen.getByRole('button', { name: 'Close chat' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask us' })).toHaveFocus();
    expect(document.body.style.overflow).toBe('');
  });

  it('keeps contact details and private retry credentials after a lost start response', async () => {
    let starts = 0;
    fetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/chat/config') return json(configuration);
      if (path === '/api/chat/conversations') {
        starts += 1;
        if (starts === 1) throw new TypeError('Network interrupted');
        return json({ ...conversation(), sessionToken: tokenOf(init) });
      }
      return json(conversation());
    });
    render(<CustomerChat />);
    await openChat();
    fillContact();
    submitDetails();
    await screen.findByRole('alert');
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Alex Morgan');
    expect(screen.getByRole('textbox', { name: 'Phone number' })).toHaveValue('07700 900123');
    fireEvent.click(screen.getByRole('button', { name: 'Start chat' }));
    await screen.findByText('The published mileage is 38,000 miles.');
    expect(createCalls()).toHaveLength(2);
    const first = createCalls()[0][1] as RequestInit;
    const second = createCalls()[1][1] as RequestInit;
    expect(bodyOf(second).requestId).toBe(bodyOf(first).requestId);
    expect(tokenOf(second)).toBe(tokenOf(first));
    expect(screen.getByRole('textbox', { name: 'Your question' })).toHaveValue('');
  });

  it('ignores duplicate submits while contact capture is in flight', async () => {
    let resolveStart!: (value: Response) => void;
    fetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/chat/config') return json(configuration);
      if (path === '/api/chat/conversations') return new Promise<Response>((resolve) => { resolveStart = resolve; });
      return json(conversation());
    });
    render(<CustomerChat />);
    await openChat();
    fillContact();
    submitDetails();
    const input = screen.getByRole('textbox', { name: 'Name' });
    fireEvent.submit(input.closest('form')!);
    expect(createCalls()).toHaveLength(1);
    expect(input).toBeDisabled();
    await act(async () => resolveStart(json({ ...conversation(), sessionToken: tokenOf(createCalls()[0][1]) })));
    await screen.findByText('The published mileage is 38,000 miles.');
  });

  it('never reuses a token stored for another dealership or origin', async () => {
    window.localStorage.setItem(customerChatStorageKey('Other Motors'), JSON.stringify([savedChat('other-chat', 'other-dealer-secret')]));
    window.localStorage.setItem(customerChatStorageKey('Luxxy Motors', 'https://other.example'), JSON.stringify([savedChat('other-origin-chat', 'other-origin-secret')]));
    render(<CustomerChat />);
    await openChat();
    expect(getCalls()).toHaveLength(0);
    await beginChat();
    await screen.findByText('The published mileage is 38,000 miles.');
    const token = tokenOf(createCalls()[0][1]);
    expect(token).not.toBe('other-dealer-secret');
    expect(token).not.toBe('other-origin-secret');
  });

  it('restores a saved conversation with its token and keeps it private when closed', async () => {
    window.localStorage.setItem(customerChatStorageKey('Luxxy Motors'), JSON.stringify([savedChat()]));
    render(<CustomerChat />);
    await screen.findByRole('button', { name: 'Ask us' });
    expect(getCalls()).toHaveLength(0);
    await openChat();
    await screen.findByText('The published mileage is 38,000 miles.');
    expect(tokenOf(getCalls()[0][1])).toBe('private-chat-token');
    expect(String(getCalls()[0][0])).not.toContain('private-chat-token');
    fireEvent.click(screen.getByRole('button', { name: 'Close chat' }));
    expect(screen.queryByText('The published mileage is 38,000 miles.')).not.toBeInTheDocument();
  });

  it('offers an explicit fresh car conversation while retaining the original chat', async () => {
    const existing = conversation();
    fetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/chat/config') return json(configuration);
      if (path === '/api/chat/conversations') {
        const forSecondCar = bodyOf(init).vehicleId === 'car-b';
        return json({ ...(forSecondCar ? conversation('chat-b', 'car-b') : existing), sessionToken: tokenOf(init) });
      }
      return json(path.includes('chat-b') ? conversation('chat-b', 'car-b') : existing);
    });
    const result = render(<CustomerChat />);
    await openChat();
    await beginChat();
    await screen.findByText('The published mileage is 38,000 miles.');
    browsing.location = '/vehicle/car-b'; browsing.vehicleId = 'car-b';
    result.rerender(<CustomerChat />);
    expect(screen.getByText('2015 Ford Fiesta', { selector: 'strong' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ask about this car' }));
    expect(screen.getByText('2016 Honda Jazz')).toBeInTheDocument();
    await beginChat();
    await waitFor(() => expect(createCalls()).toHaveLength(2));
    await screen.findByRole('option', { name: '2016 Honda Jazz' });
    expect(bodyOf(createCalls()[1][1]).vehicleId).toBe('car-b');
    const saved = JSON.parse(window.localStorage.getItem(customerChatStorageKey('Luxxy Motors'))!) as Array<{ id: string }>;
    expect(saved.map((entry) => entry.id)).toEqual(['chat-b', 'chat-a']);
    fireEvent.change(screen.getByRole('combobox', { name: 'Choose a previous chat' }), { target: { value: 'chat-a' } });
    await waitFor(() => expect(screen.getByText('2015 Ford Fiesta', { selector: 'strong' })).toBeInTheDocument());
  });

  it('allows an identified customer to update one contact channel and request a callback', async () => {
    render(<CustomerChat />);
    await openChat();
    await beginChat();
    await screen.findByText('The published mileage is 38,000 miles.');
    expect(screen.queryByRole('textbox', { name: 'Name' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Contact details' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Jordan' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Reply by' }), { target: { value: 'phone' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Phone number' }), { target: { value: '07123456789' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'I’d like a callback' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save contact details' }));
    await screen.findByText('Your details are saved for the showroom team.');
    const request = fetchMock.mock.calls.find(([path]) => path === '/api/chat/conversations/chat-a/contact')![1] as RequestInit;
    expect(bodyOf(request)).toEqual({ name: 'Jordan', phone: '07123456789', callbackRequested: true });
    expect(tokenOf(request)).toBe(tokenOf(createCalls()[0][1]));
  });

  it('uses the mobile visible viewport and keeps the contact form inside the scrollable content', async () => {
    const listeners = new Map<string, () => void>();
    const visibleViewport = { height: 700, offsetTop: 0, addEventListener: vi.fn((event: string, callback: () => void) => listeners.set(event, callback)), removeEventListener: vi.fn() };
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: visibleViewport });
    render(<CustomerChat />);
    await openChat();
    visibleViewport.height = 340;
    act(() => listeners.get('resize')?.());
    const panel = screen.getByRole('dialog');
    expect(panel.parentElement).toHaveStyle({ height: '340px' });
    expect(screen.getByRole('textbox', { name: 'Name' }).closest('.customer-chat__messages')).not.toBeNull();
    expect(within(panel).getByRole('button', { name: 'Start chat' })).toBeInTheDocument();
  });

  it('keeps drafts while offline and disables sending', async () => {
    render(<CustomerChat />);
    await openChat();
    await beginChat();
    fireEvent.change(screen.getByRole('textbox', { name: 'Your question' }), { target: { value: 'Can I view this car?' } });
    act(() => window.dispatchEvent(new Event('offline')));
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: 'Your question' })).toHaveValue('Can I view this car?');
    expect(fetchMock.mock.calls.filter(([path]) => path === '/api/chat/conversations/chat-a/messages')).toHaveLength(0);
  });

  it('polls only an open visible conversation and stops when the panel closes', async () => {
    vi.useFakeTimers();
    window.localStorage.setItem(customerChatStorageKey('Luxxy Motors'), JSON.stringify([savedChat()]));
    await act(async () => { render(<CustomerChat />); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ask us' })); });
    expect(getCalls()).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(getCalls()).toHaveLength(2);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
    expect(getCalls()).toHaveLength(2);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(getCalls()).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Close chat' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(12_000); });
    expect(getCalls()).toHaveLength(3);
  });

  it('ignores a late response from a conversation after the customer starts a fresh car chat', async () => {
    let resolveOld!: (value: Response) => void;
    window.localStorage.setItem(customerChatStorageKey('Luxxy Motors'), JSON.stringify([savedChat()]));
    fetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/chat/config') return json(configuration);
      if (path === '/api/chat/conversations/chat-a') return new Promise<Response>((resolve) => { resolveOld = resolve; });
      if (path === '/api/chat/conversations') return json({ ...conversation('chat-b', 'car-b'), sessionToken: tokenOf(init) });
      return json(conversation('chat-b', 'car-b'));
    });
    const result = render(<CustomerChat />);
    await openChat();
    await waitFor(() => expect(getCalls()).toHaveLength(1));
    browsing.location = '/vehicle/car-b'; browsing.vehicleId = 'car-b';
    result.rerender(<CustomerChat />);
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    await beginChat();
    await screen.findByRole('option', { name: '2016 Honda Jazz' });
    await act(async () => resolveOld(json(conversation())));
    expect(screen.getByText('2016 Honda Jazz', { selector: 'strong' })).toBeInTheDocument();
    expect(screen.queryByText('2015 Ford Fiesta', { selector: 'strong' })).not.toBeInTheDocument();
  });

  it('preserves newer message revisions when an older poll response arrives', async () => {
    vi.useFakeTimers();
    const newer = conversation();
    newer.conversation.revision = 2;
    newer.messages.push({ id: 'new-1', conversationId: 'chat-a', authorRole: 'staff', authorName: 'Mia', body: 'Saturday at 10 works for a viewing.', createdAt: new Date().toISOString(), actions: [], clientMessageId: null });
    let reads = 0;
    window.localStorage.setItem(customerChatStorageKey('Luxxy Motors'), JSON.stringify([savedChat()]));
    fetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/chat/config') return json(configuration);
      reads += 1;
      return json(reads === 1 ? newer : conversation());
    });
    await act(async () => { render(<CustomerChat />); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Ask us' })); });
    expect(screen.getByText('Saturday at 10 works for a viewing.')).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
    expect(reads).toBe(2);
    expect(screen.getByText('Saturday at 10 works for a viewing.')).toBeInTheDocument();
  });

  it('discards an expired saved token and leaves the customer able to begin a new chat', async () => {
    window.localStorage.setItem(customerChatStorageKey('Luxxy Motors'), JSON.stringify([savedChat()]));
    fetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/chat/config') return json(configuration);
      if (path === '/api/chat/conversations/chat-a') return json({ error: 'Expired' }, 401);
      return json({ ...conversation('chat-fresh'), sessionToken: tokenOf(init) });
    });
    render(<CustomerChat />);
    await openChat();
    await screen.findByText('This saved chat is no longer available. You can start a new one below.');
    expect(JSON.parse(window.localStorage.getItem(customerChatStorageKey('Luxxy Motors'))!)).toEqual([]);
    await beginChat();
    await screen.findByText('The published mileage is 38,000 miles.');
    expect(tokenOf(createCalls()[0][1])).not.toBe('private-chat-token');
  });

  it('names real staff and filters unsafe actions from plain text messages', async () => {
    const view = conversation();
    view.messages[1].authorName = 'Fake human name';
    view.messages[1].actions = [
      { label: 'Book a viewing', href: '/enquire?type=viewing&vehicleId=car-a', kind: 'book_test_drive' },
      { label: 'Unsafe action', href: 'javascript:alert(1)', kind: 'contact' },
    ];
    view.messages.push({ id: 'staff-1', conversationId: 'chat-a', authorRole: 'staff', authorName: 'Mia', body: 'I can check that for you.', createdAt: new Date().toISOString(), actions: [], clientMessageId: null });
    window.localStorage.setItem(customerChatStorageKey('Luxxy Motors'), JSON.stringify([savedChat()]));
    fetchMock.mockImplementation(async (path: string) => json(path === '/api/chat/config' ? configuration : view));
    render(<CustomerChat />);
    await openChat();
    await screen.findByText('I can check that for you.');
    expect(screen.getByText('Mia')).toBeInTheDocument();
    expect(screen.queryByText('Fake human name')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Book a viewing' })).toHaveAttribute('href', '/enquire?type=viewing&vehicleId=car-a');
    expect(screen.queryByRole('link', { name: 'Unsafe action' })).not.toBeInTheDocument();
  });
});

describe('chat boundaries', () => {
  it('keeps staff, secure customer and payment journeys clear', () => {
    for (const path of ['/portal', '/portal/leads/id', '/my-purchase/token', '/viewing/token', '/reserve/payment-return', '/sign-in', '/sign-up', '/enquire']) expect(routeAllowsCustomerChat(path)).toBe(false);
    expect(routeAllowsCustomerChat('/vehicle/car-a')).toBe(true);
    expect(routeAllowsCustomerChat('/stock')).toBe(true);
  });

  it('accepts only local public website action paths', () => {
    for (const href of ['https://example.com', '//example.com', '/\\example.com', 'javascript:alert(1)', '/portal', '/my-purchase/token', '/contact\n']) expect(safeChatAction(href)).toBeNull();
    expect(safeChatAction('/vehicle/car-a')).toBe('/vehicle/car-a');
    expect(safeChatAction('/enquire?vehicleId=car-a')).toBe('/enquire?vehicleId=car-a');
  });
});
