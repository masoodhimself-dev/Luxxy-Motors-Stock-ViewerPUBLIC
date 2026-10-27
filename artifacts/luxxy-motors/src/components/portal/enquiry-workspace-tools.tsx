import { useState } from "react";
import {
  assessCustomerContact,
  type CustomerContactMatch,
} from "@workspace/vehicle-meta";
import { Link } from "wouter";
import { customerHistoryHref } from "./history-links";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetStaffDirectory,
  useUpdateEnquiryWorkspace,
  useChangeStaffFollowUp,
  getGetEnquiriesQueryKey,
  getGetTestDriveBookingsQueryKey,
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
import { appointmentLabel } from "@/lib/test-drive-dates";
import {
  callOutcomes,
  nextAction,
  type CallOutcome,
} from "@/lib/enquiry-desk-model";
import { attendanceError } from "../../../../api-server/src/lib/enquiry-workspace";
import "./enquiry-history.css";

export function workspaceError(error: unknown) {
  const e = error as { data?: { error?: string } };
  return (
    e?.data?.error ||
    "Could not save. Refresh and try again; your notes are still here."
  );
}
export function useRefreshDesk() {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ["staff-notifications"] }),
      client.invalidateQueries({ queryKey: getGetEnquiriesQueryKey() }),
      client.invalidateQueries({ queryKey: getGetTestDriveBookingsQueryKey() }),
    ]);
}
export function OwnerSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const query = useGetStaffDirectory();
  return (
    <label className="enquiry-field grid gap-1.5 text-sm font-medium">
      Assigned to
      <NativeSelect
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={query.isLoading || query.isError}
      >
        <option value="">Unassigned</option>
        {value &&
          !query.data?.members.some((member) => member.id === value) && (
            <option value={value}>Current owner</option>
          )}
        {query.data?.members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
            {member.id === query.data.currentUserId ? " (you)" : ""}
          </option>
        ))}
      </NativeSelect>
      {query.isError && (
        <span className="text-xs text-destructive">
          Staff directory unavailable. Use Refresh to retry.
        </span>
      )}
    </label>
  );
}

