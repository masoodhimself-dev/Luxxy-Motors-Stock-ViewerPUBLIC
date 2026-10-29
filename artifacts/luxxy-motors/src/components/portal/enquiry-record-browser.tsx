import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "@/components/icons";
import type { Enquiry } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { appointmentLabel } from "@/lib/test-drive-dates";
import type { Car } from "@/lib/stock-context";
import { EnquiryCustomerCase } from "./enquiry-customer-case";
import { callbackTiming } from "./enquiry-callback-model";
import { enquiryGroup, primaryEnquiry } from "@/lib/enquiry-groups";
import type { InboxEnquiry } from "@/lib/enquiry-reply-attention";
import {
  enquiryPresentation,
  enquiryRequestText,
} from "@/lib/enquiry-presentation";
import "./enquiry-record-browser.css";

export type EnquiryRecordActions = {
  onDeletedEnquiry?: (id: string) => void;
  onUpdate: (entry: Enquiry) => void;
  onConversation: (entry: Enquiry) => void;
  onFollowUp: (entry: Enquiry) => void;
  onAppointment: (entry: Enquiry) => void;
  onBook: (entry: Enquiry) => void;
  canBook?: boolean;
  onVehicle: (car: Car) => void;
  onMerge?: (entry: Enquiry) => void;
  onEmail?: (entry: Enquiry) => void;
  onCustomerHistory?: (entry: Enquiry) => void;
  onAppointmentFollowUp?: (entry: Enquiry) => void;
};

