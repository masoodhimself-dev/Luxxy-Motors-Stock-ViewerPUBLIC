import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Link, useLocation, useRoute } from 'wouter';
import { ArrowRight, Check, ChevronDown, MessageCircle, Send, X } from 'lucide-react';
import { formatVehicleName, type ChatConversationView, type ChatPublicConfig, type ChatSession } from '@workspace/vehicle-meta';
import { useStock } from '@/lib/stock-context';
import './customer-chat.css';

interface SavedChat {
  id: string;
  token: string;
  title: string;
  updatedAt: string;
}

interface PendingMessage {
  body: string;
  id: string;
  vehicleId: string | null;
  conversationId: string | null;
  token: string;
}

interface PendingStart {
  id: string;
  token: string;
  vehicleId: string | null;
}

const MAX_RECENT_CHATS = 5;
const SESSION_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
const POLL_INTERVAL = 6_000;

export function routeAllowsCustomerChat(location: string) {
  return ['/', '/stock', '/saved', '/compare', '/contact', '/warranty'].includes(location)
    || /^\/vehicle\/[^/]+\/?$/.test(location);
}

/** Tokens are private to a single dealership on a single origin. */
export function customerChatStorageKey(dealerName: string, origin = window.location.origin) {
  return `dealer.chat.v1:${encodeURIComponent(origin)}:${encodeURIComponent(dealerName)}`;
}

function readSavedChats(key: string): SavedChat[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is SavedChat => (
      item && typeof item === 'object'
      && typeof item.id === 'string' && item.id.length > 0 && item.id.length < 150
      && typeof item.token === 'string' && item.token.length > 0 && item.token.length < 500
      && typeof item.title === 'string' && item.title.length < 300
      && typeof item.updatedAt === 'string'
      && Number.isFinite(Date.parse(item.updatedAt))
      && Date.now() - Date.parse(item.updatedAt) < SESSION_MAX_AGE
    )).slice(0, MAX_RECENT_CHATS);
  } catch {
    return [];
  }
}

function writeSavedChats(key: string, chats: SavedChat[]) {
  try { window.localStorage.setItem(key, JSON.stringify(chats)); } catch { /* Chat still works if storage is unavailable. */ }
}

function messageId() {
  return window.crypto?.randomUUID?.() ?? `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function sessionToken() {
  const bytes = window.crypto.getRandomValues(new Uint8Array(32));
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

class ChatRequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function requestChat<T>(path: string, options: { method?: 'POST'; body?: unknown; token?: string; signal?: AbortSignal } = {}): Promise<T> {
  const response = await fetch(`/api/chat${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.token ? { 'X-Chat-Token': options.token } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    signal: options.signal,
  });
  if (!response.ok) {
    throw new ChatRequestError(
      response.status === 429 ? 'Please give it a moment, then try again.'
        : response.status === 503 ? 'Chat is unavailable just now. Please try again shortly.'
          : 'That didn’t go through. Please try again.',
      response.status,
    );
  }
  return response.json() as Promise<T>;
}

function isExpiredSession(error: unknown) {
  return error instanceof ChatRequestError && [401, 403, 404, 410].includes(error.status);
}