export function WorkspaceEditor({
  entry,
  onClose,
}: {
  entry: Enquiry;
  onClose: () => void;
}) {
  const [owner, setOwner] = useState(entry.assignedToId ?? "");
  const [outcome, setOutcome] = useState(entry.callOutcome ?? "");
  const [note, setNote] = useState(entry.staffNote ?? "");
  const mutation = useUpdateEnquiryWorkspace();
  const refresh = useRefreshDesk();
  async function save() {
    try {
      await mutation.mutateAsync({
        id: entry.id,
        data: {
          expectedRevision: entry.workspaceRevision ?? 0,
          assignedToId: owner || null,
          callOutcome: (outcome || null) as CallOutcome | null,
          staffNote: note || null,
        },
      });
      await refresh();
      onClose();
    } catch {}
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
    >
      <DialogContent className="portal-action-dialog enquiry-action-dialog">
        <DialogHeader>
          <DialogTitle>Update enquiry</DialogTitle>
          <DialogDescription>{entry.customerName}</DialogDescription>
        </DialogHeader>
        <OwnerSelect value={owner} onChange={setOwner} />
        <label className="grid gap-1.5 text-sm font-medium">
          Call outcome
          <NativeSelect
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
          >
            <option value="">Not recorded</option>
            {Object.entries(callOutcomes).map(([value, label]) => (
              <option
                key={value}
                value={value}
                disabled={
                  value === "test_drive_booked"
                    ? !entry.appointmentAt ||
                      Boolean(entry.appointmentCancelledAt)
                    : value === "callback_requested"
                      ? !entry.followUpAt || Boolean(entry.followUpCompletedAt)
                      : false
                }
              >
                {label}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Internal note
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            rows={4}
          />
        </label>
        <p className="text-xs text-muted-foreground">
          Original call notes are retained. Schedule a follow-up from the
          enquiry before choosing Callback requested.
        </p>
        {mutation.isError && (
          <p role="alert" className="text-sm text-destructive">
            {workspaceError(mutation.error)}
          </p>
        )}
        <Button onClick={() => void save()} disabled={mutation.isPending}>
          {mutation.isPending ? "Saving…" : "Save enquiry update"}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

export function AttendanceControls({ entry }: { entry: Enquiry }) {
  const mutation = useUpdateEnquiryWorkspace();
  const refresh = useRefreshDesk();
  if (!entry.appointmentAt || entry.appointmentCancelledAt) return null;
  const current = entry.attendance ?? "scheduled";
  const options =
    current === "arrived"
      ? [
          { value: "completed" as const, label: "Complete visit" },
          { value: "scheduled" as const, label: "Undo arrival" },
        ]
      : ["completed", "no_show"].includes(current)
        ? [{ value: "scheduled" as const, label: "Undo attendance" }]
        : [
            { value: "arrived" as const, label: "Mark arrived" },
            { value: "no_show" as const, label: "Mark no-show" },
          ];
  return (
    <div className="enquiry-attendance space-y-2" data-attendance={current}>
      <p className="text-xs font-semibold">
        Attendance: {current.replace("_", " ")}
      </p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Button
            key={option.value}
            size="sm"
            variant="outline"
            disabled={
              mutation.isPending ||
              Boolean(attendanceError(entry, option.value))
            }
            title={attendanceError(entry, option.value) ?? undefined}
            onClick={async () => {
              try {
                await mutation.mutateAsync({
                  id: entry.id,
                  data: {
                    expectedRevision: entry.workspaceRevision ?? 0,
                    expectedAppointmentRevision: entry.appointmentRevision ?? 0,
                    attendance: option.value,
                  },
                });
                await refresh();
              } catch {}
            }}
          >
            {option.label}
          </Button>
        ))}
      </div>
      {mutation.isError && (
        <p role="alert" className="text-xs text-destructive">
          {workspaceError(mutation.error)}
        </p>
      )}
    </div>
  );
}

export function NextAction({ entry }: { entry: Enquiry }) {
  const mutation = useChangeStaffFollowUp();
  const refresh = useRefreshDesk();
  const outstanding = entry.followUpAt && !entry.followUpCompletedAt;
  return (
    <div
      data-tone={
        outstanding && Date.parse(entry.followUpAt!) <= Date.now()
          ? "warning"
          : "info"
      }
      className="enquiry-next-action mt-3 flex flex-wrap items-center justify-between gap-2 rounded border border-blue-100 bg-blue-50/60 p-3 text-sm"
    >
      <div>
        <p className="text-xs font-semibold text-slate-600">Next action</p>
        <p className="mt-1 font-medium">{nextAction(entry)}</p>
        {outstanding && (
          <p className="text-xs text-slate-600">
            {appointmentLabel(entry.followUpAt!)}
            {Date.parse(entry.followUpAt!) <= Date.now() ? " · Overdue" : ""}
          </p>
        )}
      </div>
      {outstanding && (
        <Button
          size="sm"
          variant="outline"
          disabled={mutation.isPending}
          onClick={async () => {
            try {
              await mutation.mutateAsync({
                id: entry.id,
                data: {
                  action: "complete",
                  expectedRevision: entry.followUpRevision ?? 0,
                },
              });
              await refresh();
            } catch {}
          }}
        >
          Done
        </Button>
      )}
      {mutation.isError && (
        <p role="alert" className="w-full text-destructive">
          {workspaceError(mutation.error)}
        </p>
      )}
    </div>
  );
}

export type Contact = {
  customerName: string;
  phone?: string | null;
  email?: string | null;
};
export function CustomerHistory({
  contact,
  enquiries,
  onReuse,
  compact = false,
}: {
  contact: Contact;
  enquiries: Enquiry[];
  onReuse?: (contact: Contact) => void;
  compact?: boolean;
}) {
  const [reviewKey, setReviewKey] = useState("");
  const [showAll, setShowAll] = useState(false);
  const enquiryMatches = enquiries
    .map((entry) => ({ entry, match: assessCustomerContact(contact, entry) }))
    .filter((item) => item.match.matchedBy.length);
  const timeline = [
    ...enquiryMatches.map(({ entry, match }) => ({
      id: `e-${entry.id}`,
      recordType: "enquiry" as const,
      recordId: entry.id,
      at: entry.createdAt || entry.updatedAt || "",
      name: entry.customerName,
      phone: entry.phone,
      email: entry.email,
      match,
      title: entry.vehicleTitle || "General enquiry",
      type: entry.appointmentAt
        ? "Test drive"
        : entry.source === "phone"
          ? "Phone enquiry"
          : entry.source === "website_callback"
            ? "Callback request"
            : "Enquiry",
      state: entry.appointmentCancelledAt
        ? "Cancelled"
        : entry.status === "closed"
          ? "Closed"
          : entry.callOutcome
            ? callOutcomes[entry.callOutcome as CallOutcome]
            : "Open",
      appointment: entry.appointmentAt
        ? `${entry.appointmentCancelledAt ? "Cancelled appointment" : "Appointment"}: ${appointmentLabel(entry.appointmentAt)}`
        : null,
      message: entry.message,
      note: entry.staffNote,
      owner: entry.assignedToName,
    })),
  ].sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
  if (!timeline.length)
    return compact ? null : (
      <p className="enquiry-history-empty">
        No matching enquiries found for this phone or email.
      </p>
    );
  const history = (
    <section className="enquiry-customer-history enquiry-history-panel">
      <header className="enquiry-history-heading">
        <h3>
          Customer history · {timeline.length}{" "}
          {timeline.length === 1 ? "record" : "records"}
        </h3>
        <p>Most recent first. Matched by phone or email.</p>
      </header>
      <p className="enquiry-history-identity-note">
        Check the name before using details from a shared phone or email.
        Records stay separate.
      </p>
      <ol className="enquiry-history-records">
        {(compact && !showAll ? timeline.slice(0, 3) : timeline).map((item) => {
          const nextContact = {
            customerName: item.name,
            phone: item.phone,
            email: item.email,
          };
          const key = JSON.stringify([item.id, contact, nextContact]);
          const needsReview = item.match.status === "review";
          return (
            <li key={item.id}>
              <article
                className="enquiry-history-record"
                data-record-type={item.recordType}
              >
                <header className="enquiry-history-record-heading">
                  <span className="enquiry-history-type">{item.type}</span>
                  <time dateTime={item.at || undefined}>
                    {item.at && Number.isFinite(Date.parse(item.at))
                      ? new Intl.DateTimeFormat("en-GB", {
                          dateStyle: "medium",
                          timeZone: "Europe/London",
                        }).format(new Date(item.at))
                      : "Date not supplied"}
                  </time>
                </header>
                <div className="enquiry-history-record-title">
                  <h4>{item.title}</h4>
                  <span className="enquiry-history-state">{item.state}</span>
                </div>
                <p className="enquiry-history-customer">
                  {item.name}
                  {item.owner && <span>Assigned to {item.owner}</span>}
                </p>
                {item.appointment && (
                  <p className="enquiry-history-appointment">
                    {item.appointment}
                  </p>
                )}
                {item.message && (
                  <p className="enquiry-history-message">{item.message}</p>
                )}
                {item.note && (
                  <details className="enquiry-history-note">
                    <summary>Internal note</summary>
                    <p>{item.note}</p>
                  </details>
                )}
                <ContactMatchNote match={item.match} />
                <div className="enquiry-history-record-actions">
                  <Link
                    href={customerHistoryHref(item.recordType, item.recordId)}
                  >
                    Open full customer history
                  </Link>
                  {onReuse &&
                    (needsReview ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setReviewKey(reviewKey === key ? "" : key)
                        }
                      >
                        Review {item.name}’s details
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => onReuse(nextContact)}
                      >
                        Use {item.name}’s details
                      </Button>
                    ))}
                </div>
                {onReuse && needsReview && reviewKey === key && (
                  <div
                    className="enquiry-history-contact-review"
                    role="group"
                    aria-label={`Review contact details for ${item.name}`}
                  >
                    <p className="font-semibold">
                      Confirm with the customer before replacing the form
                      details.
                    </p>
                    <p>
                      On this form: {contact.customerName || "Name not entered"}{" "}
                      · {contact.phone || "No phone"} ·{" "}
                      {contact.email || "No email"}
                    </p>
                    <p>
                      From {item.title}: {item.name} ·{" "}
                      {item.phone || "No phone"} · {item.email || "No email"}
                    </p>
                    <p className="text-xs">
                      This updates the form only. It does not merge or change
                      the original records.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          onReuse(nextContact);
                          setReviewKey("");
                        }}
                      >
                        Use reviewed details
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setReviewKey("")}
                      >
                        Keep current details
                      </Button>
                    </div>
                  </div>
                )}
              </article>
            </li>
          );
        })}
      </ol>
      {compact && timeline.length > 3 && (
        <Button
          className="enquiry-history-show-more"
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={showAll}
          onClick={() => setShowAll((value) => !value)}
        >
          {showAll
            ? "Show recent records"
            : `View all ${timeline.length} records`}
        </Button>
      )}
    </section>
  );
  return compact ? (
    <details className="enquiry-linked-history">
      <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">
        Customer history · {timeline.length}{" "}
        {timeline.length === 1 ? "record" : "records"}
      </summary>
      {history}
    </details>
  ) : (
    history
  );
}

function ContactMatchNote({ match }: { match: CustomerContactMatch }) {
  return (
    <div
      className="enquiry-history-match"
      data-review={match.status === "review"}
    >
      <p>
        {match.label}
        {match.status === "review" ? " · Review needed" : ""}
      </p>
      {match.issues.map((issue) => (
        <p key={issue}>{issue}</p>
      ))}
    </div>
  );
}
