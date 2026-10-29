import type { Enquiry } from "@workspace/api-client-react";
import { callOutcomes, type CallOutcome } from "@/lib/enquiry-desk-model";

/** The existing scoped email journal. No recipient/phone matching is used here. */
export type CaseEmailRecord = {
  key: string;
  kind: "enquiry" | "sale" | "notification" | "reminder" | "reply";
  enquiry_id: string | null;
  subject: string;
  status: string;
  last_event?: string | null;
  created_at: string;
  message?: string | null;
  recipient?: string;
  sale_id?: string | null;
  document_id?: string | null;
  reference?: string;
  attachment_count?: number;
};

export type CaseActivity = {
  key: string;
  enquiryId: string;
  reference: string;
  kind:
    | "original"
    | "internal"
    | "call"
    | "whatsapp"
    | "customer-email"
    | "email"
    | "appointment"
    | "event"
    | "sale";
  channel: string;
  title: string;
  body: string;
  at: string | null;
  author?: string;
  status?: string;
  caution?: string;
  followUpAt?: string | null;
  attachmentCount?: number;
  saleId?: string | null;
};

export function activityTimestamp(value: unknown): number {
  if (value instanceof Date)
    return Number.isFinite(value.getTime()) ? value.getTime() : 0;
  if (typeof value !== "string") return 0;
  const parsed = Date.parse(
    value
      .replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T")
      .replace(/([+-]\d{2})$/, "$1:00"),
  );
  return Number.isFinite(parsed) ? parsed : 0;
}

const recordedAt = (value: unknown) =>
  activityTimestamp(value)
    ? new Date(activityTimestamp(value)).toISOString()
    : null;
const savedText = (value: string | null | undefined) =>
  (value ?? "").replace(/\r\n/g, "\n").trim();

const emailStates: Record<string, string> = {
  sent: "Submitted to email provider",
  delivered: "Delivered",
  sending: "Sending — check before resending",
  unknown: "Acceptance unconfirmed",
  prepared: "Prepared · not sent",
  failed: "Failed",
  delivery_delayed: "Delivery delayed",
  bounced: "Bounced",
  complained: "Reported as spam",
  opened: "Open tracking recorded",
  clicked: "Link tracking recorded",
  suppressed: "Suppressed",
  scheduled: "Scheduled",
  queued: "Queued",
  canceled: "Cancelled",
  reply_needed: "Reply needed",
  review: "Needs review",
  handled: "Handled",
};

export function caseEmailStatus(message: CaseEmailRecord): string {
  return (
    emailStates[message.last_event ?? message.status] ?? "Status unavailable"
  );
}