function isAbort(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

function hasChatContact(conversation: ChatConversationView['conversation'] | undefined) {
  return Boolean(conversation && (conversation.customerName?.trim().length ?? 0) >= 2
    && ((conversation.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(conversation.email))
      || (conversation.phone && /^\+?\d{7,15}$/.test(conversation.phone.replace(/[\s().\-/]/g, '')))));
}

/** Only public website actions can leave a server-provided chat message. */
export function safeChatAction(href: string): string | null {
  if (!href.startsWith('/') || href.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(href)) return null;
  const path = href.split(/[?#]/, 1)[0];
  if (!['/', '/stock', '/contact', '/enquire', '/warranty'].includes(path) && !/^\/vehicle\/[^/]+\/?$/.test(path)) return null;
  return href;
}

function availabilityCopy(config: ChatPublicConfig | null, view: ChatConversationView | null) {
  const availability = view?.availability ?? config?.availability;
  if (view?.conversation.status === 'with_staff') return view.conversation.assignedToName
    ? `Your conversation is with ${view.conversation.assignedToName}`
    : 'Your conversation is with the showroom team';
  if (view?.conversation.status === 'waiting_staff') return 'Your question is with the showroom team';
  if (view?.conversation.status === 'resolved') return 'Conversation complete · ask us anything else';
  if (availability?.staffOnline) return 'Showroom team available';
  if (availability?.showroomState === 'closed') return availability.nextOpening
    ? `Showroom closed · opens ${availability.nextOpening}`
    : 'Showroom closed · leave us a question';
  return 'Questions welcome · the team will reply when available';
}

export function CustomerChat() {
  const [location] = useLocation();
  const [, vehicleRoute] = useRoute<{ id: string }>('/vehicle/:id');
  const { stock } = useStock();
  const currentCar = vehicleRoute?.id ? stock?.cars.find((car) => car.id === vehicleRoute.id) ?? null : null;
  const allowedRoute = routeAllowsCustomerChat(location);
  const [config, setConfig] = useState<ChatPublicConfig | null>(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ChatConversationView | null>(null);
  const [active, setActive] = useState<SavedChat | null>(null);
  const [recent, setRecent] = useState<SavedChat[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  const [showContact, setShowContact] = useState(false);
  const [contactMethod, setContactMethod] = useState<'email' | 'phone'>('phone');
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [callbackRequested, setCallbackRequested] = useState(false);
  const [contactSaved, setContactSaved] = useState(false);
  const [viewport, setViewport] = useState<CSSProperties>({});
  const [storageReady, setStorageReady] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const configRef = useRef<ChatPublicConfig | null>(null);
  const scopeRef = useRef<string | null>(null);
  const activeRef = useRef<SavedChat | null>(null);
  const sessionGeneration = useRef(0);
  const busyRef = useRef(false);
  const pendingRef = useRef<PendingMessage | null>(null);
  const pendingStartRef = useRef<PendingStart | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const titleId = useId();
  const statusId = useId();
  const storageKey = config ? customerChatStorageKey(config.dealerName) : null;
  const conversation = view?.conversation;
  const hasContact = hasChatContact(conversation);
  const needsContact = !active || Boolean(conversation && !hasContact);
  const showContactForm = needsContact || showContact;
  const chatReady = Boolean(active && conversation && hasContact);

  useEffect(() => {
    if (!allowedRoute) { setOpen(false); return; }
    const controller = new AbortController();
    const refresh = () => {
      void requestChat<ChatPublicConfig>('/config', { signal: controller.signal })
        .then((next) => {
          configRef.current = next;
          setConfig(next);
          if (!next.settings.enabled) setOpen(false);
        }).catch(() => { /* An unavailable configuration must never open an unconfigured chat. */ });
    };
    refresh();
    window.addEventListener('dealer-chat-settings-saved', refresh);
    return () => { controller.abort(); window.removeEventListener('dealer-chat-settings-saved', refresh); };
  }, [allowedRoute, offline]);

  useEffect(() => {
    if (!open || offline) return;
    const controller = new AbortController();
    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      void requestChat<ChatPublicConfig>('/config', { signal: controller.signal }).then((next) => {
        configRef.current = next;
        setConfig(next);
        if (!next.settings.enabled) setOpen(false);
      }).catch(() => { /* The existing config remains usable through a temporary connection failure. */ });
    };
    refresh();
    const interval = window.setInterval(refresh, 30_000);
    return () => { controller.abort(); window.clearInterval(interval); };
  }, [open, offline]);

  useEffect(() => {
    if (!storageKey) return;
    if (scopeRef.current === storageKey) return;
    controllerRef.current?.abort();
    sessionGeneration.current += 1;
    pendingRef.current = null;
    pendingStartRef.current = null;
    const chats = readSavedChats(storageKey);
    scopeRef.current = storageKey;
    setRecent(chats);
    setActive(chats[0] ?? null);
    activeRef.current = chats[0] ?? null;
    setView(null);
    setDraft('');
    setError('');
    setRefreshError('');
    setShowContact(false);
    setContactSaved(false);
    setName('');
    setContact('');
    setContactMethod('phone');
    setCallbackRequested(false);
    setStorageReady(true);
  }, [storageKey]);

  useEffect(() => {
    const online = () => setOffline(false);
    const disconnected = () => setOffline(true);
    window.addEventListener('online', online);
    window.addEventListener('offline', disconnected);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', disconnected);
      controllerRef.current?.abort();
      sessionGeneration.current += 1;
    };
  }, []);

  const remember = useCallback((saved: SavedChat) => {
    const key = scopeRef.current;
    if (!key) return;
    setRecent((previous) => {
      const next = [saved, ...previous.filter((entry) => entry.id !== saved.id)].slice(0, MAX_RECENT_CHATS);
      writeSavedChats(key, next);
      return next;
    });
  }, []);

  const forget = useCallback((id: string) => {
    const key = scopeRef.current;
    setRecent((previous) => {
      const next = previous.filter((entry) => entry.id !== id);
      if (key) writeSavedChats(key, next);
      return next;
    });
  }, []);

  const acceptView = useCallback((next: ChatConversationView) => {
    setView((previous) => previous?.conversation.id === next.conversation.id && previous.conversation.revision > next.conversation.revision ? previous : next);
  }, []);

  // The panel never polls a customer's conversation until they choose to open it.
  useEffect(() => {
    if (!open || !allowedRoute || !config?.settings.enabled || !active || offline) return;
    const controller = new AbortController();
    const generation = sessionGeneration.current;
    let inFlight = false;
    let disposed = false;
    const refresh = async () => {
      if (disposed || inFlight || document.visibilityState === 'hidden' || busyRef.current) return;
      inFlight = true;
      try {
        const next = await requestChat<ChatConversationView>(`/conversations/${encodeURIComponent(active.id)}`, { token: active.token, signal: controller.signal });
        if (disposed || generation !== sessionGeneration.current) return;
        acceptView(next);
        setRefreshError('');
        setLoading(false);
      } catch (cause) {
        if (disposed || isAbort(cause) || generation !== sessionGeneration.current) return;
        setLoading(false);
        if (isExpiredSession(cause)) {
          forget(active.id);
          activeRef.current = null;
          setActive(null);
          setView(null);
          pendingRef.current = null;
          setError('This saved chat is no longer available. You can start a new one below.');
        } else {
          setRefreshError('We couldn’t refresh your chat. Your messages are still here; we’ll try again.');
        }
      } finally { inFlight = false; }
    };
    setLoading(!view || view.conversation.id !== active.id);
    void refresh();
    const interval = window.setInterval(() => void refresh(), POLL_INTERVAL);
    const onVisible = () => { if (document.visibilityState !== 'hidden') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // A message revision does not restart the polling clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, allowedRoute, config?.settings.enabled, active?.id, active?.token, offline, acceptView, forget]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    panel?.querySelector<HTMLButtonElement>('[data-chat-close]')?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
      if (event.key !== 'Tab' || !panel) return;
      const controls = Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]')).filter((control) => !control.closest('[hidden]'));
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!panel.contains(document.activeElement)) { event.preventDefault(); first?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    const updateViewport = () => {
      const visible = window.visualViewport;
      setViewport(visible ? { top: visible.offsetTop, height: visible.height, '--chat-viewport-height': `${visible.height}px` } as CSSProperties : {});
    };
    updateViewport();
    window.visualViewport?.addEventListener('resize', updateViewport);
    window.visualViewport?.addEventListener('scroll', updateViewport);
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.visualViewport?.removeEventListener('resize', updateViewport);
      window.visualViewport?.removeEventListener('scroll', updateViewport);
      document.removeEventListener('keydown', onKey);
      buttonRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    const messages = messagesRef.current;
    if (!messages || !open || showContactForm) return;
    messages.scrollTop = messages.scrollHeight;
  }, [open, view?.messages.length, showContactForm]);

  useEffect(() => {
    if (showContactForm && messagesRef.current) messagesRef.current.scrollTop = 0;
  }, [showContactForm]);

  // Previously anonymous chats keep their transcript, but need details before continuing.
  useEffect(() => {
    if (!conversation || !needsContact) return;
    setName(conversation.customerName ?? '');
    setContactMethod(conversation.phone ? 'phone' : conversation.email ? 'email' : 'phone');
    setContact(conversation.phone ?? conversation.email ?? '');
    setCallbackRequested(conversation.callbackRequested);
    // Polling must not replace details while the customer is typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation?.id, needsContact]);

  function startFresh() {
    if (busyRef.current) return;
    controllerRef.current?.abort();
    sessionGeneration.current += 1;
    activeRef.current = null;
    setActive(null);
    setView(null);
    setDraft('');
    pendingRef.current = null;
    pendingStartRef.current = null;
    setError('');
    setRefreshError('');
    setShowContact(false);
    setContactSaved(false);
    setName('');
    setContact('');
    setContactMethod('phone');
    setCallbackRequested(false);
    setLoading(false);
    requestAnimationFrame(() => nameRef.current?.focus());
  }

  function selectConversation(id: string) {
    if (busyRef.current) return;
    const saved = recent.find((entry) => entry.id === id);
    if (!saved || saved.id === activeRef.current?.id) return;
    controllerRef.current?.abort();
    sessionGeneration.current += 1;
    activeRef.current = saved;
    setActive(saved);
    setView(null);
    setDraft('');
    setError('');
    setRefreshError('');
    setShowContact(false);
    setContactSaved(false);
    setName('');
    setContact('');
    setContactMethod('phone');
    setCallbackRequested(false);
    pendingRef.current = null;
    pendingStartRef.current = null;
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || busyRef.current || offline || loading || !configRef.current?.settings.enabled) return;
    const saved = activeRef.current;
    if (!saved || !hasContact) return;
    const existingPending = pendingRef.current;
    const pending = existingPending && existingPending.body === body && existingPending.conversationId === saved.id
      ? existingPending
      : { body, id: messageId(), vehicleId: currentCar?.id ?? null, conversationId: saved.id, token: saved.token };
    pendingRef.current = pending;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setRefreshError('');
    const controller = new AbortController();
    controllerRef.current = controller;
    const generation = sessionGeneration.current;
    try {
      const next = await requestChat<ChatConversationView>(`/conversations/${encodeURIComponent(saved.id)}/messages`, {
        method: 'POST', token: saved.token, signal: controller.signal,
        body: { body: pending.body, clientMessageId: pending.id },
      });
      if (generation !== sessionGeneration.current) return;
      acceptView(next);
      remember({ ...saved, updatedAt: next.conversation.updatedAt });
      setDraft('');
      pendingRef.current = null;
    } catch (cause) {
      if (isAbort(cause) || generation !== sessionGeneration.current) return;
      if (saved && isExpiredSession(cause)) {
        forget(saved.id);
        activeRef.current = null;
        setActive(null);
        setView(null);
        pendingRef.current = null;
        setError('This chat is no longer available. Your question is ready to send in a new chat.');
      } else {
        setError(cause instanceof ChatRequestError ? cause.message : 'That didn’t go through. Your question is saved below — try again when you’re connected.');
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function sessionAction(path: 'handover' | 'contact', body?: unknown) {
    const saved = activeRef.current;
    if (!saved || busyRef.current || offline || loading || (path === 'handover' && !hasContact)) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setRefreshError('');
    const controller = new AbortController();
    controllerRef.current = controller;
    const generation = sessionGeneration.current;
    try {
      const next = await requestChat<ChatConversationView>(`/conversations/${encodeURIComponent(saved.id)}/${path}`, {
        method: 'POST', token: saved.token, body: body ?? {}, signal: controller.signal,
      });
      if (generation !== sessionGeneration.current) return;
      acceptView(next);
      remember({ ...saved, updatedAt: next.conversation.updatedAt });
      if (path === 'contact') { setShowContact(false); setContactSaved(true); requestAnimationFrame(() => inputRef.current?.focus()); }
    } catch (cause) {
      if (!isAbort(cause) && generation === sessionGeneration.current) {
        setError(cause instanceof ChatRequestError ? cause.message : 'We couldn’t save that. Please try again when you’re connected.');
      }
    } finally { busyRef.current = false; setBusy(false); }
  }

  async function submitContact(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current || offline || loading || !configRef.current?.settings.enabled) return;
    const customerName = name.trim();
    const value = contactMethod === 'phone' ? contact.trim().replace(/[\s().\-/]/g, '') : contact.trim().toLowerCase();
    if (customerName.length < 2) { setError('Enter your name so the team knows who they’re speaking to.'); nameRef.current?.focus(); return; }
    if (contactMethod === 'phone' ? !/^\+?\d{7,15}$/.test(value) : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError(contactMethod === 'phone' ? 'Enter a valid phone number so the team can reach you.' : 'Enter a valid email address so the team can reach you.');
      return;
    }
    const details = { name: customerName, [contactMethod]: value };
    if (activeRef.current) {
      await sessionAction('contact', { ...details, callbackRequested: contactMethod === 'phone' && callbackRequested });
      return;
    }
    const pending = pendingStartRef.current ?? { id: messageId(), token: sessionToken(), vehicleId: currentCar?.id ?? null };
    pendingStartRef.current = pending;
    busyRef.current = true;
    setBusy(true);
    setError('');
    setRefreshError('');
    const controller = new AbortController();
    controllerRef.current = controller;
    const generation = sessionGeneration.current;
    try {
      const next = await requestChat<ChatSession>('/conversations', {
        method: 'POST', token: pending.token, signal: controller.signal,
        body: { ...details, requestId: pending.id, ...(pending.vehicleId ? { vehicleId: pending.vehicleId } : {}) },
      });
      if (generation !== sessionGeneration.current) return;
      const savedChat = { id: next.conversation.id, token: next.sessionToken, title: next.conversation.vehicle?.title ?? 'Showroom questions', updatedAt: next.conversation.updatedAt };
      activeRef.current = savedChat;
      setActive(savedChat);
      acceptView(next);
      remember(savedChat);
      pendingStartRef.current = null;
      setShowContact(false);
      setContactSaved(false);
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch (cause) {
      if (isAbort(cause) || generation !== sessionGeneration.current) return;
      setError(cause instanceof ChatRequestError ? cause.message : 'We couldn’t start your chat. Your details are still here — please try again when you’re connected.');
    } finally { busyRef.current = false; setBusy(false); }
  }

  if (!allowedRoute || !config?.settings.enabled || !storageReady) return null;
  const sessionCar = conversation?.vehicle;
  const differentCar = Boolean(currentCar && conversation && currentCar.id !== sessionCar?.id);
  const subject = sessionCar?.title ?? (!active && currentCar ? formatVehicleName(currentCar) : active?.title ?? null);
  const waitingForTeam = conversation?.status === 'waiting_staff' || conversation?.status === 'with_staff';
  const suggestions = currentCar || sessionCar ? ['What’s the mileage?', 'Can I book a test drive?'] : ['When are you open?', 'Can I book a test drive?'];

  return (
    <div className="customer-chat" data-testid="customer-chat">
      <button ref={buttonRef} type="button" className="customer-chat__launcher" aria-label={config.settings.buttonLabel || 'Ask us'} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <MessageCircle size={18} aria-hidden="true" />
        <span>{config.settings.buttonLabel || 'Ask us'}</span>
      </button>
      {open && (
        <div className="customer-chat__overlay" style={viewport} onPointerDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <section ref={panelRef} className="customer-chat__panel" data-contact-required={needsContact} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={statusId}>
            <header className="customer-chat__header">
              <div>
                <h2 id={titleId}>{config.dealerName || 'Showroom'} chat</h2>
                <p className="customer-chat__identity">Showroom assistant</p>
              </div>
              <button type="button" className="customer-chat__icon-button" aria-label="Close chat" data-chat-close onClick={() => setOpen(false)}><X size={20} aria-hidden="true" /></button>
            </header>
            <p id={statusId} className="customer-chat__availability">{availabilityCopy(config, view)}</p>
            {subject && <div className="customer-chat__subject"><span>About</span><strong>{subject}</strong></div>}
            {differentCar && <div className="customer-chat__car-change"><span>Looking at {formatVehicleName(currentCar!)}?</span><button type="button" disabled={busy} onClick={startFresh}>Ask about this car <ArrowRight size={14} aria-hidden="true" /></button></div>}
            <div ref={messagesRef} className="customer-chat__messages">
              <div role="log" aria-label="Chat messages" aria-live="polite" aria-relevant="additions text" hidden={showContactForm}>
              {loading && <p className="customer-chat__notice" role="status">Opening your conversation…</p>}
              {!view && !loading && <div className="customer-chat__welcome"><p>{config.settings.greeting}</p><span>Ask a question about a car, arrange a viewing, or leave a message for the team.</span></div>}
              {view?.messages.map((message) => (
                <article key={message.id} className={`customer-chat__message customer-chat__message--${message.authorRole}`}>
                  <div className="customer-chat__message-author">{message.authorRole === 'customer' ? 'You' : message.authorRole === 'assistant' ? 'Showroom assistant' : message.authorName || 'Showroom team'}<time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</time></div>
                  <p>{message.body}</p>
                  {message.actions.filter((action) => safeChatAction(action.href)).length > 0 && <div className="customer-chat__actions">{message.actions.map((action) => {
                    const href = safeChatAction(action.href);
                    return href ? <Link key={`${action.kind}-${href}`} href={href} onClick={() => setOpen(false)}>{action.label}<ArrowRight size={14} aria-hidden="true" /></Link> : null;
                  })}</div>}
                </article>
              ))}
              {contactSaved && <p className="customer-chat__notice customer-chat__saved" role="status"><Check size={15} aria-hidden="true" /> Your details are saved for the showroom team.</p>}
              </div>
            {showContactForm && !loading && <form className="customer-chat__contact" aria-label="Chat contact details" onSubmit={event => void submitContact(event)}>
              <div className="customer-chat__contact-heading"><h3>{needsContact ? active ? 'Before we continue' : 'Let’s get you started' : 'Update your contact details'}</h3>{!needsContact && <button type="button" className="customer-chat__icon-button" aria-label="Close contact form" onClick={() => setShowContact(false)}><X size={16} aria-hidden="true" /></button>}</div>
              {needsContact && <p className="customer-chat__contact-intro">Add your name and a phone number or email so the showroom can get back to you.</p>}
              <label>Name<input ref={nameRef} value={name} minLength={2} maxLength={120} autoComplete="name" required disabled={busy} onChange={(event) => { setName(event.target.value); setError(''); }} /></label>
              <div className="customer-chat__contact-method"><label>Reply by<select value={contactMethod} disabled={busy} onChange={(event) => { setContactMethod(event.target.value as 'email' | 'phone'); setContact(''); setError(''); }}><option value="phone">Phone</option><option value="email">Email</option></select></label><label>{contactMethod === 'email' ? 'Email address' : 'Phone number'}<input value={contact} type={contactMethod === 'email' ? 'email' : 'tel'} inputMode={contactMethod === 'email' ? 'email' : 'tel'} autoComplete={contactMethod === 'email' ? 'email' : 'tel'} maxLength={contactMethod === 'email' ? 254 : 40} required disabled={busy} onChange={(event) => { setContact(event.target.value); setError(''); }} /></label></div>
              {!needsContact && contactMethod === 'phone' && <label className="customer-chat__checkbox"><input type="checkbox" checked={callbackRequested} disabled={busy} onChange={(event) => setCallbackRequested(event.target.checked)} />I’d like a callback</label>}
              <p className="customer-chat__contact-privacy">We’ll use these details to respond to your enquiry.</p>
              <button className="customer-chat__primary-button" type="submit" disabled={busy || offline}>{busy ? active ? 'Saving…' : 'Starting…' : needsContact ? active ? 'Continue to chat' : 'Start chat' : 'Save contact details'}</button>
            </form>}
            </div>
            <div className="customer-chat__footer">
              {offline && <p className="customer-chat__error" role="status">You’re offline. Your question will stay here until you’re connected.</p>}
              {(error || refreshError) && <p className="customer-chat__error" role="alert">{error || refreshError}</p>}
              {!showContactForm && chatReady && !draft && !loading && !view?.messages.some(message => message.authorRole === 'customer') && <div className="customer-chat__suggestions" aria-label="Suggested questions">{suggestions.map((question) => <button key={question} type="button" onClick={() => { setDraft(question); inputRef.current?.focus(); }}>{question}</button>)}</div>}
              {!showContactForm && chatReady && <form className="customer-chat__composer" onSubmit={sendMessage}>
                <label className="sr-only" htmlFor={`${titleId}-message`}>Your question</label>
                <textarea ref={inputRef} id={`${titleId}-message`} rows={2} maxLength={2000} value={draft} placeholder="What would you like to know?" disabled={loading || busy} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
                <button type="submit" aria-label={busy ? 'Sending message' : error && pendingRef.current ? 'Retry sending message' : 'Send message'} disabled={busy || loading || offline || !draft.trim()}><Send size={18} aria-hidden="true" /></button>
              </form>}
              {!showContactForm && chatReady && !loading && <div className="customer-chat__follow-up">
                {!waitingForTeam && <button type="button" disabled={busy || offline} onClick={() => { void sessionAction('handover'); }}>{config.availability.staffOnline ? 'Speak to the team' : 'Ask the team to reply'}</button>}
                <button type="button" disabled={busy} onClick={() => { setName(conversation?.customerName ?? ''); setContactMethod(conversation?.phone ? 'phone' : 'email'); setContact(conversation?.phone ?? conversation?.email ?? ''); setCallbackRequested(conversation?.callbackRequested ?? false); setShowContact((previous) => !previous); }}>Contact details</button>
              </div>}
              {config.availability.showroomState === 'closed' && !active && <p className="customer-chat__contact-hint">{config.settings.offlineMessage}</p>}
              {recent.length > 0 && <div className="customer-chat__history"><label><span>Previous chats</span><span className="customer-chat__select-wrap"><select aria-label="Choose a previous chat" value={active?.id ?? ''} disabled={busy} onChange={(event) => event.target.value ? selectConversation(event.target.value) : startFresh()}><option value="">New conversation</option>{recent.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select><ChevronDown size={13} aria-hidden="true" /></span></label>{active && <button type="button" disabled={busy} onClick={startFresh}>New chat</button>}</div>}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
