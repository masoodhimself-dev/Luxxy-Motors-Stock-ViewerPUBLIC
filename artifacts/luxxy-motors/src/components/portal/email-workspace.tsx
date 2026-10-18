import { enquiryGroup, primaryEnquiry } from "@/lib/enquiry-groups";
import { useEnquirySummaries as useGetEnquiries } from "@/lib/enquiry-summary-query";
import { useEffect, useState, useRef, useMemo } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Link, useLocation, useSearch } from "wouter";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  CircleAlert,
  Clock3,
  ChevronDown,
  Mail,
  MessageSquare,
  Paperclip,
  RefreshCw,
  Reply,
  Send,
  UserRound,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { EmailDraftQueue } from "./email-draft-queue";
import { EnquiryEmailComposer } from "./enquiry-email-composer";
import { workspaceError } from "./enquiry-workspace-tools";
import { customerHistoryHref } from "./history-links";
import "./email-workspace.css";
type Message = {
  key: string;
  kind: "enquiry" | "sale" | "notification" | "reminder";
  customer_name: string;
  recipient: string;
  subject: string;
  status: string;
  created_at: string;
  vehicle_id: string | null;
  vehicle_title: string | null;
  enquiry_id: string | null;
  sale_id: string | null;
  document_id: string | null;
  reference: string;
  attachment_count: number;
  provider_id: string | null;
  last_event: string | null;
  checked_at: string | null;
  /** Saved text is returned only by a scoped conversation request. */
  message?: string | null;
};
type Conversation = {
  key: string;
  enquiryId: string | null;
  saleId: string | null;
  customer: string;
  recipient: string;
  vehicle: string | null;
  reference: string;
  latest: Message | null;
  updatedAt: string;
  vehicleId: string | null;
  messages: Message[];
};
type EmailHistory = {
  messages: Message[];
  hasMore: boolean;
  replyTo?: string | null;
};
// Compare instants, not serialisations (PostgreSQL, UTC and explicit offsets can mix).
const emailTimestamp = (value: string) => {
  const parsed = Date.parse(
    value
      .replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T")
      .replace(/([+-]\d{2})$/, "$1:00"),
  );
  return Number.isFinite(parsed) ? parsed : 0;
};
const compareEmailTimes = (left: string, right: string) =>
  emailTimestamp(left) - emailTimestamp(right);
const conversationKey = (message: Message) =>
  message.enquiry_id
    ? `enquiry:${message.enquiry_id}`
    : message.sale_id
      ? `sale:${message.sale_id}`
      : message.key;
export function groupEmailConversations(
  messages: Message[],
  resolveEnquiryId: (id: string) => string = (id) => id,
): Conversation[] {
  const groups = new Map<string, Conversation>();
  for (const message of messages) {
    const enquiryId = message.enquiry_id
      ? resolveEnquiryId(message.enquiry_id)
      : null;
    const key = enquiryId ? `enquiry:${enquiryId}` : conversationKey(message),
      existing = groups.get(key);
    if (existing) {
      existing.messages.push(message);
      if (
        compareEmailTimes(message.created_at, existing.updatedAt) > 0 ||
        (compareEmailTimes(message.created_at, existing.updatedAt) === 0 &&
          message.key.localeCompare(existing.latest?.key ?? "") > 0)
      ) {
        existing.latest = message;
        existing.updatedAt = message.created_at;
      }
    } else
      groups.set(key, {
        key,
        enquiryId,
        saleId: message.sale_id,
        customer: message.customer_name || message.recipient,
        recipient: message.recipient,
        vehicle: message.vehicle_title,
        reference: message.reference,
        latest: message,
        updatedAt: message.created_at,
        vehicleId: message.vehicle_id,
        messages: [message],
      });
  }
  return [...groups.values()].sort(
    (a, b) =>
      compareEmailTimes(b.updatedAt, a.updatedAt) || a.key.localeCompare(b.key),
  );
}
const labels: Record<string, string> = {
  sent: "Submitted to Resend",
  prepared: "Prepared · not sent",
  sending: "Sending",
  unknown: "Acceptance unconfirmed",
  failed: "Failed",
  delivered: "Delivered",
  delivery_delayed: "Delivery delayed",
  bounced: "Bounced",
  complained: "Reported as spam",
  opened: "Opened",
  clicked: "Link clicked",
  suppressed: "Suppressed",
  scheduled: "Scheduled",
  queued: "Queued",
  canceled: "Cancelled",
};
export const emailStatusLabel = (value: string) =>
  labels[value] ?? "Status unavailable";