/** Originals, notes and messages are combined without changing any saved record. */
export function buildCaseActivity(
  entries: readonly Enquiry[],
  emails: readonly CaseEmailRecord[] = [],
): CaseActivity[] {
  const records = [
    ...new Map(entries.map((entry) => [entry.id, entry])).values(),
  ];
  const allowed = new Set(records.map((entry) => entry.id));
  const messages = [
    ...new Map(
      emails
        .filter((email) => email.enquiry_id && allowed.has(email.enquiry_id))
        .map((email) => [email.key, email]),
    ).values(),
  ];
  const result: CaseActivity[] = [];
  // Inbound mail is also mirrored to conversation_logged by the receiving job.
  // Consume one exact saved-body mirror per journal message, per explicit enquiry;
  // distinct customer messages and unrelated staff notes are never collapsed.
  const replyMirrors = new Map<string, number>();
  for (const email of messages) {
    if (email.kind !== "reply" || !savedText(email.message)) continue;
    const key = JSON.stringify([email.enquiry_id, savedText(email.message)]);
    replyMirrors.set(key, (replyMirrors.get(key) ?? 0) + 1);
  }
  for (const entry of records) {
    const base = { enquiryId: entry.id, reference: entry.reference };
    if (entry.message?.trim())
      result.push({
        ...base,
        key: `original:${entry.id}`,
        kind: "original",
        channel: "Original enquiry",
        title:
          entry.source === "website_callback"
            ? "Callback requested"
            : entry.source === "phone" || entry.source === "phone_ad_hoc"
              ? "Showroom enquiry recorded"
              : "Customer enquiry",
        body: entry.message,
        at: recordedAt(entry.createdAt),
        author: entry.customerName,
      });
    if (entry.staffNote?.trim())
      result.push({
        ...base,
        key: `internal:${entry.id}`,
        kind: "internal",
        channel: "Private note",
        title: "Current internal note",
        body: entry.staffNote,
        at: null,
      });
    for (const event of [
      ...new Map(
        (entry.events ?? []).map((event) => [event.id, event]),
      ).values(),
    ]) {
      if (event.kind === "enquiry_received" && entry.message?.trim()) continue;
      const body = event.note || event.summary;
      const isIncomingEmail =
        event.kind === "conversation_logged" &&
        event.actor === "customer" &&
        event.summary === "Customer email received";
      if (isIncomingEmail) {
        const key = JSON.stringify([entry.id, savedText(body)]),
          remaining = replyMirrors.get(key) ?? 0;
        if (remaining) {
          replyMirrors.set(key, remaining - 1);
          continue;
        }
      }
      const isWhatsApp =
        event.kind === "conversation_logged" &&
        event.summary === "WhatsApp sent — staff confirmed";
      const isAppointment = [
        "viewing_booked",
        "viewing_rescheduled",
        "viewing_cancelled",
      ].includes(event.kind);
      const isCall =
        event.kind === "conversation_logged" && !isWhatsApp && !isIncomingEmail;
      const title =
        event.kind === "whatsapp_intent"
          ? "Customer opened WhatsApp"
          : event.kind === "call_intent"
            ? "Customer tapped Call"
            : event.callOutcome
              ? callOutcomes[event.callOutcome as CallOutcome] ||
                event.callOutcome
              : event.summary;
      result.push({
        ...base,
        key: `event:${entry.id}:${event.id}`,
        kind: isWhatsApp
          ? "whatsapp"
          : isIncomingEmail
            ? "customer-email"
            : isAppointment
              ? "appointment"
              : isCall
                ? "call"
                : "event",
        channel: isWhatsApp
          ? "WhatsApp"
          : isIncomingEmail
            ? "Customer email"
            : isAppointment
              ? "Test drive"
              : isCall
                ? "Call note"
                : "Activity",
        title,
        body: body === title ? "" : body,
        at: recordedAt(event.occurredAt),
        author:
          event.actor === "customer"
            ? entry.customerName
            : event.staffName ||
              (isCall || isWhatsApp ? "Staff member" : undefined),
        ...(isWhatsApp
          ? {
              status: "Sent · staff confirmed",
              caution:
                "Staff confirmed the handoff. WhatsApp delivery and read status are not available.",
            }
          : {}),
        ...(["whatsapp_intent", "call_intent"].includes(event.kind)
          ? {
              caution:
                "Website action only; this does not confirm a call or message was completed.",
            }
          : {}),
        ...(event.followUpAt
          ? { followUpAt: recordedAt(event.followUpAt) }
          : {}),
      });
    }
  }
  for (const email of messages) {
    const entry = records.find((entry) => entry.id === email.enquiry_id)!;
    result.push({
      key: `email:${email.key}`,
      enquiryId: entry.id,
      reference: entry.reference,
      kind:
        email.kind === "reply"
          ? "customer-email"
          : email.kind === "sale"
            ? "sale"
            : "email",
      channel:
        email.kind === "reply"
          ? email.status === "review"
            ? "Incoming email"
            : "Customer email"
          : email.kind === "sale"
            ? "Sales document email"
            : "Email",
      title:
        email.subject ||
        (email.kind === "reply" ? "Customer reply" : "Customer email"),
      body: email.message || "",
      at: recordedAt(email.created_at),
      author:
        email.kind === "reply"
          ? email.status === "review"
            ? "Sender needs review"
            : entry.customerName
          : email.recipient
            ? `To ${email.recipient}`
            : undefined,
      status: caseEmailStatus(email),
      ...(email.kind === "reply" && email.status === "review"
        ? {
            caution:
              "Check the sender and message before treating this as a customer reply.",
          }
        : ["opened", "clicked"].includes(email.last_event ?? email.status)
          ? { caution: "Tracking does not prove the customer read the email." }
          : {}),
      attachmentCount: Math.max(0, Number(email.attachment_count) || 0),
      saleId: email.sale_id,
    });
  }
  return result.sort(
    (a, b) =>
      activityTimestamp(b.at) - activityTimestamp(a.at) ||
      a.key.localeCompare(b.key),
  );
}
