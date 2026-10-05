import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ChatConversationView, ChatInbox } from '@workspace/vehicle-meta';
import { defaultChatSettings } from '@workspace/vehicle-meta';
import { ChatPanel } from './chat-panel';

function fixture(): ChatConversationView {
  return {
    conversation: {
      id: 'chat-1', reference: 'LM-CHAT-101', vehicle: { id: 'car-1', title: 'BMW 320i M Sport', registration: 'AB20 BMW', price: 18950, imageUrl: null, url: '/cars/car-1' },
      enquiryId: 'enquiry-1', customerName: 'Alex Morgan', email: 'alex@example.test', phone: '07700 900101', status: 'waiting_staff', assignedToId: null, assignedToName: null,
      callbackRequested: true, unreadCount: 2, lastMessage: 'Could I visit on Friday?', createdAt: '2026-10-05T09:00:00Z', updatedAt: '2026-10-05T09:02:00Z', revision: 5,
    },
    availability: { staffOnline: false, showroomState: 'open', nextOpening: null },
    messages: [
      { id: 'message-1', conversationId: 'chat-1', authorRole: 'assistant', authorName: 'Showroom assistant', body: 'Hi, what would you like to know?', createdAt: '2026-10-05T09:00:00Z', actions: [], clientMessageId: null },
      { id: 'message-2', conversationId: 'chat-1', authorRole: 'customer', authorName: 'Alex Morgan', body: 'Could I visit on Friday?', createdAt: '2026-10-05T09:01:00Z', actions: [], clientMessageId: 'customer-message-1' },
      { id: 'message-3', conversationId: 'chat-1', authorRole: 'staff', authorName: 'Sam Dealer', body: 'I can check that for you. <script>literal text</script>', createdAt: '2026-10-05T09:02:00Z', actions: [], clientMessageId: 'staff-message-1' },
    ],
  };
}

let view: ChatConversationView;
let queryClient: QueryClient;
let fetchMock: ReturnType<typeof vi.fn>;
let sendFailures: number;
let readFailures: number;
let inboxFailure: boolean;
let patchConflict: boolean;

