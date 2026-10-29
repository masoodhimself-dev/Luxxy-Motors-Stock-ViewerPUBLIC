import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetStaffDirectory,
  useUpdateEnquiryWorkspace,
  type Enquiry,
} from "@workspace/api-client-react";
import { Phone, CarFront, CalendarDays } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { getThumbnailUrl, formatPrice } from "@/lib/utils";
import { appointmentLabel } from "@/lib/test-drive-dates";
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
  actions,
}: {
  entry: Enquiry;
  entries?: readonly Enquiry[];
  car?: Car;
  actions: EnquiryRecordActions;
}) {
  const access = useStaffAccess();
  const canManage =
    access.data?.permissions.includes("sales.manage") === true &&
    !access.isError;
  const canReply = canManage && Boolean(actions.onEmail);
  const presentation = enquiryPresentation(entry);
  const pendingReply = ((entry as InboxEnquiry).pendingEmailReplies ?? 0) > 0;
  const [photoFailed, setPhotoFailed] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [requestedChannel, setRequestedChannel] = useState<
    "email" | "whatsapp" | "note"
  >("email");
  const [insertion, setInsertion] = useState<ReplyInsertion>();
  const [replyBusy, setReplyBusy] = useState(false);
  const [contextOpen, setContextOpen] = useState(
    () => window.matchMedia("(min-width: 1380px)").matches,
  );
  useEffect(() => {
    const query = window.matchMedia("(min-width: 1380px)");
    const update = () => setContextOpen(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
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
  const nextLabel = pendingReply
    ? "Read & reply"
    : presentation.action === "respond"
      ? "Respond"
      : presentation.action === "conversation"
        ? "Record conversation"
        : presentation.nextAction;
  return (
    <article
      className="enquiry-customer-case"
      aria-label={`Customer workspace for ${entry.customerName}`}
    >
      <header className="enquiry-detail-customer">
        <div className="enquiry-detail-heading">
          <div>
            <p className="enquiry-detail-eyebrow">
              {presentation.purpose} · {presentation.source}
            </p>
            <h3>{entry.customerName}</h3>
          </div>
          <span className="enquiry-state-label" data-tone={presentation.tone}>
            {presentation.state}
          </span>
        </div>
        <div className="enquiry-detail-contact">
          {entry.phone ? (
            <a href={`tel:${entry.phone.replace(/[^+\d]/g, "")}`}>
              <Phone aria-hidden className="h-4 w-4" />
              {entry.phone}
            </a>
          ) : (
            <p className="text-sm text-muted-foreground">No phone supplied</p>
          )}
          {entry.email &&
            (canReply ? (
              <button
                type="button"
                className="underline underline-offset-4"
                onClick={() => reply("email")}
              >
                {entry.email}
              </button>
            ) : (
              <span>{entry.email}</span>
            ))}
        </div>
        <div className="enquiry-detail-owner">
          <p className="text-xs text-muted-foreground">
            Assigned to <strong>{entry.assignedToName || "Unassigned"}</strong>
          </p>
          {canManage && <ClaimEnquiry entry={entry} />}
        </div>
      </header>
      <div className="enquiry-case-columns">
        <div className="enquiry-case-main">
          <section
            className="enquiry-action-plan"
            data-tone={presentation.tone}
            aria-label="Recommended next action"
          >
            <div>
              <h4>{presentation.nextAction}</h4>
              <p className="enquiry-case-action-preview">
                {pendingReply && (entry as InboxEnquiry).latestReplyText
                  ? `“${(entry as InboxEnquiry).latestReplyText}”`
                  : presentation.reason}
              </p>
              {presentation.dueAt && (
                <time dateTime={presentation.dueAt}>
                  {appointmentLabel(presentation.dueAt)}
                </time>
              )}
            </div>
            {canManage && presentation.action !== "none" && (
              <Button size="sm" onClick={nextAction}>
                {nextLabel}
              </Button>
            )}
          </section>
          {canManage && (
            <div
              className="enquiry-case-actions"
              aria-label="Customer next steps"
            >
              {canReply && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => reply("note")}
                >
                  Log call
                </Button>
              )}
              {!canReply && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => actions.onConversation(entry)}
                >
                  Log call
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => actions.onFollowUp(entry)}
              >
                {outstanding ? "Manage follow-up" : "Set follow-up"}
              </Button>
              {canBook && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => actions.onBook(entry)}
                >
                  <CalendarDays size={15} aria-hidden />
                  {entry.appointmentAt
                    ? "Book another test drive"
                    : "Book test drive"}
                </Button>
              )}
              <Button size="sm" variant="outline" asChild>
                <Link
                  href={`/portal?section=sales&enquiryId=${encodeURIComponent(entry.id)}`}
                >
                  Start sale
                </Link>
              </Button>
            </div>
          )}
          {entry.appointmentAt && (
            <section
              className="enquiry-case-appointment"
              aria-label="Current test-drive appointment"
            >
              <div>
                <strong>
                  Test drive · {appointmentLabel(entry.appointmentAt)}
                </strong>
                <AppointmentExceptionLabels booking={entry} />
              </div>
              {canManage && (
                <div>
                  <AttendanceControls entry={entry} />
                  {future && !visitFinished && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => actions.onAppointment(entry)}
                    >
                      Change appointment
                    </Button>
                  )}
                </div>
              )}
            </section>
          )}
          <CustomerActivityTimeline
            entry={entry}
            entries={entries}
            canEmail={canReply}
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
        <aside className="enquiry-case-context" aria-label="Vehicle and checks">
          <details
            className="enquiry-case-context-disclosure"
            open={contextOpen}
            onToggle={(event) => setContextOpen(event.currentTarget.open)}
          >
            <summary>
              <span>Vehicle &amp; checks</span>
              <strong>
                {entry.vehicleTitle || "General enquiry"}
                {car?.price != null ? ` · ${formatPrice(car.price)}` : ""}
              </strong>
            </summary>
            <div>
              <section
                className="enquiry-detail-car"
                aria-label="Enquiry vehicle"
              >
                {car &&
                  (getThumbnailUrl(car) && !photoFailed ? (
                    <img
                      src={getThumbnailUrl(car)}
                      alt=""
                      loading="lazy"
                      onError={() => setPhotoFailed(true)}
                      className="enquiry-detail-car-photo"
                    />
                  ) : (
                    <span className="enquiry-car-placeholder" aria-hidden>
                      <CarFront size={28} />
                    </span>
                  ))}
                <div className="enquiry-detail-car-copy">
                  <h4>{entry.vehicleTitle || "General showroom enquiry"}</h4>
                  {entry.vehicleRegistration && (
                    <p className="text-sm font-medium">
                      {entry.vehicleRegistration}
                    </p>
                  )}
                  {entry.vehicleId && (
                    <p className="enquiry-detail-availability">
                      {car
                        ? car.inventoryStatus === "available"
                          ? "Available"
                          : car.inventoryStatus === "reserved"
                            ? "Reserved"
                            : "Availability unconfirmed"
                        : "No longer in current stock"}
                    </p>
                  )}
                  {car?.price != null && (
                    <p className="text-sm font-semibold">
                      {formatPrice(car.price)}
                    </p>
                  )}
                  {!entry.vehicleId && entry.vehicleTitle && (
                    <p className="text-xs text-muted-foreground">
                      Ad hoc vehicle
                      {entry.vehiclePrice != null
                        ? ` · ${formatPrice(entry.vehiclePrice)}`
                        : ""}
                    </p>
                  )}
                </div>
                {car && (
                  <Button
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
                  canReply && !replyBusy
                    ? (text) => {
                        setInsertion({ id: ++insertionId.current, text });
                        setFocusRequest((value) => value + 1);
                        setRequestedChannel("email");
                      }
                    : undefined
                }
              />
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
              <details className="enquiry-detail-more enquiry-context-details">
                <summary>Customer details &amp; history</summary>
                <div className="enquiry-case-more">
                  <p className="text-xs text-muted-foreground">
                    {entry.reference}
                    {entry.createdAt
                      ? ` · Received ${appointmentLabel(entry.createdAt)}`
                      : ""}
                    {entry.preferredContact
                      ? ` · Preferred contact: ${entry.preferredContact}`
                      : ""}
                  </p>
                  {actions.onCustomerHistory && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => actions.onCustomerHistory?.(entry)}
                    >
                      Customer history
                    </Button>
                  )}
                  <HistoryLinks
                    vehicleId={entry.vehicleId}
                    recordType={
                      actions.onCustomerHistory ? undefined : "enquiry"
                    }
                    recordId={entry.id}
                    vehicle={Boolean(entry.vehicleId || entry.vehicleTitle)}
                  />
                  {canManage && (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => actions.onUpdate(entry)}
                      >
                        Update enquiry
                      </Button>
                      {actions.onMerge && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => actions.onMerge?.(entry)}
                        >
                          Merge records
                        </Button>
                      )}
                      <DeleteEnquiry
                        entry={entry}
                        onDeleted={actions.onDeletedEnquiry}
                      />
                    </>
                  )}
                </div>
              </details>
            </div>
          </details>
        </aside>
      </div>
    </article>
  );
}