export function EnquiryRecordBrowser({
  entries,
  allEntries = entries,
  cars,
  selectedId,
  onSelect,
  onBack,
  actions,
  callbacks = false,
  emptyMessage = "No matching enquiries. Try another name or phone number.",
}: {
  entries: Enquiry[];
  allEntries?: Enquiry[];
  cars: Car[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onBack: () => void | boolean;
  actions: EnquiryRecordActions;
  callbacks?: boolean;
  emptyMessage?: string;
}) {
  const selectedRoot =
    entries.find((entry) =>
      enquiryGroup(entry, allEntries).some(
        (original) => original.id === selectedId,
      ),
    ) ?? entries[0];
  const group = selectedRoot ? enquiryGroup(selectedRoot, allEntries) : [];
  const selected =
    group.find((original) => original.id === selectedId) ?? selectedRoot;
  const primary = selected ? primaryEnquiry(selected, allEntries) : undefined;
  const linkedWork = group.filter(
    (original) =>
      original.id !== selected?.id &&
      enquiryPresentation(original).action !== "none",
  );
  const explicitSelection = Boolean(
    selectedId && group.some((entry) => entry.id === selectedId),
  );
  const detail = useRef<HTMLDivElement>(null);
  const [openedOriginals, setOpenedOriginals] = useState<Set<string>>(
    () => new Set(),
  );
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (detail.current) detail.current.scrollTop = 0;
    if (explicitSelection && window.matchMedia("(max-width: 899px)").matches) {
      detail.current?.focus();
      detail.current?.scrollIntoView({ block: "start" });
    }
  }, [selected?.id, selectedId, explicitSelection]);
  if (!entries.length)
    return (
      <p
        role="status"
        className="px-4 py-6 text-center text-sm text-muted-foreground"
      >
        {!allEntries.length &&
        !callbacks &&
        emptyMessage ===
          "No matching enquiries. Try another name or phone number."
          ? "No enquiries yet. Use Quick enquiry to record a call; website enquiries will appear here."
          : emptyMessage}
      </p>
    );
  return (
    <div
      className="enquiry-record-browser"
      data-selected={explicitSelection ? "true" : "false"}
    >
      <div
        ref={list}
        tabIndex={-1}
        className="enquiry-record-list-pane"
        aria-label={callbacks ? "Callback requests" : "Enquiry records"}
      >
        <p className="enquiry-record-count">
          {entries.length}{" "}
          {callbacks
            ? entries.length === 1
              ? "callback"
              : "callbacks"
            : entries.length === 1
              ? "enquiry"
              : "enquiries"}
        </p>
        <ul className="enquiry-compact-list">
          {entries.map((entry) => {
            const ownSummary = enquiryPresentation(entry);
            const urgentOriginal =
              [...enquiryGroup(entry, allEntries)].sort(
                (a, b) =>
                  enquiryPresentation(a).priority -
                  enquiryPresentation(b).priority,
              )[0] ?? entry;
            const summary = enquiryPresentation(urgentOriginal);
            return (
              <li
                key={entry.id}
                data-tone={summary.tone}
                data-testid={`enquiry-${entry.id}`}
              >
                <button
                  type="button"
                  className="enquiry-record-select"
                  aria-label={`Open enquiry for ${entry.customerName}, ${entry.vehicleTitle || "general enquiry"}`}
                  aria-pressed={selectedRoot?.id === entry.id}
                  onClick={() => onSelect(urgentOriginal.id)}
                >
                  <span className="enquiry-record-row-heading">
                    <strong>
                      <span
                        className="enquiry-customer-initial"
                        aria-hidden="true"
                      >
                        {entry.customerName.trim().slice(0, 1).toUpperCase() ||
                          "?"}
                      </span>
                      {entry.customerName}
                    </strong>
                    <span
                      className="enquiry-state-label"
                      data-tone={summary.tone}
                    >
                      {summary.state}
                    </span>
                    {callbacks && (
                      <span
                        className={`enquiry-callback-badge enquiry-callback-${callbackTiming(entry)}`}
                      >
                        {callbackTiming(entry) === "overdue"
                          ? "Overdue now"
                          : callbackTiming(entry) === "upcoming"
                            ? "Upcoming"
                            : "Needs a time"}
                      </span>
                    )}
                  </span>
                  <span className="enquiry-record-row-purpose">
                    {summary.purpose} <span>{summary.source}</span>
                  </span>
                  <span className="enquiry-record-row-car">
                    {entry.vehicleTitle || "General showroom enquiry"}
                    {entry.vehicleRegistration
                      ? ` · ${entry.vehicleRegistration}`
                      : ""}
                  </span>
                  {((entry as InboxEnquiry).latestReplyText ||
                    entry.message) && (
                    <span className="enquiry-record-row-message">
                      {(entry as InboxEnquiry).latestReplyText
                        ? `Latest reply: ${(entry as InboxEnquiry).latestReplyText}`
                        : enquiryRequestText(entry)}
                    </span>
                  )}
                  <span className="enquiry-record-row-meta">
                    {entry.assignedToName || "Not assigned"}
                    {callbacks && entry.source === "website_callback"
                      ? " · Website request"
                      : ""}
                    {!callbacks && enquiryGroup(entry, allEntries).length > 1
                      ? ` · ${enquiryGroup(entry, allEntries).length} merged records`
                      : ""}
                  </span>
                  {callbacks && (
                    <span className="enquiry-record-row-meta">
                      {entry.phone || entry.email || "Contact not supplied"}
                      {entry.createdAt
                        ? ` · Requested ${appointmentLabel(entry.createdAt)}`
                        : ""}
                    </span>
                  )}
                  {urgentOriginal.id !== entry.id &&
                    summary.priority < ownSummary.priority && (
                      <span className="enquiry-record-row-meta">
                        Next step is on a linked enquiry
                      </span>
                    )}
                  <span className="enquiry-record-row-next">
                    {callbacks && entry.followUpAt
                      ? `Due ${appointmentLabel(entry.followUpAt)}`
                      : summary.nextAction}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <div
        ref={detail}
        tabIndex={-1}
        className="enquiry-record-detail-pane"
        role="region"
        aria-label={`Selected enquiry: ${selected.customerName}`}
      >
        <Button
          className="enquiry-record-back"
          size="sm"
          variant="outline"
          onClick={() => {
            if (onBack() === false) return;
            requestAnimationFrame(() => {
              list.current?.focus();
              list.current?.scrollIntoView({ block: "start" });
            });
          }}
        >
          <ArrowLeft aria-hidden className="mr-1 h-4 w-4" />
          Back to {callbacks ? "callbacks" : "enquiries"}
        </Button>
        {linkedWork.length > 0 && (
          <section
            className="enquiry-linked-work"
            aria-label="Work on linked enquiries"
          >
            <h4>Work on linked enquiries</h4>
            {linkedWork.map((original) => {
              const task = enquiryPresentation(original);
              return (
                <div key={original.id}>
                  <div>
                    <span className="enquiry-state-label" data-tone={task.tone}>
                      {task.state}
                    </span>
                    <p>
                      {original.customerName} —{" "}
                      {original.vehicleTitle || "General enquiry"}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setOpenedOriginals((current) =>
                        new Set(current).add(original.id),
                      );
                      requestAnimationFrame(() =>
                        document
                          .getElementById(`linked-enquiry-${original.id}`)
                          ?.scrollIntoView({ block: "start" }),
                      );
                    }}
                  >
                    Open linked task
                  </Button>
                </div>
              );
            })}
          </section>
        )}
        <EnquiryCustomerCase
          cars={cars}
          key={selected.id}
          entries={group}
          entry={selected}
          car={cars.find((car) => car.id === selected.vehicleId)}
          actions={actions}
        />
        {group.length > 1 && (
          <section
            className="enquiry-linked-originals"
            aria-label="Merged case original records"
          >
            <h4>Merged customer records</h4>
            <p className="text-xs text-muted-foreground">
              Each original keeps its customer, car, appointments, follow-ups
              and conversation history.
            </p>
            {group
              .filter((item) => item.id !== selected.id)
              .map((original) => (
                <details
                  key={original.id}
                  id={`linked-enquiry-${original.id}`}
                  open={openedOriginals.has(original.id)}
                  className="enquiry-linked-original"
                  onToggle={(event) => {
                    const open = event.currentTarget.open;
                    setOpenedOriginals((current) => {
                      const next = new Set(current);
                      if (open) next.add(original.id);
                      else next.delete(original.id);
                      return next;
                    });
                  }}
                >
                  <summary>
                    {original.customerName}
                    {original.createdAt
                      ? ` · ${appointmentLabel(original.createdAt)}`
                      : ""}
                    {original.id === primary?.id ? " · Main record" : ""}
                    <span>
                      {original.vehicleTitle || "General showroom enquiry"}
                      {original.vehicleRegistration
                        ? ` · ${original.vehicleRegistration}`
                        : ""}
                    </span>
                  </summary>
                  {openedOriginals.has(original.id) && (
                    <div>
                      <EnquiryCustomerCase
          cars={cars}
                        entry={original}
                        car={cars.find((car) => car.id === original.vehicleId)}
                        actions={actions}
                      />
                    </div>
                  )}
                </details>
              ))}
          </section>
        )}
      </div>
    </div>
  );
}
