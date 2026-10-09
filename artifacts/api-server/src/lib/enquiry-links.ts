import { currentTenant } from "./tenant-context";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Enquiry } from "@workspace/db";

/** Stable across delivery retries, fresh for every customer/staff appointment change. */
export function notificationVersion(enquiry: Pick<Enquiry, "appointmentCancelledAt" | "appointmentStatus" | "appointmentAt" | "appointmentRevision">) {
  return `${enquiry.appointmentCancelledAt ? "cancelled" : enquiry.appointmentStatus ?? "received"}-${enquiry.appointmentAt?.getTime() ?? 0}-${enquiry.appointmentRevision}`;
}

const referenceAlphabet = "ACDEFGHJKLMNPQRTUVWXY34679";

/**
 * Customer-facing reference, e.g. "K4QM-9TXR". Ambiguous characters are left
 * out so it can be read back over the phone without confusion.
 */
export function generateEnquiryReference() {
  const pick = () =>
    referenceAlphabet[Math.floor(Math.random() * referenceAlphabet.length)];
  const block = (length: number) =>
    Array.from({ length }, pick).join("");
  return `${block(4)}-${block(4)}`;
}

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value) {
    throw new Error("SESSION_SECRET is required for viewing management links");
  }
  return value;
}

/**
 * Capability token for a booked viewing. It is derived from the enquiry id and
 * the server secret rather than stored, so the reminder email can rebuild the
 * same link long after the booking was made. Only the hash is persisted, which
 * is what lookups match on.
 */
export function viewingToken(enquiryId: string) {
  return createHmac("sha256", secret())
    .update(`viewing:${enquiryId}`)
    .digest("base64url");
}

export function viewingTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function viewingTokenMatches(storedHash: string, token: string) {
  const expected = Buffer.from(storedHash, "hex");
  const actual = Buffer.from(viewingTokenHash(token), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function viewingManagePath(token: string) {
  return `/viewing/${token}`;
}

export function siteOrigin() {
  const configured = currentTenant()?.canonicalOrigin ?? process.env.PUBLIC_SITE_URL?.trim();
  if (configured) {
    const url = new URL(configured);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('PUBLIC_SITE_URL must be an HTTP(S) origin without credentials, path, query or fragment');
    }
    if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
      throw new Error('PUBLIC_SITE_URL must use HTTPS in production');
    }
    return url.origin;
  }
  if (process.env.NODE_ENV === "production") throw new Error("PUBLIC_SITE_URL is required in production");
  return "http://127.0.0.1:4175";
}

/** Absolute URL for a page on the customer-facing site. */
export function siteUrl(path: string) {
  const basePath = (process.env.PUBLIC_SITE_BASE_PATH ?? "").replace(/\/+$/, "");
  return `${siteOrigin()}${basePath}${path}`;
}

export function viewingManageUrl(enquiryId: string) {
  return siteUrl(viewingManagePath(viewingToken(enquiryId)));
}

function icsTimestamp(value: Date) {
  return `${value.toISOString().replace(/[-:]/g, "").split(".")[0]}Z`;
}

function icsEscape(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function foldIcsLine(line: string) {
  if (line.length <= 73) return line;
  const parts: string[] = [line.slice(0, 73)];
  let rest = line.slice(73);
  while (rest.length > 72) {
    parts.push(` ${rest.slice(0, 72)}`);
    rest = rest.slice(72);
  }
  if (rest.length) parts.push(` ${rest}`);
  return parts.join("\r\n");
}

/**
 * Calendar invite for a booked viewing. Cancelled bookings produce a CANCEL
 * invite so a customer who already added the event sees it disappear.
 */
export function viewingCalendarIcs({
  enquiry,
  dealerName,
  location,
  sequence = enquiry.appointmentRevision ?? 0,
}: {
  enquiry: Pick<
    Enquiry,
    | "id"
    | "reference"
    | "appointmentAt"
    | "appointmentCancelledAt"
    | "vehicleTitle"
    | "dealerId"
  > & { appointmentStatus?: "pending" | "confirmed" | null; appointmentDurationMinutes?: number | null; appointmentRevision?: number };
  dealerName: string;
  location?: string | null;
  sequence?: number;
}) {
  if (!enquiry.appointmentAt || enquiry.appointmentStatus === "pending") return null;
  const cancelled = enquiry.appointmentCancelledAt != null;
  const start = enquiry.appointmentAt;
  const end = new Date(start.getTime() + (enquiry.appointmentDurationMinutes ?? 30) * 60_000);
  const vehicle = enquiry.vehicleTitle?.trim();
  const summary = vehicle
    ? `Test drive: ${vehicle} at ${dealerName}`
    : `Test drive at ${dealerName}`;
  const description = [
    vehicle ? `Vehicle: ${vehicle}` : null,
    `Reference: ${enquiry.reference}`,
    `Change or cancel: ${viewingManageUrl(enquiry.id)}`,
  ]
    .filter(Boolean)
    .join("\n");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Used Car Showroom//Viewing//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${cancelled ? "CANCEL" : "PUBLISH"}`,
    "BEGIN:VEVENT",
    `UID:viewing-${enquiry.id}@${icsEscape(enquiry.dealerId)}`,
    `DTSTAMP:${icsTimestamp(new Date())}`,
    `DTSTART:${icsTimestamp(start)}`,
    `DTEND:${icsTimestamp(end)}`,
    `SEQUENCE:${Math.max(0, Math.trunc(sequence))}`,
    `SUMMARY:${icsEscape(summary)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    location ? `LOCATION:${icsEscape(location)}` : null,
    `URL:${icsEscape(viewingManageUrl(enquiry.id))}`,
    `STATUS:${cancelled ? "CANCELLED" : "CONFIRMED"}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter((line): line is string => line != null);

  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}