export function emailStatusTone(value: string) {
  if (["delivered", "opened", "clicked"].includes(value)) return "success";
  if (["failed", "bounced", "complained", "suppressed"].includes(value))
    return "danger";
  if (["unknown", "delivery_delayed"].includes(value)) return "warning";
  if (value === "prepared") return "violet";
  if (["sent", "sending", "scheduled", "queued"].includes(value)) return "info";
  return "neutral";
}
const dayKey = (value: string) =>
  new Date(value).toLocaleDateString("en-CA", { timeZone: "Europe/London" });
const date = (value: string) =>
  new Date(value).toLocaleString("en-GB", {
    timeZone: "Europe/London",
    dateStyle: "medium",
    timeStyle: "short",
  });
export function EmailWorkspace({
  embedded = false,
}: { embedded?: boolean } = {}) {
  const locationSearch = useSearch();
  const [, navigate] = useLocation();
  const initial = new URLSearchParams(locationSearch);
  const cache = useQueryClient();
  const [view, setView] = useState<"sent" | "drafts">(
    initial.get("view") === "drafts" || initial.has("draft")
      ? "drafts"
      : "sent",
  );
  const openedRequest = useRef("");
  const enquiries = useGetEnquiries();
  const scopedEnquiryId =
    initial.get("enquiryId") || initial.get("compose") || initial.get("draft");
  const scopedEnquiry = enquiries.data?.find((e) => e.id === scopedEnquiryId);
  const unavailableContext = Boolean(scopedEnquiryId && !scopedEnquiry);
  const [chosenConversation, setConversation] = useState<Conversation | null>(
    null,
  );
  const [search, setSearch] = useState(initial.get("customer") ?? ""),
    [query, setQuery] = useState(search),
    [offset, setOffset] = useState(0),
    [selected, setSelected] = useState<Message | null>(null),
    [compose, setCompose] = useState(false),
    [entryId, setEntryId] = useState(""),
    [customerSearch, setCustomerSearch] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const conversation = useMemo<Conversation | null>(() => {
    if (chosenConversation) return chosenConversation;
    if (!scopedEnquiry || view !== "sent") return null;
    const primary = primaryEnquiry(scopedEnquiry, enquiries.data ?? []);
    return {
      key: `enquiry:${primary.id}`,
      enquiryId: primary.id,
      saleId: null,
      customer: primary.customerName,
      recipient: primary.email ?? "No email address supplied",
      vehicle: primary.vehicleTitle,
      vehicleId: primary.vehicleId,
      reference: primary.reference,
      latest: null,
      messages: [],
      updatedAt: primary.createdAt,
    };
  }, [chosenConversation, scopedEnquiry, enquiries.data, view]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setOffset(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  const history = useQuery({
    queryKey: ["staff-email", query, offset, scopedEnquiryId],
    enabled: view === "sent" && !unavailableContext,
    queryFn: () =>
      customFetch<EmailHistory>(
        `/api/staff/email?q=${encodeURIComponent(query)}&offset=${offset}${scopedEnquiryId ? `&enquiryId=${encodeURIComponent(scopedEnquiryId)}` : ""}`,
      ),
    retry: false,
  });
  const conversations = useMemo(() => {
    const entries = enquiries.data ?? [],
      byId = new Map(entries.map((entry) => [entry.id, entry]));
    const groups = groupEmailConversations(
      history.data?.messages ?? [],
      (id) => {
        const entry = byId.get(id);
        return entry ? primaryEnquiry(entry, entries).id : id;
      },
    );
    if (
      scopedEnquiry &&
      !groups.some(
        (item) => item.enquiryId === primaryEnquiry(scopedEnquiry, entries).id,
      )
    ) {
      const primary = primaryEnquiry(scopedEnquiry, entries);
      groups.push({
        key: `enquiry:${primary.id}`,
        enquiryId: primary.id,
        saleId: null,
        customer: primary.customerName,
        recipient: primary.email ?? "No email address supplied",
        vehicle: primary.vehicleTitle,
        vehicleId: primary.vehicleId,
        reference: primary.reference,
        latest: null,
        messages: [],
        updatedAt: primary.createdAt,
      });
    }
    return groups;
  }, [history.data?.messages, enquiries.data, scopedEnquiry]);
  const thread = useInfiniteQuery({
    queryKey: ["staff-email-conversation", conversation?.key],
    enabled:
      view === "sent" &&
      !!conversation &&
      !!(conversation.enquiryId || conversation.saleId) &&
      !unavailableContext,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      customFetch<EmailHistory>(
        `/api/staff/email?includeBody=true&offset=${pageParam}&${conversation?.enquiryId ? `enquiryId=${encodeURIComponent(conversation.enquiryId)}` : `saleId=${encodeURIComponent(conversation!.saleId!)}`}`,
      ),
    getNextPageParam: (last, pages) =>
      last.hasMore ? pages.length * 50 : undefined,
    retry: false,
  });
  const threadMessages = useMemo(() => {
    const rows =
      thread.data?.pages.flatMap((page) => page.messages) ??
      conversation?.messages ??
      [];
    return [
      ...new Map(rows.map((message) => [message.key, message])).values(),
    ].sort(
      (a, b) =>
        compareEmailTimes(a.created_at, b.created_at) ||
        a.key.localeCompare(b.key),
    );
  }, [thread.data, conversation]);
  const originalEnquiries = useMemo(() => {
    const entries = enquiries.data ?? [],
      original = entries.find((entry) => entry.id === conversation?.enquiryId);
    if (original)
      return enquiryGroup(original, entries).filter((entry) =>
        entry.message?.trim(),
      );
    const ids = new Set(threadMessages.map((message) => message.enquiry_id));
    return entries.filter(
      (entry) => ids.has(entry.id) && entry.message?.trim(),
    );
  }, [threadMessages, enquiries.data, conversation]);
  const timeline = useMemo(
    () =>
      [
        ...originalEnquiries.map((entry) => ({
          kind: "original" as const,
          key: `original:${entry.id}`,
          at: entry.createdAt,
          entry,
        })),
        ...threadMessages.map((message) => ({
          kind: "email" as const,
          key: message.key,
          at: message.created_at,
          message,
        })),
      ].sort(
        (a, b) => compareEmailTimes(a.at, b.at) || a.key.localeCompare(b.key),
      ),
    [originalEnquiries, threadMessages],
  );
  const detail = useQuery({
    queryKey: ["staff-email-message", selected?.key],
    enabled: !!selected,
    queryFn: () =>
      customFetch<{
        message: {
          message: string;
          attachments?: { id: string; filename: string; byteSize: number }[];
        };
      }>(`/api/staff/email/message/${encodeURIComponent(selected!.key)}`),
    retry: false,
  });
  const customers = (enquiries.data ?? []).filter((e) =>
    `${e.customerName} ${e.reference} ${e.vehicleTitle ?? ""} ${e.email ?? ""}`
      .toLowerCase()
      .includes(customerSearch.toLowerCase()),
  );
  const customer = enquiries.data?.find((e) => e.id === entryId);
  useEffect(() => {
    const params = new URLSearchParams(locationSearch);
    if (params.get("view") === "drafts" || params.has("draft"))
      setView("drafts");
    else setView("sent");
    setSearch(params.get("customer") || "");
    setSelected(null);
    setConversation(null);
    setOffset(0);
    setCompose(false);
    setEntryId("");
    setError("");
  }, [locationSearch]);
  useEffect(() => {
    const params = new URLSearchParams(locationSearch),
      id = params.get("draft") || params.get("compose");
    if (!id || !enquiries.data || openedRequest.current === locationSearch)
      return;
    openedRequest.current = locationSearch;
    if (enquiries.data.some((e) => e.id === id)) {
      setEntryId(id);
      setCompose(true);
      setError("");
    } else
      setError(
        "This enquiry is unavailable. Open Enquiries to find the current customer record.",
      );
  }, [locationSearch, enquiries.data]);
  const selectedKey = useRef<string | null>(null);
  selectedKey.current = selected?.key ?? null;
  async function checkStatus() {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      const status = await customFetch<{ event: string; checkedAt: string }>(
        `/api/staff/email/message/${encodeURIComponent(selected.key)}/status`,
        { method: "POST" },
      );
      setSelected((current) =>
        current?.key === selected.key
          ? {
              ...current,
              last_event: status.event,
              checked_at: status.checkedAt,
            }
          : current,
      );
      await Promise.all([history.refetch(), thread.refetch()]);
      await cache.invalidateQueries({ queryKey: ["staff-notifications"] });
    } catch (e) {
      if (selectedKey.current === selected.key) setError(workspaceError(e));
    } finally {
      setBusy(false);
    }
  }
  async function downloadPdf() {
    if (!selected?.sale_id || !selected.document_id || busy) return;
    setBusy(true);
    setError("");
    try {
      const blob = await customFetch<Blob>(
        `/api/sale-workspace/${selected.sale_id}/documents/${selected.document_id}/pdf`,
        { responseType: "blob" },
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = 'sales-document.pdf';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      setError(workspaceError(e));
    } finally {
      setBusy(false);
    }
  }
  const currentStatus = selected?.last_event ?? selected?.status ?? "";
  return (
    <section className={`email-workspace${embedded ? " is-embedded" : ""}`}>
      {!embedded && (
        <header className="email-heading">
          <div>
            <p className="inventory-kicker">Customer correspondence</p>
            <h2>Email</h2>
            <p>
              Follow each customer’s enquiry and your emails in one
              conversation.
            </p>
          </div>
        </header>
      )}
      <div className="email-toolbar">
        <div className="email-view-tabs" role="group" aria-label="Email views">
          <Button
            variant={view === "sent" ? "default" : "outline"}
            aria-pressed={view === "sent"}
            data-tone="info"
            onClick={() => setView("sent")}
          >
            Conversations
          </Button>
          <Button
            variant={view === "drafts" ? "default" : "outline"}
            aria-pressed={view === "drafts"}
            data-tone="violet"
            onClick={() => setView("drafts")}
          >
            Drafts to review
          </Button>
        </div>
        <div className="email-toolbar-actions">
          <Button
            variant="outline"
            onClick={() => {
              if (view === "sent" && !unavailableContext) {
                void history.refetch();
                if (conversation) void thread.refetch();
                if (selected) void detail.refetch();
              }
              void cache.invalidateQueries({
                queryKey: ["staff-email-drafts"],
              });
            }}
          >
            <RefreshCw size={16} />
            Refresh
          </Button>
          <Button
            disabled={unavailableContext}
            onClick={() => {
              if (scopedEnquiry) {
                setEntryId(scopedEnquiry.id);
                setCompose(true);
              } else {
                setCompose(true);
                setEntryId("");
              }
            }}
          >
            <Mail size={16} />
            New email
          </Button>
        </div>
      </div>
      {scopedEnquiry && (
        <div className="email-customer-context">
          <div>
            <strong>{scopedEnquiry.customerName}</strong>
            <span>
              {scopedEnquiry.vehicleTitle || "General enquiry"}
            </span>
          </div>
          <Link
            href={`/portal?section=notifications&workView=customers&enquiryId=${encodeURIComponent(scopedEnquiry.id)}`}
          >
            Open customer
          </Link>
          <Button
            variant="ghost"
            onClick={() => {
              setSearch("");
              setQuery("");
              setSelected(null);
              setConversation(null);
              setCompose(false);
              navigate("/portal?section=notifications&workView=email");
            }}
          >
            Show all email
          </Button>
        </div>
      )}
      {unavailableContext && (
        <div
          role={enquiries.isLoading ? "status" : "alert"}
          className="email-customer-context"
        >
          <span>
            {enquiries.isLoading
              ? "Loading this customer’s email…"
              : "This customer record could not be loaded. Refresh the enquiries or choose another customer."}
          </span>
          <Button
            variant="ghost"
            onClick={() =>
              navigate("/portal?section=notifications&workView=email")
            }
          >
            Show all email
          </Button>
        </div>
      )}
      {error && !selected && <p role="alert">{error}</p>}
      {compose && !customer && (
        <section className="email-customer-picker">
          <h3>Who are you emailing?</h3>
          <p>
            Choose a customer enquiry so the email stays attached to their car
            and history.
          </p>
          <Input
            aria-label="Find customer enquiry"
            placeholder="Customer or car"
            value={customerSearch}
            onChange={(e) => setCustomerSearch(e.target.value)}
          />
          <NativeSelect
            aria-label="Customer enquiry"
            value={entryId}
            onChange={(e) => setEntryId(e.target.value)}
          >
            <option value="">Choose customer / enquiry</option>
            {customers.map((e) => (
              <option key={e.id} value={e.id}>
                {e.customerName} ·{" "}
                {e.vehicleTitle ?? "General enquiry"}
              </option>
            ))}
          </NativeSelect>
          {enquiries.isError && (
            <p role="alert">
              Could not load customer enquiries. Refresh the portal to retry.
            </p>
          )}
          <Button variant="ghost" onClick={() => setCompose(false)}>
            Cancel
          </Button>
          <Link href="/portal?section=notifications&workView=customers&deskView=new">
            Log a new customer enquiry
          </Link>
        </section>
      )}
      {compose && customer && (
        <EnquiryEmailComposer
          key={customer.id}
          entry={customer}
          onClose={(result) => {
            setView(result === "sent" ? "sent" : "drafts");
            setEntryId("");
            setCompose(false);
            setOffset(0);
            void history.refetch();
            void cache.invalidateQueries({
              queryKey: ["staff-email-conversation"],
            });
          }}
        />
      )}
      {!unavailableContext &&
        (view === "drafts" ? (
          <>
            <label className="email-search email-draft-search">
              Search email
              <Input
                value={search}
                placeholder="Customer, email address, car or subject"
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <EmailDraftQueue
              search={search}
              enquiryId={scopedEnquiryId || undefined}
              onOpen={(id) => {
                setEntryId(id);
                setCompose(true);
              }}
            />
          </>
        ) : (
          <>
            <p className="email-inbox-note">
              <Mail size={16} aria-hidden="true" />
              <span>
                Replies go to{" "}
                {history.data?.replyTo ? (
                  <strong>{history.data.replyTo}</strong>
                ) : (
                  "your email inbox"
                )}
                . Inbox replies are not connected here yet.
              </span>
            </p>
            <div
              className={`email-columns${conversation ? " has-selection" : ""}`}
            >
              <section
                className="email-message-list"
                aria-label="Customer conversations"
              >
                <label className="email-search email-conversation-search">
                  <span className="sr-only">Search email</span>
                  <Input
                    value={search}
                    placeholder="Find a conversation"
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
                <div className="email-list-heading">
                  <MessageSquare size={17} aria-hidden="true" />
                  <h3>Conversations</h3>
                  <span>{conversations.length}</span>
                </div>
                {history.isLoading && (
                  <p role="status" className="email-list-state">
                    Loading conversations…
                  </p>
                )}
                {history.isError && (
                  <p role="alert" className="email-list-state">
                    Email history could not be loaded. Use Refresh to retry.
                  </p>
                )}
                {conversations.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    aria-pressed={conversation?.key === item.key}
                    className={conversation?.key === item.key ? "selected" : ""}
                    onClick={() => {
                      setConversation(item);
                      setSelected(item.latest);
                      setError("");
                    }}
                  >
                    <span>
                      <strong>{item.customer}</strong>
                      <small>{date(item.updatedAt)}</small>
                    </span>
                    <p className="email-conversation-car">
                      {item.vehicle || "General enquiry"}
                    </p>
                    <b>{item.latest?.subject || "No email sent yet"}</b>
                    <span className="email-row-meta">
                      <em
                        data-tone={
                          item.latest
                            ? emailStatusTone(
                                item.latest.last_event ?? item.latest.status,
                              )
                            : "neutral"
                        }
                      >
                        {item.latest
                          ? emailStatusLabel(
                              item.latest.last_event ?? item.latest.status,
                            )
                          : "Original enquiry"}
                      </em>
                      <small>
                        {item.messages.length} email
                        {item.messages.length === 1 ? "" : "s"}
                        {history.data?.hasMore ? " on this page" : ""}
                      </small>
                    </span>
                  </button>
                ))}
                {!history.isLoading &&
                  !history.isError &&
                  !conversations.length && (
                    <div className="email-empty">
                      <MessageSquare size={28} aria-hidden="true" />
                      <h3>
                        {query
                          ? "No matching conversations"
                          : "Your customer conversations appear here"}
                      </h3>
                      <p>
                        Send a customer email or invoice to keep it alongside
                        their enquiry.
                      </p>
                    </div>
                  )}
                <div className="email-pagination">
                  <Button
                    variant="outline"
                    disabled={offset === 0}
                    onClick={() => {
                      setOffset(Math.max(0, offset - 50));
                      setSelected(null);
                      setConversation(null);
                    }}
                  >
                    Newer
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!history.data?.hasMore}
                    onClick={() => {
                      setOffset(offset + 50);
                      setSelected(null);
                      setConversation(null);
                    }}
                  >
                    Older
                  </Button>
                </div>
              </section>
              <section
                className="email-message-detail"
                aria-label="Email conversation"
              >
                {conversation ? (
                  <>
                    <header className="email-thread-header">
                      <Button
                        className="email-back"
                        variant="ghost"
                        onClick={() => {
                          setConversation(null);
                          setSelected(null);
                          if (scopedEnquiryId)
                            navigate(
                              "/portal?section=notifications&workView=email&view=sent",
                            );
                        }}
                      >
                        <ArrowLeft size={17} aria-hidden="true" />
                        Back to conversations
                      </Button>
                      <div className="email-thread-customer">
                        <span
                          className="email-customer-avatar"
                          aria-hidden="true"
                        >
                          <UserRound size={20} />
                        </span>
                        <div>
                          <h3>{conversation.customer}</h3>
                          <p>{conversation.recipient}</p>
                        </div>
                      </div>
                      <p className="email-thread-car">
                        {conversation.vehicle || "General enquiry"}
                      </p>
                      <div className="email-record-links">
                        {conversation.enquiryId && (
                          <Link
                            href={`/portal?section=notifications&workView=customers&enquiryId=${conversation.enquiryId}`}
                          >
                            Open enquiry
                          </Link>
                        )}
                        {conversation.vehicleId && (
                          <Link
                            href={`/portal?section=inventory&vehicleId=${conversation.vehicleId}`}
                          >
                            Open car
                          </Link>
                        )}
                        <Link
                          href={customerHistoryHref(
                            conversation.enquiryId ? "enquiry" : "sale",
                            conversation.enquiryId ?? conversation.saleId ?? "",
                          )}
                        >
                          Customer history
                        </Link>
                        {conversation.saleId && (
                          <Link
                            href={`/portal?section=sales&saleId=${conversation.saleId}`}
                          >
                            Open sale
                          </Link>
                        )}
                      </div>
                    </header>
                    <div className="email-thread-scroll">
                      {thread.isLoading && (
                        <p role="status" className="email-thread-state">
                          Loading saved emails…
                        </p>
                      )}
                      {thread.isError && (
                        <div className="email-thread-state" role="alert">
                          <p>
                            The full conversation could not be loaded. The
                            messages on this page are still available.
                          </p>
                          <Button
                            variant="outline"
                            onClick={() => void thread.refetch()}
                          >
                            Retry conversation
                          </Button>
                        </div>
                      )}
                      {thread.hasNextPage && (
                        <div className="email-earlier">
                          <Button
                            variant="outline"
                            disabled={thread.isFetchingNextPage}
                            onClick={() => void thread.fetchNextPage()}
                          >
                            {thread.isFetchingNextPage
                              ? "Loading…"
                              : "Load earlier emails"}
                          </Button>
                        </div>
                      )}
                      <ol
                        className="email-thread-timeline"
                        aria-label="Conversation messages"
                      >
                        {timeline.map((item, index) => {
                          const previous = timeline[index - 1],
                            day = dayKey(item.at),
                            newDay = !previous || dayKey(previous.at) !== day;
                          if (item.kind === "original") {
                            const website =
                              item.entry.source?.startsWith("website");
                            return (
                              <li
                                key={item.key}
                                className={
                                  website
                                    ? "email-timeline-item is-customer"
                                    : "email-timeline-item is-recorded"
                                }
                              >
                                {newDay && (
                                  <p className="email-day-divider">
                                    {new Date(item.at).toLocaleDateString(
                                      "en-GB",
                                      {
                                        timeZone: "Europe/London",
                                        day: "numeric",
                                        month: "long",
                                        year: "numeric",
                                      },
                                    )}
                                  </p>
                                )}
                                <article className="email-bubble email-bubble-original">
                                  <header>
                                    <span>
                                      <UserRound size={14} aria-hidden="true" />
                                      {website
                                        ? item.entry.customerName
                                        : "Staff enquiry record"}
                                    </span>
                                    <small>
                                      {website
                                        ? "Website enquiry"
                                        : "Recorded by staff · not an incoming email"}
                                    </small>
                                  </header>
                                  <p className="email-bubble-text">
                                    {item.entry.message}
                                  </p>
                                  <footer>
                                    <time dateTime={item.at}>
                                      {date(item.at)}
                                    </time>
                                  </footer>
                                </article>
                              </li>
                            );
                          }
                          const message = item.message,
                            active = selected?.key === message.key;
                          const body =
                              message.message ??
                              (active
                                ? detail.data?.message.message
                                : undefined),
                            status = active
                              ? currentStatus
                              : (message.last_event ?? message.status);
                          const summary = message.kind !== "enquiry";
                          return (
                            <li
                              key={item.key}
                              className="email-timeline-item is-outgoing"
                            >
                              {newDay && (
                                <p className="email-day-divider">
                                  {new Date(item.at).toLocaleDateString(
                                    "en-GB",
                                    {
                                      timeZone: "Europe/London",
                                      day: "numeric",
                                      month: "long",
                                      year: "numeric",
                                    },
                                  )}
                                </p>
                              )}
                              <article
                                className={`email-bubble email-bubble-outgoing${active ? " is-active" : ""}`}
                                data-tone={emailStatusTone(status)}
                                aria-label={`${message.subject}, email from your dealership`}
                              >
                                <header>
                                  <span>
                                    <Send size={14} aria-hidden="true" />
                                    Your dealership
                                  </span>
                                  <small>
                                    {summary
                                      ? "Email record summary"
                                      : "Email to customer"}
                                  </small>
                                </header>
                                <h4>{message.subject}</h4>
                                {body ? (
                                  <p className="email-bubble-text">{body}</p>
                                ) : active && detail.isLoading ? (
                                  <p role="status" className="email-note">
                                    Loading message…
                                  </p>
                                ) : active && detail.isError ? (
                                  <p role="alert" className="email-note">
                                    The saved message could not be loaded.
                                  </p>
                                ) : (
                                  <p className="email-note">
                                    Open email details to read this saved
                                    message.
                                  </p>
                                )}
                                {message.attachment_count > 0 && (
                                  <p className="email-bubble-attachments">
                                    <Paperclip size={14} aria-hidden="true" />
                                    {message.attachment_count} attachment
                                    {message.attachment_count === 1 ? "" : "s"}
                                    {message.kind === "sale"
                                      ? " · Sales document"
                                      : ""}
                                  </p>
                                )}
                                <footer>
                                  <time dateTime={message.created_at}>
                                    {date(message.created_at)}
                                  </time>
                                  <span
                                    className={`email-delivery-status is-${status}`}
                                    data-tone={emailStatusTone(status)}
                                  >
                                    {[
                                      "failed",
                                      "bounced",
                                      "complained",
                                      "suppressed",
                                    ].includes(status) ? (
                                      <CircleAlert
                                        size={14}
                                        aria-hidden="true"
                                      />
                                    ) : [
                                        "delivered",
                                        "opened",
                                        "clicked",
                                      ].includes(status) ? (
                                      <CheckCheck
                                        size={14}
                                        aria-hidden="true"
                                      />
                                    ) : status === "sent" ? (
                                      <Check size={14} aria-hidden="true" />
                                    ) : (
                                      <Clock3 size={14} aria-hidden="true" />
                                    )}
                                    {emailStatusLabel(status)}
                                  </span>
                                </footer>
                                <Button
                                  variant="ghost"
                                  aria-expanded={active}
                                  className="email-message-toggle"
                                  onClick={() => {
                                    setSelected(active ? null : message);
                                    setError("");
                                  }}
                                >
                                  {active
                                    ? "Hide email details"
                                    : "Email details"}
                                  <ChevronDown size={14} aria-hidden="true" />
                                </Button>
                                {active && (
                                  <div className="email-bubble-details">
                                    <dl>
                                      <div>
                                        <dt>To</dt>
                                        <dd>{message.recipient}</dd>
                                      </div>
                                    </dl>
                                    <Button
                                      variant="outline"
                                      disabled={busy || !message.provider_id}
                                      onClick={() => void checkStatus()}
                                    >
                                      <RefreshCw size={15} aria-hidden="true" />
                                      {busy
                                        ? "Checking…"
                                        : "Check delivery status"}
                                    </Button>
                                    {selected?.checked_at && (
                                      <p className="email-note">
                                        Last checked {date(selected.checked_at)}
                                      </p>
                                    )}
                                    {error && (
                                      <p
                                        role="alert"
                                        className="inventory-error"
                                      >
                                        {error}
                                      </p>
                                    )}
                                    {["opened", "clicked"].includes(status) && (
                                      <p className="email-note">
                                        Open and click tracking can be affected
                                        by privacy tools. This does not prove
                                        the customer read the message.
                                      </p>
                                    )}
                                    {Boolean(
                                      detail.data?.message.attachments?.length,
                                    ) && (
                                      <div className="email-attachment-files">
                                        <h5>Attached files</h5>
                                        {detail.data!.message.attachments!.map(
                                          (a) => (
                                            <p key={a.id}>
                                              <Paperclip
                                                size={13}
                                                aria-hidden="true"
                                              />
                                              {a.filename} ·{" "}
                                              {Math.ceil(a.byteSize / 1024)} KB
                                            </p>
                                          ),
                                        )}
                                      </div>
                                    )}
                                    {message.sale_id && message.document_id && (
                                      <Button
                                        variant="ghost"
                                        disabled={busy}
                                        onClick={() => void downloadPdf()}
                                      >
                                        Download original PDF
                                      </Button>
                                    )}
                                  </div>
                                )}
                              </article>
                            </li>
                          );
                        })}
                      </ol>
                    </div>
                    {conversation.enquiryId && (
                      <div className="email-thread-reply">
                        <Button
                          onClick={() => {
                            setEntryId(conversation.enquiryId!);
                            setCompose(true);
                          }}
                        >
                          <Reply size={17} aria-hidden="true" />
                          Write an email
                        </Button>
                        <span>Review it before sending.</span>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="email-empty email-conversation-empty">
                    <MessageSquare size={32} aria-hidden="true" />
                    <h3>Choose a conversation</h3>
                    <p>
                      Read the original enquiry and your emails together, with
                      attachments and delivery updates.
                    </p>
                  </div>
                )}
              </section>
            </div>
          </>
        ))}
    </section>
  );
}
