import { EnquiryAssistance } from "./enquiry-assistance";
import type { Car } from "@/lib/stock-context";
import { EnquiryOriginalMessage } from "./enquiry-original-message";
import { ConversationMessage } from "./conversation-message";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { Link } from "wouter";
import {
  customFetch,
  getGetEnquiriesQueryKey,
  useLogEnquiryConversation,
  type Enquiry,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { callOutcomes, type CallOutcome } from "@/lib/enquiry-desk-model";
import { appointmentLabel } from "@/lib/test-drive-dates";
import { FollowUpFields, followUpIso } from "./enquiry-follow-up";
import { workspaceError } from "./enquiry-workspace-tools";
import { enquiryGroup } from "@/lib/enquiry-groups";
import {
  CalendarDays,
  Mail,
  MessageSquare,
  Phone,
  FileText,
} from "@/components/icons";
import {
  buildCaseActivity,
  type CaseEmailRecord,
} from "./enquiry-activity-model";
import "./enquiry-history.css";
import "./enquiry-case-timeline.css";

export function ConversationEditor({
  entry,
  onClose,
  onSaved,
  inline = false,
}: {
  entry: Enquiry;
  onClose: () => void;
  onSaved: (entry: Enquiry) => void | Promise<void>;
  inline?: boolean;
}) {
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState<CallOutcome>("information_given");
  const [schedule, setSchedule] = useState(false);
  const [time, setTime] = useState("");
  const [followUpNote, setFollowUpNote] = useState("");
  const [error, setError] = useState("");
  const busy = useRef(false);
  const mutation = useLogEnquiryConversation();
  const outstanding = Boolean(entry.followUpAt && !entry.followUpCompletedAt);
  const dirty = Boolean(
    note.trim() ||
    outcome !== "information_given" ||
    schedule ||
    time ||
    followUpNote.trim(),
  );
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    setError("");
    if (!note.trim()) {
      setError("Add a note about this conversation.");
      return;
    }
    const nextAt = schedule ? followUpIso(time) : null;
    if (schedule && (!nextAt || Date.parse(nextAt) <= Date.now())) {
      setError("Choose a valid future UK date and time.");
      return;
    }
    if (outcome === "callback_requested" && !schedule && !outstanding) {
      setError("Schedule the next follow-up for this callback.");
      return;
    }
    busy.current = true;
    try {
      const updated = await mutation.mutateAsync({
        id: entry.id,
        data: {
          expectedRevision: entry.workspaceRevision ?? 0,
          expectedFollowUpRevision: entry.followUpRevision ?? 0,
          note: note.trim(),
          callOutcome: outcome,
          ...(nextAt
            ? { followUpAt: nextAt, followUpNote: followUpNote.trim() }
            : {}),
        },
      });
      await onSaved(updated);
      if (inline) {
        setNote("");
        setOutcome("information_given");
        setSchedule(false);
        setTime("");
        setFollowUpNote("");
      }
    } catch (cause) {
      setError(workspaceError(cause));
    } finally {
      busy.current = false;
    }
  }
  const content = (
    <>
      <p className="text-sm">
        {entry.vehicleTitle || "General showroom enquiry"}
        {entry.vehicleRegistration ? ` · ${entry.vehicleRegistration}` : ""}
      </p>
      <form onSubmit={(event) => void save(event)} className="grid gap-4">
        <fieldset disabled={mutation.isPending} className="grid min-w-0 gap-4">
          <label className="grid gap-1.5 text-sm font-medium">
            Conversation note
            <Textarea
              autoFocus={!inline}
              required
              rows={4}
              maxLength={2000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="What was discussed and agreed?"
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Conversation outcome
            <NativeSelect
              value={outcome}
              onChange={(event) =>
                setOutcome(event.target.value as CallOutcome)
              }
            >
              {Object.entries(callOutcomes).map(([value, label]) => (
                <option
                  key={value}
                  value={value}
                  disabled={
                    value === "test_drive_booked" &&
                    (!entry.appointmentAt ||
                      Boolean(entry.appointmentCancelledAt))
                  }
                >
                  {label}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
            <input
              type="checkbox"
              checked={schedule}
              onChange={(event) => setSchedule(event.target.checked)}
            />
            Schedule the next follow-up
          </label>
          {schedule && (
            <FollowUpFields
              time={time}
              note={followUpNote}
              onTime={setTime}
              onNote={setFollowUpNote}
              noteMaxLength={500}
            />
          )}
          {!schedule && outstanding && (
            <p className="text-xs text-muted-foreground">
              Current follow-up remains due{" "}
              {appointmentLabel(entry.followUpAt!)}. Use Manage follow-up to
              mark it done.
            </p>
          )}
        </fieldset>
        <p className="text-xs text-muted-foreground">
          Saved with today’s date, time and your staff name. Earlier notes stay
          in the conversation history.
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Save conversation"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={mutation.isPending}
            onClick={onClose}
          >
            Cancel
          </Button>
        </div>
      </form>
    </>
  );
  if (inline)
    return (
      <section
        className="enquiry-inline-conversation"
        data-message-dirty={dirty ? "true" : undefined}
        aria-label={`Private conversation note for ${entry.customerName}`}
      >
        {content}
      </section>
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy.current) onClose();
      }}
    >
      <DialogContent className="portal-action-dialog enquiry-action-dialog enquiry-conversation-dialog">
        <DialogHeader>
          <DialogTitle>Log another conversation</DialogTitle>
          <DialogDescription>{entry.customerName}</DialogDescription>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
}

type CaseConversationPage = { enquiryId: string; data: ConversationPage };
type CaseConversationCursor = { enquiryId: string; cursor: string | null };
type CaseEmailPage = { messages: CaseEmailRecord[]; hasMore: boolean };

function IncomingReplyReview({ message }: { message: CaseEmailRecord }) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [handled, setHandled] = useState(false),
    [error, setError] = useState("");
  const inFlight = useRef(false),
    client = useQueryClient();
  const detail = useQuery({
    queryKey: ["staff-email-message", message.key],
    queryFn: ({ signal }) =>
      customFetch<{
        message: {
          sender?: string;
          message?: string;
          error_code?: string;
          attachments?: { id: string; filename: string; byteSize: number }[];
        };
      }>(`/api/staff/email/message/${encodeURIComponent(message.key)}`, {
        signal,
        responseType: "json",
      }),
    enabled: open,
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const resolved = handled || message.status === "handled";
  async function markHandled() {
    if (inFlight.current || resolved || !detail.data || detail.isError) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await customFetch(
        `/api/staff/email/replies/${encodeURIComponent(message.key.slice(6))}/handled`,
        { method: "POST", responseType: "json" },
      );
      setHandled(true);
      client.setQueriesData<{ pages: CaseEmailPage[] }>(
        { queryKey: ["staff-email-conversation"] },
        (current) =>
          current
            ? {
                ...current,
                pages: current.pages.map((page) => ({
                  ...page,
                  messages: page.messages.map((row) =>
                    row.key === message.key
                      ? { ...row, status: "handled" }
                      : row,
                  ),
                })),
              }
            : current,
      );
      void Promise.allSettled([
        client.invalidateQueries({ queryKey: ["staff-notifications"] }),
        client.invalidateQueries({ queryKey: ["reply-attention"] }),
        client.invalidateQueries({ queryKey: ["staff-email"] }),
        client.invalidateQueries({ queryKey: ["staff-email-conversation"] }),
      ]);
    } catch (cause) {
      setError(workspaceError(cause));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <details
      className="case-timeline-email-details"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        {message.status === "review" && !resolved
          ? "Check sender & review reply"
          : "Email details"}
      </summary>
      {open && (
        <div>
          {detail.isPending ? (
            <p role="status">Loading saved sender details…</p>
          ) : detail.isError ? (
            <div role="alert">
              <p>Saved sender details could not be loaded.</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void detail.refetch()}
              >
                Retry sender details
              </Button>
            </div>
          ) : (
            <>
              <p>
                <strong>From: </strong>
                {detail.data?.message.sender || "Sender not recorded"}
              </p>
              {!!detail.data?.message.attachments?.length && (
                <p className="case-timeline-meta">
                  Attachments:{" "}
                  {detail.data.message.attachments
                    .map((file) => file.filename)
                    .join(", ")}
                  . Incoming attachment downloads are not available here.
                </p>
              )}
              {resolved ? (
                <p role="status" className="case-timeline-meta">
                  Handled
                </p>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy || !detail.data}
                  onClick={() => void markHandled()}
                >
                  {busy ? "Saving…" : "Mark handled"}
                </Button>
              )}
            </>
          )}
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </details>
  );
}

/** Selected-case journals only. No provider checks or automatic reply handling. */
export function CustomerActivityTimeline({
  entry,
  entries = [entry],
  canEmail = false,
  cars = [],
  onInsertText,
}: {
  entry: Enquiry;
  entries?: readonly Enquiry[];
  canEmail?: boolean;
  cars?: readonly Car[];
  onInsertText?: (text:string)=>void;
}) {
  const records = enquiryGroup(entry, entries);
  const ids = records.map((record) => record.id);
  const conversations = useInfiniteQuery({
    queryKey: [
      ...getGetEnquiriesQueryKey(),
      "case-activity",
      ids,
      records.map((record) => record.workspaceRevision ?? 0),
    ],
    initialPageParam: records.map((record) => ({
      enquiryId: record.id,
      cursor: null,
    })) as CaseConversationCursor[],
    queryFn: async ({ pageParam, signal }) =>
      Promise.all(
        pageParam.map(async ({ enquiryId, cursor }) => ({
          enquiryId,
          data: await customFetch<ConversationPage>(
            `/api/staff/enquiries/${encodeURIComponent(enquiryId)}/conversations${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
            { signal, responseType: "json" },
          ),
        })),
      ),
    getNextPageParam: (page: CaseConversationPage[]) => {
      const next = page
        .filter((source) => source.data.nextCursor)
        .map((source) => ({
          enquiryId: source.enquiryId,
          cursor: source.data.nextCursor,
        }));
      return next.length ? next : undefined;
    },
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const emails = useInfiniteQuery({
    queryKey: [
      "staff-email-conversation",
      `enquiry:${entry.id}`,
      // The receiving worker increments the original enquiry revision. A
      // merged customer's reply must refresh its journal and review action too.
      records.map((record) => [record.id, record.workspaceRevision ?? 0]),
    ],
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      customFetch<CaseEmailPage>(
        `/api/staff/email?includeBody=true&offset=${pageParam}&enquiryId=${encodeURIComponent(entry.id)}`,
        { signal, responseType: "json" },
      ),
    getNextPageParam: (page, pages) =>
      page.hasMore ? pages.length * 50 : undefined,
    enabled: canEmail,
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const sources = conversations.data?.pages.flat() ?? [];
  const loadedRecords = records.map((record) => ({
    ...record,
    events: [
      ...new Map(
        [
          ...(record.events ?? []),
          ...sources
            .filter((source) => source.enquiryId === record.id)
            .flatMap((source) => source.data.events),
        ].map((event) => [event.id, event]),
      ).values(),
    ],
  }));
  const journal = canEmail
    ? (emails.data?.pages.flatMap((page) => page.messages) ?? [])
    : [];
  const items = buildCaseActivity(loadedRecords, journal);
  const hasMore = conversations.hasNextPage || (canEmail && emails.hasNextPage);
  const loadingOlder =
    conversations.isFetchingNextPage || (canEmail && emails.isFetchingNextPage);
  const loading = conversations.isPending || (canEmail && emails.isPending);
  const hasError = conversations.isError || (canEmail && emails.isError);
  const Icon = (kind: string) =>
    kind === "email" || kind === "customer-email"
      ? Mail
      : kind === "appointment"
        ? CalendarDays
        : kind === "call" || kind === "internal"
          ? Phone
          : kind === "sale"
            ? FileText
            : MessageSquare;
  return (
    <section className="customer-case-timeline" aria-label="Customer activity">
      <header className="case-timeline-heading">
        <div>
          <h4>Activity</h4>
          <p>Messages and notes together · latest first</p>
        </div>
        <span>
          {items.length} {items.length === 1 ? "record" : "records"}
          {hasMore ? "+" : ""}
        </span>
      </header>
      {!loading && !hasError && canEmail && <EnquiryAssistance items={items} cars={cars} onInsertText={onInsertText} closed={entry.status === "closed" || entry.callOutcome === "not_interested"} />}
      {loading && (
        <p role="status" className="case-timeline-notice">
          Loading saved activity…
        </p>
      )}
      {hasError && (
        <div role="alert" className="case-timeline-notice">
          <p>
            Some activity could not be loaded. Saved customer details and
            available records are still shown.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              if (conversations.isError) void conversations.refetch();
              if (canEmail && emails.isError) void emails.refetch();
            }}
          >
            Retry activity
          </Button>
        </div>
      )}
      <ol className="case-timeline-items">
        {items.map((item) => {
          const ItemIcon = Icon(item.kind);
          return (
            <li key={item.key}>
              <article
                className="case-timeline-item"
                data-kind={item.kind}
                data-testid={`activity-${item.key}`}
              >
                <span className="case-timeline-marker" aria-hidden="true">
                  <ItemIcon size={15} />
                </span>
                <div className="case-timeline-body">
                  <header>
                    <span className="case-timeline-channel">
                      {item.channel}
                    </span>
                    {item.at ? (
                      <time dateTime={item.at}>
                        {appointmentLabel(item.at)}
                      </time>
                    ) : (
                      <span className="case-timeline-undated">
                        Date not recorded
                      </span>
                    )}
                  </header>
                  <h5>{item.title}</h5>
                  {item.status && (
                    <span className="case-timeline-status">{item.status}</span>
                  )}
                  {item.body &&
                    (item.kind === "original" ? (
                      <EnquiryOriginalMessage text={item.body} />
                    ) : (
                      <ConversationMessage text={item.body} />
                    ))}
                  {(item.author || records.length > 1) && (
                    <p className="case-timeline-meta">
                      {item.author}
                      {records.length > 1
                        ? `${item.author ? " · " : ""}${item.reference}`
                        : ""}
                    </p>
                  )}
                  {Boolean(item.attachmentCount) && (
                    <p className="case-timeline-meta">
                      {item.attachmentCount}{" "}
                      {item.attachmentCount === 1
                        ? "attachment"
                        : "attachments"}
                    </p>
                  )}
                  {item.followUpAt && (
                    <p className="case-timeline-followup">
                      Follow-up arranged for {appointmentLabel(item.followUpAt)}
                    </p>
                  )}
                  {item.caution && (
                    <p className="case-timeline-caution">{item.caution}</p>
                  )}
                  {item.saleId && (
                    <Link
                      className="case-timeline-sale"
                      href={`/portal?section=sales&saleId=${encodeURIComponent(item.saleId)}`}
                    >
                      Open linked sale
                    </Link>
                  )}
                  {canEmail &&
                    item.kind === "customer-email" &&
                    journal.find(
                      (message) =>
                        `email:${message.key}` === item.key &&
                        message.kind === "reply",
                    ) && (
                      <IncomingReplyReview
                        message={journal.find(
                          (message) => `email:${message.key}` === item.key,
                        )!}
                      />
                    )}
                </div>
              </article>
            </li>
          );
        })}
      </ol>
      {!loading && !hasError && !items.length && (
        <p className="case-timeline-notice">No activity recorded yet.</p>
      )}
      {hasMore && (
        <Button
          type="button"
          variant="outline"
          className="case-timeline-older"
          disabled={loadingOlder}
          onClick={() => {
            if (conversations.hasNextPage) void conversations.fetchNextPage();
            if (canEmail && emails.hasNextPage) void emails.fetchNextPage();
          }}
        >
          {loadingOlder ? "Loading older activity…" : "Load older activity"}
        </Button>
      )}
    </section>
  );
}

type ConversationPage = {
  events: Enquiry["events"];
  total: number;
  nextCursor: string | null;
};
function LoadedConversationHistory({ entry }: { entry: Enquiry }) {
  const history = useInfiniteQuery({
    queryKey: [
      ...getGetEnquiriesQueryKey(),
      "conversations",
      entry.id,
      entry.workspaceRevision ?? 0,
    ],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      customFetch<ConversationPage>(
        `/api/staff/enquiries/${encodeURIComponent(entry.id)}/conversations${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`,
        { signal, responseType: "json" },
      ),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 30_000,
    retry: false,
  });
  const events = [
    ...new Map(
      (history.data?.pages.flatMap((page) => page.events) ?? []).map(
        (event) => [event.id, event],
      ),
    ).values(),
  ];
  const total = history.data?.pages[0]?.total;
  return (
    <ConversationHistoryView
      entry={{ ...entry, events }}
      total={total}
      status={
        history.isPending ? (
          <p role="status">Loading conversation notes…</p>
        ) : history.isError ? (
          <div role="alert">
            <p>
              Conversation notes could not be loaded. The original enquiry and
              internal note are still shown.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void history.refetch()}
            >
              Retry conversation notes
            </Button>
          </div>
        ) : undefined
      }
      footer={
        history.hasNextPage ? (
          <div className="mt-3 grid gap-2">
            <p className="text-xs text-muted-foreground">
              Showing {events.length} of {total} conversation notes.
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={history.isFetchingNextPage}
              onClick={() => void history.fetchNextPage()}
            >
              {history.isFetchingNextPage
                ? "Loading older notes…"
                : "Load older conversation notes"}
            </Button>
          </div>
        ) : undefined
      }
    />
  );
}

export function ConversationHistory({
  entry,
  loadOnDemand = false,
}: {
  entry: Enquiry;
  loadOnDemand?: boolean;
}) {
  return loadOnDemand ? (
    <LoadedConversationHistory entry={entry} />
  ) : (
    <ConversationHistoryView entry={entry} />
  );
}

function ConversationHistoryView({
  entry,
  total,
  status,
  footer,
}: {
  entry: Enquiry;
  total?: number;
  status?: ReactNode;
  footer?: ReactNode;
}) {
  const conversations = (entry.events ?? [])
    .filter((event) => event.kind === "conversation_logged")
    .sort(
      (a, b) =>
        (Date.parse(b.occurredAt) || 0) - (Date.parse(a.occurredAt) || 0),
    );
  return (
    <section
      className="enquiry-conversation-history enquiry-history-conversations"
      aria-label="Conversation history"
    >
      <header className="enquiry-history-heading">
        <h4>
          Conversation
          {(total ?? conversations.length)
            ? ` · ${total ?? conversations.length}`
            : ""}
        </h4>
        <p>Latest messages and staff notes.</p>
      </header>
      {conversations.map((event) => {
        const title = event.callOutcome
          ? callOutcomes[event.callOutcome as CallOutcome] || event.callOutcome
          : event.summary;
        const note = event.note || event.summary;
        return (
          <article
            className="enquiry-conversation-entry"
            key={event.id}
            data-testid={`conversation-${event.id}`}
            data-kind={
              event.actor === "customer"
                ? "customer"
                : event.summary === "WhatsApp sent — staff confirmed"
                  ? "whatsapp"
                  : "staff"
            }
          >
            <header>
              <span className="enquiry-history-type">
                {event.summary === "WhatsApp sent — staff confirmed"
                  ? "WhatsApp"
                  : event.actor === "customer" &&
                      event.summary === "Customer email received"
                    ? "Customer email"
                    : "Conversation"}
              </span>
              <time dateTime={event.occurredAt}>
                {appointmentLabel(event.occurredAt)}
              </time>
            </header>
            {title && <h5>{title}</h5>}
            {note && note !== title && <ConversationMessage text={note} />}
            <p className="enquiry-conversation-author">
              {event.actor === "customer"
                ? `From ${entry.customerName}`
                : `Recorded by ${event.staffName || "Staff member"}`}
            </p>
            {event.followUpAt && (
              <p className="enquiry-conversation-followup">
                Follow-up arranged for {appointmentLabel(event.followUpAt)}
              </p>
            )}
          </article>
        );
      })}
      {status}
      {footer}
      {entry.staffNote && (
        <article className="enquiry-conversation-entry" data-kind="internal">
          <header>
            <span className="enquiry-history-type">Internal note</span>
          </header>
          <p className="enquiry-history-copy">{entry.staffNote}</p>
        </article>
      )}
      {entry.message && (
        <article className="enquiry-conversation-entry" data-kind="original">
          <header>
            <span className="enquiry-history-type">
              Original{" "}
              {entry.source === "sale_review"
                ? "post-sale reminder"
                : entry.source === "website_callback"
                  ? "website callback request"
                  : entry.source === "phone"
                    ? "call"
                    : "enquiry"}
            </span>
            {entry.createdAt && (
              <time dateTime={entry.createdAt}>
                {appointmentLabel(entry.createdAt)}
              </time>
            )}
          </header>
          <EnquiryOriginalMessage text={entry.message} />
        </article>
      )}
      {!status &&
        !conversations.length &&
        !entry.message &&
        !entry.staffNote && (
          <p className="enquiry-history-empty">
            No conversation notes recorded yet.
          </p>
        )}
    </section>
  );
}
