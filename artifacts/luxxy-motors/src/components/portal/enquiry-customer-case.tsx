import { useId, useRef, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetStaffDirectory,
  useUpdateEnquiryWorkspace,
  type Enquiry,
} from "@workspace/api-client-react";
import {
  Phone,
  CarFront,
  CalendarDays,
  Mail,
  UserRound,
  MoreHorizontal,
  Clock3,
  X,
  History,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getThumbnailUrl, formatPrice } from "@/lib/utils";
import { appointmentLabel } from "@/lib/test-drive-dates";
import { inboxRelativeTime, inboxState } from "@/lib/inbox-model";
import { enquiryPresentation } from "@/lib/enquiry-presentation";
import type { InboxEnquiry } from "@/lib/enquiry-reply-attention";
import type { Car } from "@/lib/stock-context";
import { enquirySummaryKey } from "@/lib/enquiry-summary-query";
import { useStaffAccess } from "./dealer-administration";
import {
  AttendanceControls,
  useRefreshDesk,
  workspaceError,
} from "./enquiry-workspace-tools";
import { CustomerActivityTimeline } from "./enquiry-conversation";
import { EnquiryResolutionAction } from "./enquiry-resolution-action";
import { EnquiryReplyDesk } from "./enquiry-reply-desk";
import { EnquiryChecks } from "./enquiry-checks";
import { AppointmentExceptionLabels } from "./enquiry-calendar";
import { DeleteEnquiry } from "./delete-enquiry";
import { HistoryLinks } from "./history-links";
import type { EnquiryRecordActions } from "./enquiry-record-browser";
import type { ReplyInsertion } from "./enquiry-email-composer";
import "./enquiry-customer-case.css";

function ClaimEnquiry({ entry }: { entry: Enquiry }) {
  const directory = useGetStaffDirectory();
  const mutation = useUpdateEnquiryWorkspace();
  const refresh = useRefreshDesk();
  if (entry.assignedToId) return null;
  return (
    <div className="enquiry-claim-action">
      <Button
        size="sm"
        variant="outline"
        disabled={mutation.isPending || !directory.data?.currentUserId}
        onClick={async () => {
          try {
            await mutation.mutateAsync({
              id: entry.id,
              data: {
                expectedRevision: entry.workspaceRevision ?? 0,
                assignedToId: directory.data!.currentUserId,
              },
            });
            await refresh();
          } catch {}
        }}
      >
        {mutation.isPending ? "Assigning…" : "Assign to me"}
      </Button>
      {directory.isError && (
        <p role="alert" className="text-xs text-destructive">
          Staff directory unavailable. Refresh to retry.
        </p>
      )}
      {mutation.isError && (
        <p role="alert" className="text-xs text-destructive">
          {workspaceError(mutation.error)}
        </p>
      )}
    </div>
  );
}

