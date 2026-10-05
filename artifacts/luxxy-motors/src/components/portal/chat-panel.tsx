import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch, type StaffDirectory } from '@workspace/api-client-react';
import type { ChatConversation, ChatConversationView, ChatInbox, ChatSettings } from '@workspace/vehicle-meta';
import { Link, useLocation, useSearch } from 'wouter';
import { ArrowLeft, ArrowUpRight, CarFront, CheckCheck, Circle, LoaderCircle, Mail, MessageSquare, Phone, RefreshCw, Search, Send, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { HistoryLinks } from './history-links';
import { Chip, formatDateTime, relativeTime } from './portal-ui';
import './chat-panel.css';

const inboxKey = ['staff-chat-inbox'];
const conversationKey = (id: string) => ['staff-chat-conversation', id];
const request = <T,>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal) => customFetch<T>(path, {
  method, signal, ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
});
const statuses: Record<ChatConversation['status'], string> = {
  assistant: 'Assistant answering', waiting_staff: 'Waiting for staff', with_staff: 'With staff', resolved: 'Resolved',
};
type Filter = 'all' | 'waiting' | 'unread' | 'open' | 'resolved';
const filters: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' }, { value: 'waiting', label: 'Waiting' }, { value: 'unread', label: 'Unread' },
  { value: 'open', label: 'Open' }, { value: 'resolved', label: 'Resolved' },
];