beforeEach(() => {
  view = fixture();
  sendFailures = 0;
  readFailures = 0;
  inboxFailure = false;
  patchConflict = false;
  window.history.replaceState(null, '', '/portal?section=chat');
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  fetchMock = vi.fn(async (input: RequestInfo | URL, options: RequestInit) => {
    const path = String(input);
    const method = options.method;
    const payload = typeof options.body === 'string' ? JSON.parse(options.body) : {};
    if (path === '/api/staff/chat/conversations') return Response.json(inboxFailure ? { error: 'Unavailable' } : { conversations: [view.conversation], totalUnread: view.conversation.unreadCount, staffOnline: false } satisfies ChatInbox, { status: inboxFailure ? 503 : 200 });
    if (path === '/api/staff/chat/settings') return Response.json(defaultChatSettings);
    if (path === '/api/staff/directory') return Response.json({ currentUserId: 'staff-1', members: [{ id: 'staff-1', name: 'Sam Dealer' }, { id: 'staff-2', name: 'Taylor Dealer' }] });
    if (path === '/api/staff/chat/presence') return Response.json({ staffOnline: payload.available });
    if (path === '/api/staff/chat/conversations/chat-1/read') {
      if (readFailures-- > 0) return Response.json({ error: 'Unavailable' }, { status: 503 });
      view = { ...view, conversation: { ...view.conversation, unreadCount: 0, revision: view.conversation.revision + 1 } };
      return Response.json(view);
    }
    if (path === '/api/staff/chat/conversations/chat-1/messages') {
      if (sendFailures-- > 0) return Response.json({ error: 'Unavailable' }, { status: 503 });
      view = {
        ...view,
        conversation: { ...view.conversation, lastMessage: payload.body, revision: view.conversation.revision + 1 },
        messages: [...view.messages, { id: `reply-${payload.clientMessageId}`, conversationId: 'chat-1', authorRole: 'staff', authorName: 'Sam Dealer', body: payload.body, clientMessageId: payload.clientMessageId, createdAt: '2026-10-05T09:03:00Z', actions: [] }],
      };
      return Response.json(view);
    }
    if (path === '/api/staff/chat/conversations/chat-1') {
      if (method === 'PATCH') {
        if (patchConflict) {
          patchConflict = false;
          view = { ...view, conversation: { ...view.conversation, revision: 20, assignedToId: 'staff-2', assignedToName: 'Taylor Dealer' } };
          return Response.json({ error: 'Conversation changed' }, { status: 409 });
        }
        view = { ...view, conversation: { ...view.conversation, ...payload, assignedToName: payload.assignedToId === 'staff-1' ? 'Sam Dealer' : payload.assignedToId === 'staff-2' ? 'Taylor Dealer' : view.conversation.assignedToName, revision: view.conversation.revision + 1 } };
      }
      return Response.json(view);
    }
    return Response.json({ error: 'Missing conversation' }, { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  queryClient.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
});

function renderPanel(deepLink = false) {
  if (deepLink) window.history.replaceState(null, '', '/portal?section=chat&conversationId=chat-1');
  return render(<QueryClientProvider client={queryClient}><ChatPanel /></QueryClientProvider>);
}
function callsFor(path: string, method?: string) {
  return fetchMock.mock.calls.filter(([input, options]) => String(input) === path && (!method || options.method === method));
}
function thread() { return screen.getByRole('article', { name: 'Selected chat conversation' }); }
async function loadedThread() {
  await screen.findByRole('article', { name: 'Selected chat conversation' });
  await waitFor(() => expect(callsFor('/api/staff/chat/conversations/chat-1/read')).toHaveLength(1));
  await waitFor(() => expect(view.conversation.unreadCount).toBe(0));
}

it('keeps unread chats in the inbox until opened, then marks them read and preserves the selected URL', async () => {
  renderPanel();
  const row = await screen.findByTestId('chat-conversation-chat-1');
  expect(within(row).getByLabelText('2 unread messages')).toBeInTheDocument();
  expect(callsFor('/api/staff/chat/conversations/chat-1/read')).toHaveLength(0);
  fireEvent.click(row);
  await loadedThread();
  await waitFor(() => expect(within(screen.getByTestId('chat-conversation-chat-1')).queryByLabelText('2 unread messages')).not.toBeInTheDocument());
  expect(new URLSearchParams(window.location.search).get('conversationId')).toBe('chat-1');
  await act(async () => { await queryClient.invalidateQueries({ queryKey: ['staff-chat-inbox'] }); });
  expect(new URLSearchParams(window.location.search).get('conversationId')).toBe('chat-1');
  expect(thread()).toHaveTextContent('Alex Morgan');
});

it('shows real staff authors, assistant identity, plain text, callback and source history links', async () => {
  renderPanel(true);
  await loadedThread();
  expect(within(thread()).getByText('Showroom assistant')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Chat messages' })).getByText('Sam Dealer')).toBeInTheDocument();
  expect(within(thread()).getByText('I can check that for you. <script>literal text</script>')).toBeInTheDocument();
  expect(thread().querySelector('script')).toBeNull();
  expect(within(thread()).getByText('Callback requested')).toBeInTheDocument();
  expect(within(thread()).getByRole('link', { name: 'alex@example.test' })).toHaveAttribute('href', 'mailto:alex@example.test');
  expect(within(thread()).getByRole('link', { name: 'Customer history' })).toHaveAttribute('href', '/portal?section=history&view=customers&record=enquiry%3Aenquiry-1');
  expect(within(thread()).getByRole('link', { name: 'Vehicle history' })).toHaveAttribute('href', '/portal?section=history&view=vehicles&vehicleId=car-1');
  expect(within(thread()).getByRole('link', { name: 'Book test drive' })).toHaveAttribute('href', '/portal?section=enquiries&enquiryId=enquiry-1');
  expect(within(thread()).getByText('£18,950')).toBeInTheDocument();
  expect(within(thread()).getByRole('region', { name: 'Staff conversation controls' })).not.toHaveTextContent('Conversation visible to the customer');
});

it('takes over and assigns with the current revision, then resolves and reopens', async () => {
  renderPanel(true);
  await loadedThread();
  const revision = view.conversation.revision;
  fireEvent.click(within(thread()).getByRole('button', { name: 'Take over' }));
  await waitFor(() => expect(callsFor('/api/staff/chat/conversations/chat-1', 'PATCH')).toHaveLength(1));
  expect(JSON.parse(callsFor('/api/staff/chat/conversations/chat-1', 'PATCH')[0][1].body)).toEqual({ assignedToId: 'staff-1', status: 'with_staff', expectedRevision: revision });
  await waitFor(() => expect(within(thread()).getByText('Assigned to Sam Dealer')).toBeInTheDocument());
  fireEvent.change(within(thread()).getByLabelText('Assign conversation to staff'), { target: { value: 'staff-2' } });
  await waitFor(() => expect(within(thread()).getByText('Assigned to Taylor Dealer')).toBeInTheDocument());
  fireEvent.click(within(thread()).getByRole('button', { name: 'Resolve' }));
  await waitFor(() => expect(within(thread()).getByRole('button', { name: 'Reopen' })).toBeInTheDocument());
  expect(within(thread()).getByLabelText('Reply to customer')).toBeDisabled();
  fireEvent.click(within(thread()).getByRole('button', { name: 'Reopen' }));
  await waitFor(() => expect(within(thread()).getByLabelText('Reply to customer')).not.toBeDisabled());
});

it('retains a failed reply and reuses its message ID when staff retry', async () => {
  sendFailures = 1;
  renderPanel(true);
  await loadedThread();
  const reply = within(thread()).getByLabelText('Reply to customer');
  const body = 'Friday works.\nPlease let us know a suitable time.';
  fireEvent.change(reply, { target: { value: body } });
  fireEvent.click(within(thread()).getByRole('button', { name: 'Send reply' }));
  await screen.findByText('Your reply could not be sent. It is saved here so you can try again.');
  expect(reply).toHaveValue(body);
  fireEvent.click(within(thread()).getByRole('button', { name: 'Retry sending' }));
  await waitFor(() => expect(reply).toHaveValue(''));
  const requests = callsFor('/api/staff/chat/conversations/chat-1/messages');
  expect(requests).toHaveLength(2);
  const first = JSON.parse(requests[0][1].body);
  expect(first.body).toBe(body);
  expect(first.clientMessageId).toBeTruthy();
  expect(JSON.parse(requests[1][1].body)).toEqual(first);
  expect(within(screen.getByRole('region', { name: 'Chat messages' })).getByText(/Friday works/)).toHaveTextContent('Please let us know a suitable time.');
});

it('loads the latest revision after a conflict and waits for a deliberate retry', async () => {
  renderPanel(true);
  await loadedThread();
  patchConflict = true;
  fireEvent.click(within(thread()).getByRole('button', { name: 'Take over' }));
  await screen.findByText(/This conversation changed while you were editing it/);
  await waitFor(() => expect(within(thread()).getByText('Assigned to Taylor Dealer')).toBeInTheDocument());
  expect(callsFor('/api/staff/chat/conversations/chat-1', 'PATCH')).toHaveLength(1);
  fireEvent.click(within(thread()).getByRole('button', { name: 'Take over' }));
  await waitFor(() => expect(callsFor('/api/staff/chat/conversations/chat-1', 'PATCH')).toHaveLength(2));
  expect(JSON.parse(callsFor('/api/staff/chat/conversations/chat-1', 'PATCH')[1][1].body).expectedRevision).toBe(20);
});

it('keeps failed read state visible and allows staff to retry it', async () => {
  readFailures = 1;
  renderPanel(true);
  await screen.findByText('The conversation could not be marked as read.');
  expect(view.conversation.unreadCount).toBe(2);
  expect(callsFor('/api/staff/chat/conversations/chat-1/read')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Mark as read' }));
  await waitFor(() => expect(screen.queryByText('The conversation could not be marked as read.')).not.toBeInTheDocument());
  expect(view.conversation.unreadCount).toBe(0);
});

it('searches registration, contact and reference, filters status, and returns to the mobile list', async () => {
  renderPanel();
  await screen.findByTestId('chat-conversation-chat-1');
  const search = screen.getByLabelText('Search chats');
  for (const term of ['AB20BMW', '07700900101', 'LM-CHAT-101']) {
    fireEvent.change(search, { target: { value: term } });
    expect(screen.getByTestId('chat-conversation-chat-1')).toBeInTheDocument();
  }
  fireEvent.click(screen.getByRole('button', { name: 'Resolved' }));
  expect(screen.getByText('No matching conversations')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  fireEvent.click(screen.getByTestId('chat-conversation-chat-1'));
  await loadedThread();
  fireEvent.change(within(thread()).getByLabelText('Reply to customer'), { target: { value: 'A saved draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Back to chats' }));
  expect(new URLSearchParams(window.location.search).has('conversationId')).toBe(false);
  fireEvent.click(screen.getByTestId('chat-conversation-chat-1'));
  await screen.findByRole('article', { name: 'Selected chat conversation' });
  expect(within(thread()).getByLabelText('Reply to customer')).toHaveValue('A saved draft');
});

it('distinguishes load failures from an empty inbox and supports retry', async () => {
  inboxFailure = true;
  renderPanel();
  await screen.findByText('Conversations could not be loaded.');
  expect(screen.queryByText('No conversations yet')).not.toBeInTheDocument();
  inboxFailure = false;
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByTestId('chat-conversation-chat-1');
});

it('keeps an unavailable deep link instead of selecting a different chat', async () => {
  window.history.replaceState(null, '', '/portal?section=chat&conversationId=missing-chat');
  renderPanel();
  await screen.findByText('This conversation could not be found.');
  expect(new URLSearchParams(window.location.search).get('conversationId')).toBe('missing-chat');
  expect(screen.queryByRole('article', { name: 'Selected chat conversation' })).not.toBeInTheDocument();
});

it('does not create customer history links before a chat is attached to an enquiry', async () => {
  view.conversation = { ...view.conversation, enquiryId: null, customerName: null, email: null, phone: null, callbackRequested: false };
  renderPanel(true);
  await loadedThread();
  expect(within(thread()).queryByRole('link', { name: 'Customer history' })).not.toBeInTheDocument();
  expect(within(thread()).queryByRole('link', { name: 'Book test drive' })).not.toBeInTheDocument();
  expect(within(thread()).getByText('Contact details have not been shared.')).toBeInTheDocument();
});

it('only reports availability after the server confirms it and goes offline when hidden or unmounted', async () => {
  const rendered = renderPanel();
  await screen.findByTestId('chat-conversation-chat-1');
  expect(callsFor('/api/staff/chat/presence')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Go available' }));
  await screen.findByRole('button', { name: 'You are available' });
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  await waitFor(() => expect(callsFor('/api/staff/chat/presence').some(([, options]) => JSON.parse(options.body).available === false)).toBe(true));
  expect(screen.queryByRole('button', { name: 'You are available' })).not.toBeInTheDocument();
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  await screen.findByRole('button', { name: 'You are available' });
  const beforeUnmount = callsFor('/api/staff/chat/presence').length;
  rendered.unmount();
  await waitFor(() => expect(callsFor('/api/staff/chat/presence').length).toBeGreaterThan(beforeUnmount));
  expect(JSON.parse(callsFor('/api/staff/chat/presence').at(-1)![1].body)).toEqual({ available: false });
});

it('keeps live chat offline when the server confirms presence outside opening hours', async () => {
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((input: RequestInfo | URL, options: RequestInit) => String(input) === '/api/staff/chat/presence'
    ? Promise.resolve(Response.json({ staffOnline: false })) : original(input, options));
  renderPanel();
  await screen.findByTestId('chat-conversation-chat-1');
  fireEvent.click(screen.getByRole('button', { name: 'Go available' }));
  await screen.findByRole('button', { name: 'Availability set' });
  expect(screen.queryByText('Customers can request a live reply.')).not.toBeInTheDocument();
  expect(screen.getByText('Live chat is shown during the showroom’s published opening hours.')).toBeInTheDocument();
});

it('polls messages and inbox while visible and pauses both when the page is hidden', async () => {
  vi.useFakeTimers();
  view.conversation.unreadCount = 0;
  renderPanel(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  expect(thread()).toBeInTheDocument();
  const beforeInbox = callsFor('/api/staff/chat/conversations').length;
  const beforeThread = callsFor('/api/staff/chat/conversations/chat-1', 'GET').length;
  await act(async () => { await vi.advanceTimersByTimeAsync(10_050); });
  expect(callsFor('/api/staff/chat/conversations').length).toBeGreaterThan(beforeInbox);
  expect(callsFor('/api/staff/chat/conversations/chat-1', 'GET').length).toBeGreaterThan(beforeThread);
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  const hiddenInbox = callsFor('/api/staff/chat/conversations').length;
  const hiddenThread = callsFor('/api/staff/chat/conversations/chat-1', 'GET').length;
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(callsFor('/api/staff/chat/conversations')).toHaveLength(hiddenInbox);
  expect(callsFor('/api/staff/chat/conversations/chat-1', 'GET')).toHaveLength(hiddenThread);
});

it('renews confirmed availability every 30 seconds and keeps failures offline', async () => {
  vi.useFakeTimers();
  renderPanel();
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  fireEvent.click(screen.getByRole('button', { name: 'Go available' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  expect(screen.getByRole('button', { name: 'You are available' })).toBeInTheDocument();
  expect(callsFor('/api/staff/chat/presence')).toHaveLength(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(callsFor('/api/staff/chat/presence')).toHaveLength(2);
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation((input: RequestInfo | URL, options: RequestInit) => String(input) === '/api/staff/chat/presence' && JSON.parse(String(options.body)).available ? Promise.resolve(Response.json({ error: 'Unavailable' }, { status: 503 })) : original(input, options));
  await act(async () => { await vi.advanceTimersByTimeAsync(30_050); });
  expect(screen.queryByRole('button', { name: 'You are available' })).not.toBeInTheDocument();
  expect(screen.getByText('Availability could not be confirmed. Try again.')).toBeInTheDocument();
});

it('keeps a successful takeover when an earlier polling response arrives late', async () => {
  renderPanel(true);
  await loadedThread();
  const staleView = structuredClone(view);
  const original = fetchMock.getMockImplementation()!;
  let resolvePolling!: (response: Response) => void;
  let stall = true;
  fetchMock.mockImplementation((input: RequestInfo | URL, options: RequestInit) => {
    if (stall && String(input) === '/api/staff/chat/conversations/chat-1' && options.method === 'GET') {
      stall = false;
      return new Promise<Response>((resolve) => { resolvePolling = resolve; });
    }
    return original(input, options);
  });
  let polling!: Promise<void>;
  act(() => { polling = queryClient.refetchQueries({ queryKey: ['staff-chat-conversation', 'chat-1'] }); });
  await waitFor(() => expect(resolvePolling).toBeTypeOf('function'));
  fireEvent.click(within(thread()).getByRole('button', { name: 'Take over' }));
  await waitFor(() => expect(within(thread()).getByText('Assigned to Sam Dealer')).toBeInTheDocument());
  await act(async () => { resolvePolling(Response.json(staleView)); await polling; });
  expect(within(thread()).getByText('Assigned to Sam Dealer')).toBeInTheDocument();
});