/** The same customer case is opened from Inbox, Cars and the appointment diary. */
export function EnquiryCustomerCase({
  entry,
  entries = [entry],
  car,
  cars = [],
  actions,
}: {
  entry: Enquiry;
  entries?: readonly Enquiry[];
  car?: Car;
  cars?: readonly Car[];
  actions: EnquiryRecordActions;
}) {
  const access = useStaffAccess();
  const canManage =
    access.data?.permissions.includes("sales.manage") === true &&
    !access.isError;
  const canReply = canManage && Boolean(actions.onEmail);
  const presentation = enquiryPresentation(entry);
  const state = inboxState(entry);
  const pendingReply = ((entry as InboxEnquiry).pendingEmailReplies ?? 0) > 0;
  const [photoFailed, setPhotoFailed] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [requestedChannel, setRequestedChannel] = useState<
    "email" | "whatsapp" | "note"
  >("email");
  const [insertion, setInsertion] = useState<ReplyInsertion>();
  const [replyBusy, setReplyBusy] = useState(false);
  const [context, setContext] = useState<"vehicle" | "customer" | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const contextId = useId();
  const insertionId = useRef(0);
  const cache = useQueryClient();
  const refresh = useRefreshDesk();
  const future = Boolean(
    entry.appointmentAt &&
    Date.parse(entry.appointmentAt) > Date.now() &&
    !entry.appointmentCancelledAt,
  );
  const visitFinished =
    entry.attendance === "completed" || entry.attendance === "no_show";
  const canBook = (!future || visitFinished) && actions.canBook !== false;
  const outstanding = Boolean(entry.followUpAt && !entry.followUpCompletedAt);
  const bookingRequested = Boolean(
    entry.appointmentAt &&
    !entry.appointmentCancelledAt &&
    entry.appointmentStatus === "pending" &&
    !visitFinished,
  );
  const receivedAt =
    entry.createdAt && Number.isFinite(Date.parse(entry.createdAt))
      ? entry.createdAt
      : null;
  function toggleContext(panel: typeof context) {
    setActivityOpen(false);
    setContext((current) => (current === panel ? null : panel));
  }
  function insertIntoReply(text: string) {
    setInsertion({ id: ++insertionId.current, text });
    setFocusRequest((value) => value + 1);
    setRequestedChannel("email");
  }
  function reply(channel: typeof requestedChannel = "email") {
    setRequestedChannel(channel);
    setFocusRequest((value) => value + 1);
  }
  function nextAction() {
    if (pendingReply || presentation.action === "respond")
      return canReply
        ? reply(
            entry.preferredContact === "phone"
              ? "note"
              : entry.preferredContact === "whatsapp"
                ? "whatsapp"
                : "email",
          )
        : actions.onConversation(entry);
    if (presentation.action === "follow_up") return actions.onFollowUp(entry);
    if (
      presentation.action === "appointment" &&
      entry.appointmentStatus === "pending"
    )
      return actions.onUpdate(entry);
    if (presentation.action === "appointment" && future)
      return actions.onAppointment(entry);
    if (
      presentation.action === "update" ||
      presentation.action === "appointment"
    )
      return actions.onUpdate(entry);
    if (presentation.action === "conversation") return reply("note");
  }
  const needsSenderReview =
    ((entry as InboxEnquiry).emailRepliesToReview ?? 0) > 0;
  const needsAction =
    needsSenderReview ||
    presentation.action === "follow_up" ||
    presentation.action === "update";
  return (
    <article
      className="enquiry-customer-case"
      data-context-open={context ? "true" : "false"}
      aria-label={`Customer workspace for ${entry.customerName}`}
    >
      <header className="enquiry-case-header">
        <div className="enquiry-case-heading">
          <span className="enquiry-case-avatar" aria-hidden>
            {entry.customerName.trim().slice(0, 1).toUpperCase() || "?"}
          </span>
          <div className="enquiry-case-identity">
            <h3>{entry.customerName}</h3>
            <p>
              <span>{presentation.source}</span>
              <span>{presentation.purpose}</span>
              {receivedAt && (
                <time
                  dateTime={receivedAt}
                  title={appointmentLabel(receivedAt)}
                >
                  {inboxRelativeTime(receivedAt)}
                </time>
              )}
            </p>
          </div>
          <span
            className="enquiry-state-label"
            data-tone={state.tone}
            title={state.detail}
          >
            {state.label}
          </span>
        </div>
        <div
          className="enquiry-case-contact"
          aria-label="Customer contact details"
        >
          {entry.phone && (
            <a href={`tel:${entry.phone.replace(/[^+\d]/g, "")}`}>
              <Phone size={15} aria-hidden />
              {entry.phone}
            </a>
          )}
          {entry.email &&
            (canReply ? (
              <button type="button" onClick={() => reply("email")}>
                <Mail size={15} aria-hidden />
                {entry.email}
              </button>
            ) : (
              <span>
                <Mail size={15} aria-hidden />
                {entry.email}
              </span>
            ))}
          {!entry.phone && !entry.email && (
            <span>No contact details recorded</span>
          )}
        </div>
        <div className="enquiry-case-vehicle-strip">
          <CarFront size={17} aria-hidden />
          <strong>{entry.vehicleTitle || "General showroom enquiry"}</strong>
          {entry.vehicleRegistration && (
            <span>{entry.vehicleRegistration}</span>
          )}
          {(car?.price ?? entry.vehiclePrice) != null && (
            <span>{formatPrice((car?.price ?? entry.vehiclePrice)!)}</span>
          )}
        </div>
        <div className="enquiry-case-toolbar" aria-label="Enquiry tools">
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-expanded={context === "vehicle"}
            aria-controls={
              context === "vehicle" ? `${contextId}-vehicle` : undefined
            }
            onClick={() => toggleContext("vehicle")}
          >
            <CarFront size={16} aria-hidden />
            Car &amp; MOT
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-expanded={context === "customer"}
            aria-controls={
              context === "customer" ? `${contextId}-customer` : undefined
            }
            onClick={() => toggleContext("customer")}
          >
            <UserRound size={16} aria-hidden />
            Customer details
          </Button>
          {canManage && (
            <EnquiryResolutionAction
              entry={entry}
              disabled={replyBusy}
              linkedCount={entries.length}
            />
          )}
          {canManage && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label="More enquiry actions"
                >
                  <MoreHorizontal size={18} aria-hidden />
                  <span>More</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="enquiry-case-action-menu"
                align="end"
              >
                <DropdownMenuItem
                  onSelect={() =>
                    canReply ? reply("note") : actions.onConversation(entry)
                  }
                >
                  <Phone size={16} aria-hidden />
                  Log call
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => actions.onFollowUp(entry)}>
                  <Clock3 size={16} aria-hidden />
                  {outstanding ? "Manage follow-up" : "Set follow-up"}
                </DropdownMenuItem>
                {canBook && (
                  <DropdownMenuItem onSelect={() => actions.onBook(entry)}>
                    <CalendarDays size={16} aria-hidden />
                    {entry.appointmentAt
                      ? "Book another test drive"
                      : "Book test drive"}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link
                    href={`/portal?section=sales&enquiryId=${encodeURIComponent(entry.id)}`}
                  >
                    Start sale
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => actions.onUpdate(entry)}>
                  Update enquiry
                </DropdownMenuItem>
                {actions.onMerge && (
                  <DropdownMenuItem onSelect={() => actions.onMerge?.(entry)}>
                    Merge records
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>
      <div
        className="enquiry-case-columns"
        data-context-open={context ? "true" : "false"}
      >
        {context && (
          <aside
            className="enquiry-case-context"
            aria-label={
              context === "vehicle"
                ? "Vehicle and checks"
                : "Customer details and history"
            }
          >
            <div className="enquiry-case-panel-heading">
              <h4>
                {context === "vehicle" ? "Car & MOT" : "Customer details"}
              </h4>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Close details"
                onClick={() => setContext(null)}
              >
                <X size={17} aria-hidden />
              </Button>
            </div>
            {context === "vehicle" ? (
              <div
                id={`${contextId}-vehicle`}
                className="enquiry-case-panel-body"
              >
                <section
                  className="enquiry-case-car"
                  aria-label="Enquiry vehicle"
                >
                  {car &&
                    (getThumbnailUrl(car) && !photoFailed ? (
                      <img
                        src={getThumbnailUrl(car)}
                        alt=""
                        loading="lazy"
                        onError={() => setPhotoFailed(true)}
                      />
                    ) : (
                      <span
                        className="enquiry-case-car-placeholder"
                        aria-hidden
                      >
                        <CarFront size={28} />
                      </span>
                    ))}
                  <div>
                    <h4>{entry.vehicleTitle || "General showroom enquiry"}</h4>
                    {entry.vehicleRegistration && (
                      <p>{entry.vehicleRegistration}</p>
                    )}
                    {entry.vehicleId && (
                      <p>
                        {car
                          ? car.inventoryStatus === "available"
                            ? "Available"
                            : car.inventoryStatus === "reserved"
                              ? "Reserved"
                              : "Availability unconfirmed"
                          : "No longer in current stock"}
                      </p>
                    )}
                    {(car?.price ?? entry.vehiclePrice) != null && (
                      <strong>
                        {formatPrice((car?.price ?? entry.vehiclePrice)!)}
                      </strong>
                    )}
                    {!entry.vehicleId && entry.vehicleTitle && (
                      <p>Ad hoc vehicle</p>
                    )}
                  </div>
                  {car && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => actions.onVehicle(car)}
                    >
                      Vehicle information
                    </Button>
                  )}
                </section>
                <EnquiryChecks
                  entry={entry}
                  car={car}
                  canManage={canManage}
                  onInsertText={
                    canReply && !replyBusy ? insertIntoReply : undefined
                  }
                />
                <HistoryLinks
                  vehicleId={entry.vehicleId}
                  vehicle={Boolean(entry.vehicleId || entry.vehicleTitle)}
                />
              </div>
            ) : (
              <div
                id={`${contextId}-customer`}
                className="enquiry-case-panel-body"
              >
                <dl className="enquiry-case-customer-facts">
                  <div>
                    <dt>Assigned to</dt>
                    <dd>{entry.assignedToName || "Unassigned"}</dd>
                  </div>
                  <div>
                    <dt>Preferred contact</dt>
                    <dd>{entry.preferredContact || "Not specified"}</dd>
                  </div>
                  <div>
                    <dt>Reference</dt>
                    <dd>{entry.reference}</dd>
                  </div>
                  {receivedAt && (
                    <div>
                      <dt>Received</dt>
                      <dd>{appointmentLabel(receivedAt)}</dd>
                    </div>
                  )}
                </dl>
                {canManage && <ClaimEnquiry entry={entry} />}
                <div className="enquiry-case-history-actions">
                  {actions.onCustomerHistory && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => actions.onCustomerHistory?.(entry)}
                    >
                      <History size={16} aria-hidden />
                      Customer history
                    </Button>
                  )}
                  <HistoryLinks
                    vehicle={false}
                    recordType={
                      actions.onCustomerHistory ? undefined : "enquiry"
                    }
                    recordId={entry.id}
                  />
                </div>
                <details
                  className="enquiry-case-customer-activity"
                  onToggle={(event) =>
                    setActivityOpen(event.currentTarget.open)
                  }
                >
                  <summary>Website &amp; booking activity</summary>
                  {activityOpen && (
                    <CustomerActivityTimeline
                      compact
                      activityOnly
                      entry={entry}
                      entries={entries}
                    />
                  )}
                </details>
                <p className="enquiry-case-history-note">
                  Customer history includes previous enquiries, bookings and
                  purchases.
                </p>
                {entry.followUpAt && (
                  <section className="enquiry-case-followup">
                    <h4>
                      {entry.followUpCompletedAt
                        ? "Follow-up completed"
                        : "Follow-up"}
                    </h4>
                    <p>{appointmentLabel(entry.followUpAt)}</p>
                    {entry.followUpNote && <p>{entry.followUpNote}</p>}
                  </section>
                )}
                {canManage && (
                  <div className="enquiry-case-record-tools">
                    <DeleteEnquiry
                      entry={entry}
                      onDeleted={actions.onDeletedEnquiry}
                    />
                  </div>
                )}
              </div>
            )}
          </aside>
        )}
        <div className="enquiry-case-main">
          {bookingRequested ? (
            <section
              className="enquiry-case-appointment"
              data-booking-state="pending"
              aria-label="Current test-drive appointment"
            >
              <CalendarDays size={21} aria-hidden />
              <div className="enquiry-case-booking-copy">
                <h4>Test-drive request</h4>
                <p>{appointmentLabel(entry.appointmentAt!)}</p>
                <AppointmentExceptionLabels booking={entry} />
                <span>Awaiting your confirmation</span>
              </div>
              {canManage && (
                <div className="enquiry-case-booking-actions">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => actions.onUpdate(entry)}
                  >
                    Review &amp; confirm
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => actions.onAppointment(entry)}
                  >
                    Suggest another time
                  </Button>
                </div>
              )}
            </section>
          ) : (
            entry.appointmentAt && (
              <section
                className="enquiry-case-appointment"
                data-booking-state={
                  entry.appointmentCancelledAt ? "cancelled" : "confirmed"
                }
                aria-label="Current test-drive appointment"
              >
                <CalendarDays size={21} aria-hidden />
                <div className="enquiry-case-booking-copy">
                  <h4>
                    {entry.appointmentCancelledAt
                      ? "Cancelled test drive"
                      : visitFinished
                        ? "Test-drive visit"
                        : "Test drive booked"}
                  </h4>
                  <p>{appointmentLabel(entry.appointmentAt)}</p>
                  <AppointmentExceptionLabels booking={entry} />
                </div>
                {canManage && !entry.appointmentCancelledAt && (
                  <details className="enquiry-case-visit-tools">
                    <summary>Manage visit</summary>
                    <div>
                      <AttendanceControls entry={entry} />
                      {future && !visitFinished && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => actions.onAppointment(entry)}
                        >
                          Change appointment
                        </Button>
                      )}
                    </div>
                  </details>
                )}
              </section>
            )
          )}
          {needsAction && (
            <section
              className="enquiry-case-next-action"
              data-tone={presentation.tone}
              aria-label="Recommended next action"
            >
              <div>
                <h4>
                  {needsSenderReview
                    ? "Review incoming email"
                    : presentation.nextAction}
                </h4>
                <p>
                  {needsSenderReview
                    ? "Check the sender and message in the conversation before replying."
                    : presentation.reason}
                </p>
                {presentation.dueAt && (
                  <time dateTime={presentation.dueAt}>
                    {appointmentLabel(presentation.dueAt)}
                  </time>
                )}
              </div>
              {canManage && !needsSenderReview && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={nextAction}
                >
                  {presentation.nextAction}
                </Button>
              )}
            </section>
          )}
          <CustomerActivityTimeline
            compact
            entry={entry}
            entries={entries}
            canEmail={canReply}
            cars={cars}
            onInsertText={canReply && !replyBusy ? insertIntoReply : undefined}
          />
          {canReply && (
            <EnquiryReplyDesk
              key={entry.id}
              entry={entry}
              insertion={insertion}
              focusRequest={focusRequest}
              requestedChannel={requestedChannel}
              onBusyChange={setReplyBusy}
              onSaved={async (updated) => {
                cache.setQueryData<Enquiry[]>(enquirySummaryKey(), (current) =>
                  current?.map((item) =>
                    item.id === updated.id ? updated : item,
                  ),
                );
                await refresh();
              }}
            />
          )}
        </div>
      </div>
    </article>
  );
}