function usePageVisible() {
  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

function errorStatus(error: unknown) {
  return error && typeof error === 'object' && 'status' in error ? error.status : null;
}

function Failure({ children, retry, label = 'Try again' }: { children: React.ReactNode; retry?: () => void; label?: string }) {
  return <div className="staff-chat-error" role="alert"><p>{children}</p>{retry && <Button type="button" variant="outline" size="sm" onClick={retry}><RefreshCw aria-hidden="true" />{label}</Button>}</div>;
}

function ConversationRow({ conversation, selected, onSelect }: { conversation: ChatConversation; selected: boolean; onSelect: () => void }) {
  return <li><button type="button" className="staff-chat-row" aria-current={selected ? 'true' : undefined} onClick={onSelect} data-testid={`chat-conversation-${conversation.id}`}>
    <span className="staff-chat-row-top"><strong>{conversation.customerName || 'Website visitor'}</strong><span className="staff-chat-row-time">{relativeTime(conversation.updatedAt)}</span></span>
    <span className="staff-chat-row-car">{conversation.vehicle?.title || 'General question'}</span>
    <span className="staff-chat-row-preview">{conversation.lastMessage || 'Conversation started'}</span>
    <span className="staff-chat-row-bottom"><span>{statuses[conversation.status]}</span>{conversation.unreadCount > 0 && <span className="staff-chat-unread" aria-label={`${conversation.unreadCount} unread messages`}>{conversation.unreadCount}</span>}</span>
  </button></li>;
}

function CustomerContext({ conversation }: { conversation: ChatConversation }) {
  const enquiryHref = conversation.enquiryId ? `/portal?section=enquiries&enquiryId=${encodeURIComponent(conversation.enquiryId)}` : null;
  return <section className="staff-chat-context" aria-label="Customer and vehicle details">
    <div className="staff-chat-contact">
      <h3><UserRound aria-hidden="true" />{conversation.customerName || 'Website visitor'}</h3>
      {conversation.email && <a href={`mailto:${conversation.email}`}><Mail aria-hidden="true" />{conversation.email}</a>}
      {conversation.phone && <a href={`tel:${conversation.phone}`}><Phone aria-hidden="true" />{conversation.phone}</a>}
      {!conversation.email && !conversation.phone && <p>Contact details have not been shared.</p>}
      {conversation.callbackRequested && <p className="staff-chat-callback"><Phone aria-hidden="true" />Callback requested</p>}
    </div>
    {conversation.vehicle && <div className="staff-chat-car">
      {conversation.vehicle.imageUrl ? <img src={conversation.vehicle.imageUrl} alt="" /> : <CarFront className="staff-chat-car-icon" aria-hidden="true" />}
      <div><h3>{conversation.vehicle.title}</h3>{conversation.vehicle.registration && <p>{conversation.vehicle.registration}</p>}{conversation.vehicle.price != null && <p>{new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(conversation.vehicle.price)}</p>}
        <Link href={conversation.vehicle.url}>View car<ArrowUpRight aria-hidden="true" /></Link>
      </div>
    </div>}
    <div className="staff-chat-context-links">
      <HistoryLinks vehicleId={conversation.vehicle?.id} recordType={conversation.enquiryId ? 'enquiry' : undefined} recordId={conversation.enquiryId || undefined} />
      {enquiryHref && <><Link href={enquiryHref}>Open enquiry<ArrowUpRight aria-hidden="true" /></Link><Link href={enquiryHref}>Book test drive<ArrowUpRight aria-hidden="true" /></Link></>}
    </div>
  </section>;
}

function ConversationThread({ view, directory, back, refresh, applyView, draft, setDraft }: {
  view: ChatConversationView; directory?: StaffDirectory; back: () => void; refresh: () => void;
  applyView: (view: ChatConversationView) => void; draft: string; setDraft: (value: string) => void;
}) {
  const conversation = view.conversation;
  const [actionError, setActionError] = useState<string | null>(null);
  const pendingMessage = useRef<{ body: string; clientMessageId: string } | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const messageCount = view.messages.length;
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'nearest' }); }, [messageCount]);
  const update = useMutation({
    mutationFn: (changes: { status?: ChatConversation['status']; assignedToId?: string | null }) => request<ChatConversationView>(`/api/staff/chat/conversations/${encodeURIComponent(conversation.id)}`, 'PATCH', { ...changes, expectedRevision: conversation.revision }),
    onMutate: () => setActionError(null),
    onSuccess: applyView,
    onError: (error) => {
      if (errorStatus(error) === 409 || errorStatus(error) === 412) {
        setActionError('This conversation changed while you were editing it. The latest details have been loaded. Review them and try again.');
        refresh();
      } else setActionError('The conversation could not be updated. Please try again.');
    },
  });
  const send = useMutation({
    mutationFn: ({ body, clientMessageId }: { body: string; clientMessageId: string }) => request<ChatConversationView>(`/api/staff/chat/conversations/${encodeURIComponent(conversation.id)}/messages`, 'POST', { body, clientMessageId }),
    onSuccess: (data) => { applyView(data); setDraft(''); pendingMessage.current = null; },
  });
  const submit = () => {
    const body = draft.trim();
    if (!body || body.length > 2000 || send.isPending) return;
    if (pendingMessage.current?.body !== body) pendingMessage.current = { body, clientMessageId: crypto.randomUUID() };
    send.mutate(pendingMessage.current);
  };
  const isResolved = conversation.status === 'resolved';
  return <article className="staff-chat-thread" aria-label="Selected chat conversation">
    <header className="staff-chat-thread-heading">
      <Button type="button" variant="ghost" className="staff-chat-back" onClick={back}><ArrowLeft aria-hidden="true" />Back to chats</Button>
      <div><p className="staff-chat-reference">{conversation.reference}</p><h2>{conversation.customerName || 'Website visitor'}</h2><div className="staff-chat-thread-meta"><Chip tone={isResolved ? 'muted' : conversation.status === 'waiting_staff' ? 'accent' : 'neutral'}>{statuses[conversation.status]}</Chip><span>{conversation.assignedToName ? `Assigned to ${conversation.assignedToName}` : 'Unassigned'}</span></div></div>
    </header>
    <CustomerContext conversation={conversation} />
    <section className="staff-chat-controls" aria-label="Staff conversation controls">
      <p>Staff controls</p>
      <div><Button type="button" variant="outline" disabled={update.isPending || !directory || (conversation.assignedToId === directory.currentUserId && conversation.status === 'with_staff')} onClick={() => directory && update.mutate({ assignedToId: directory.currentUserId, status: 'with_staff' })}><UserRound aria-hidden="true" />Take over</Button>
        <label className="staff-chat-assign"><span>Assign to</span><NativeSelect aria-label="Assign conversation to staff" value={conversation.assignedToId || ''} disabled={update.isPending || !directory} onChange={(event) => update.mutate({ assignedToId: event.target.value || null, ...(event.target.value ? { status: 'with_staff' as const } : {}) })}>
          <option value="">Unassigned</option>{directory?.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
        </NativeSelect></label>
        <Button type="button" variant="outline" disabled={update.isPending} onClick={() => update.mutate({ status: isResolved ? 'waiting_staff' : 'resolved' })}>{isResolved ? <MessageSquare aria-hidden="true" /> : <CheckCheck aria-hidden="true" />}{isResolved ? 'Reopen' : 'Resolve'}</Button>
      </div>
      {actionError && <Failure>{actionError}</Failure>}
    </section>
    <section className="staff-chat-transcript" aria-label="Chat messages">
      <p className="staff-chat-public-label">Conversation visible to the customer</p>
      {!view.messages.length && <p className="staff-chat-no-messages">No messages yet.</p>}
      <ol>{view.messages.map((message) => <li key={message.id} className={`staff-chat-message staff-chat-message-${message.authorRole}`}>
        <div className="staff-chat-message-meta"><strong>{message.authorRole === 'assistant' ? 'Showroom assistant' : message.authorRole === 'staff' ? message.authorName : message.authorName || 'Website visitor'}</strong><time dateTime={message.createdAt}>{formatDateTime(message.createdAt)}</time></div>
        <p>{message.body}</p>
        {message.actions.length > 0 && <div className="staff-chat-message-actions">{message.actions.map((action, index) => <a key={`${action.href}-${index}`} href={action.href}>{action.label}<ArrowUpRight aria-hidden="true" /></a>)}</div>}
      </li>)}</ol><div ref={end} />
    </section>
    <form className="staff-chat-composer" onSubmit={(event) => { event.preventDefault(); submit(); }}>
      <label htmlFor={`reply-${conversation.id}`}>Reply to customer</label>
      <Textarea id={`reply-${conversation.id}`} value={draft} onChange={(event) => { setDraft(event.target.value); if (send.isError) send.reset(); }} maxLength={2000} disabled={isResolved || send.isPending} placeholder={isResolved ? 'Reopen this conversation to reply.' : 'Write your reply…'} rows={3} />
      {send.isError && <Failure retry={submit} label="Retry sending">Your reply could not be sent. It is saved here so you can try again.</Failure>}
      <div><p>Your name is shown with this reply.</p><span>{draft.length}/2000</span><Button type="submit" disabled={!draft.trim() || isResolved || send.isPending}>{send.isPending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}{send.isPending ? 'Sending…' : 'Send reply'}</Button></div>
    </form>
  </article>;
}

export function ChatPanel() {
  const visible = usePageVisible();
  const search = useSearch();
  const [, navigate] = useLocation();
  const selectedId = new URLSearchParams(search).get('conversationId');
  const queryClient = useQueryClient();
  const [term, setTerm] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [wantOnline, setWantOnline] = useState(false);
  const [confirmedOnline, setConfirmedOnline] = useState(false);
  const [presenceConfirmed, setPresenceConfirmed] = useState(false);
  const [presenceError, setPresenceError] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const attemptedReads = useRef(new Set<string>());
  const inbox = useQuery({ queryKey: inboxKey, queryFn: async ({ signal }) => {
    const result = await request<ChatInbox>('/api/staff/chat/conversations', 'GET', undefined, signal);
    const current = queryClient.getQueryData<ChatInbox>(inboxKey);
    const conversations = result.conversations.map((item) => {
      const newer = current?.conversations.find((existing) => existing.id === item.id && existing.revision > item.revision);
      return newer || item;
    });
    return { ...result, conversations, totalUnread: conversations.reduce((total, item) => total + item.unreadCount, 0) };
  }, enabled: visible, retry: false, refetchInterval: visible ? 10_000 : false });
  const thread = useQuery({ queryKey: conversationKey(selectedId || ''), queryFn: async ({ signal }) => {
    const result = await request<ChatConversationView>(`/api/staff/chat/conversations/${encodeURIComponent(selectedId!)}`, 'GET', undefined, signal);
    const current = queryClient.getQueryData<ChatConversationView>(conversationKey(selectedId!));
    return current && current.conversation.revision > result.conversation.revision ? current : result;
  }, enabled: Boolean(selectedId) && visible, retry: false, refetchInterval: visible ? 5_000 : false });
  const directory = useQuery({ queryKey: ['staff-directory'], queryFn: ({ signal }) => request<StaffDirectory>('/api/staff/directory', 'GET', undefined, signal), retry: false, staleTime: 60_000 });
  const settings = useQuery({ queryKey: ['staff-chat-settings'], queryFn: ({ signal }) => request<ChatSettings>('/api/staff/chat/settings', 'GET', undefined, signal), retry: false, staleTime: 60_000 });
  const applyView = (view: ChatConversationView) => {
    queryClient.setQueryData<ChatConversationView>(conversationKey(view.conversation.id), (old) => old && old.conversation.revision > view.conversation.revision ? old : view);
    queryClient.setQueryData<ChatInbox>(inboxKey, (old) => {
      if (!old) return old;
      const conversations = old.conversations.map((item) => item.id === view.conversation.id && item.revision <= view.conversation.revision ? view.conversation : item);
      return { ...old, conversations, totalUnread: conversations.reduce((total, item) => total + item.unreadCount, 0) };
    });
  };
  const read = useMutation({
    mutationFn: (id: string) => request<ChatConversationView>(`/api/staff/chat/conversations/${encodeURIComponent(id)}/read`, 'POST'),
    onSuccess: (view) => { applyView(view); setReadError(null); },
    onError: (_error, id) => setReadError(id),
  });
  useEffect(() => {
    setReadError(null);
  }, [selectedId]);
  useEffect(() => {
    const conversation = thread.data?.conversation;
    if (!visible || !conversation || !selectedId || conversation.id !== selectedId || !conversation.unreadCount || read.isPending) return;
    const key = `${conversation.id}:${conversation.revision}:${conversation.updatedAt}`;
    if (attemptedReads.current.has(key)) return;
    attemptedReads.current.add(key);
    read.mutate(conversation.id);
  }, [selectedId, visible, thread.data, read.isPending]);
  useEffect(() => {
    if (!wantOnline || !visible) { setConfirmedOnline(false); setPresenceConfirmed(false); return; }
    let active = true;
    let inFlight = false;
    const heartbeat = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const result = await request<{ staffOnline: boolean }>('/api/staff/chat/presence', 'POST', { available: true });
        if (active) { setConfirmedOnline(result.staffOnline); setPresenceConfirmed(true); setPresenceError(false); }
      } catch {
        if (active) { setConfirmedOnline(false); setPresenceConfirmed(false); setPresenceError(true); setWantOnline(false); }
      } finally {
        inFlight = false;
        if (!active) void request('/api/staff/chat/presence', 'POST', { available: false }).catch(() => {});
      }
    };
    void heartbeat();
    const timer = window.setInterval(heartbeat, 30_000);
    const leave = () => { void customFetch('/api/staff/chat/presence', { method: 'POST', body: JSON.stringify({ available: false }), keepalive: true }).catch(() => {}); };
    window.addEventListener('pagehide', leave);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('pagehide', leave); leave(); };
  }, [wantOnline, visible]);
  const select = (id: string | null) => {
    const params = new URLSearchParams(search);
    params.set('section', 'chat');
    if (id) params.set('conversationId', id); else params.delete('conversationId');
    navigate(`/portal?${params}`);
  };
  const conversations = useMemo(() => (inbox.data?.conversations || []).filter((conversation) => {
    const haystack = [conversation.customerName, conversation.email, conversation.phone, conversation.reference, conversation.vehicle?.title, conversation.vehicle?.registration].filter(Boolean).join(' ').toLocaleLowerCase();
    const words = term.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const matches = words.every((word) => haystack.includes(word) || haystack.replace(/[^\p{L}\p{N}@]/gu, '').includes(word.replace(/[^\p{L}\p{N}@]/gu, '')));
    return matches && (filter === 'all' || (filter === 'waiting' && conversation.status === 'waiting_staff') || (filter === 'unread' && conversation.unreadCount > 0) || (filter === 'open' && conversation.status !== 'resolved') || (filter === 'resolved' && conversation.status === 'resolved'));
  }), [inbox.data, term, filter]);
  const totalUnread = inbox.data?.totalUnread || 0;
  return <section className={`staff-chat ${selectedId ? 'staff-chat-has-selection' : ''}`} aria-label="Website chat inbox">
    <header className="staff-chat-heading"><div><p>Website conversations</p><h2>Chat inbox{totalUnread > 0 && settings.data?.notificationsEnabled !== false && <span className="staff-chat-unread" aria-label={`${totalUnread} unread messages in inbox`}>{totalUnread}</span>}</h2><p>Answer questions, arrange a callback and keep the conversation together.</p></div>
      <div className="staff-chat-presence"><Button type="button" variant={confirmedOnline ? 'default' : 'outline'} aria-pressed={wantOnline} onClick={() => { setPresenceError(false); setWantOnline(!wantOnline); }}><Circle aria-hidden="true" className={confirmedOnline ? 'staff-chat-online-dot' : ''} />{confirmedOnline ? 'You are available' : wantOnline ? presenceConfirmed ? 'Availability set' : 'Connecting…' : 'Go available'}</Button><p>{confirmedOnline ? 'Customers can request a live reply.' : wantOnline && presenceConfirmed ? 'Live chat is shown during the showroom’s published opening hours.' : 'Switch on while you can answer live chats.'}</p>{presenceError && <p role="alert">Availability could not be confirmed. Try again.</p>}</div>
    </header>
    <div className="staff-chat-workspace">
      <aside className="staff-chat-directory" aria-label="Chat conversations">
        <div className="staff-chat-search"><Search aria-hidden="true" /><Input aria-label="Search chats" placeholder="Name, car or contact details" value={term} onChange={(event) => setTerm(event.target.value)} /></div>
        <div className="staff-chat-filters" role="group" aria-label="Filter chat conversations">{filters.map((item) => <button key={item.value} type="button" aria-pressed={filter === item.value} onClick={() => setFilter(item.value)}>{item.label}</button>)}</div>
        {inbox.isPending && <p className="staff-chat-empty" role="status"><LoaderCircle className="animate-spin" aria-hidden="true" />Loading conversations…</p>}
        {inbox.isError && <Failure retry={() => void inbox.refetch()}>{inbox.data ? 'The inbox could not be refreshed. Showing the last loaded conversations.' : 'Conversations could not be loaded.'}</Failure>}
        {!inbox.isPending && !inbox.isError && !conversations.length && <div className="staff-chat-empty"><MessageSquare aria-hidden="true" /><h3>{term || filter !== 'all' ? 'No matching conversations' : 'No conversations yet'}</h3><p>{term || filter !== 'all' ? 'Try a different search or filter.' : 'Customer chats will appear here.'}</p>{(term || filter !== 'all') && <Button variant="outline" onClick={() => { setTerm(''); setFilter('all'); }}>Clear filters</Button>}</div>}
        <ul className="staff-chat-list">{conversations.map((conversation) => <ConversationRow key={conversation.id} conversation={conversation} selected={conversation.id === selectedId} onSelect={() => select(conversation.id)} />)}</ul>
      </aside>
      <div className="staff-chat-detail">
        {!selectedId && <div className="staff-chat-empty staff-chat-select-prompt"><MessageSquare aria-hidden="true" /><h3>Select a conversation</h3><p>Messages and customer details appear here.</p></div>}
        {selectedId && thread.isPending && <p className="staff-chat-empty" role="status"><LoaderCircle className="animate-spin" aria-hidden="true" />Loading conversation…</p>}
        {selectedId && thread.isError && <Failure retry={() => void thread.refetch()}>{errorStatus(thread.error) === 404 ? 'This conversation could not be found.' : thread.data ? 'The conversation could not be refreshed. Showing the last loaded messages.' : 'This conversation could not be loaded.'}</Failure>}
        {selectedId && !thread.data && <Button type="button" variant="ghost" onClick={() => select(null)}><ArrowLeft aria-hidden="true" />Back to chats</Button>}
        {selectedId && readError === selectedId && <Failure retry={() => read.mutate(selectedId)} label="Mark as read">The conversation could not be marked as read.</Failure>}
        {selectedId && directory.isError && <Failure retry={() => void directory.refetch()}>Staff assignments could not be loaded.</Failure>}
        {selectedId && thread.data && <ConversationThread key={selectedId} view={thread.data} directory={directory.data} back={() => select(null)} refresh={() => void thread.refetch()} applyView={applyView} draft={drafts[selectedId] || ''} setDraft={(value) => setDrafts((old) => ({ ...old, [selectedId]: value }))} />}
      </div>
    </div>
  </section>;
}
