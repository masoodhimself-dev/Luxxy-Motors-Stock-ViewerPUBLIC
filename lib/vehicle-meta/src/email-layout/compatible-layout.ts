import { renderHtml, type Section, type View } from "./components.ts";
import { palette } from "./safety.ts";
import type { TemplateId } from "./types.ts";

/** Presentation adapter only. Inputs have already passed the existing email contract.
 * In particular, never infer payments, attachments, booking state or add editable copy. */
export function renderCompatibleEmailLayout(input: {
  templateId?: string;
  subject: string;
  title: string;
  prose: string;
  heading: string;
  footer: string;
  dealer: string;
  logoUrl: string;
  brandColour: string;
  details: Array<{ label: string; value: string }>;
  attachments: string[];
  actionUrl?: string;
  actionLabel: string;
  contactEmail: string;
  phone: string;
  address: string;
  formatProse: (value: string) => string;
}): string {
  const id = input.templateId ?? "enquiry_message";
  const vehicle = input.details.find((fact) => fact.label === "Vehicle");
  const registration = input.details.find(
    (fact) => fact.label === "Registration",
  );
  // Only surface vehicle facts explicitly selected by the caller; variables alone
  // must not bypass the enquiry composer's includeVehicle choice.
  const details = input.details.filter(
    (fact) => fact !== vehicle && fact !== registration,
  );
  const booking = id.startsWith("booking_") || id === "appointment_details";
  const document = [
    "invoice",
    "invoice_copy",
    "payment_receipt",
    "balance_statement",
    "document_email",
  ].includes(id);
  const section: Section = {
    title: booking
      ? "Visit details"
      : document
        ? "Document details"
        : id.startsWith("reservation_")
          ? "Reservation details"
          : "Details for your records",
    facts: details,
  };
  const view: View = {
    templateId: id as TemplateId,
    subject: input.subject,
    headline: input.title,
    dealerName: input.dealer || input.heading,
    logo: input.logoUrl || undefined,
    heading:
      input.heading && input.heading !== input.dealer
        ? input.heading
        : undefined,
    greeting: "",
    paragraphs: input.prose.split(/\n\s*\n/).filter(Boolean),
    vehicleTitle: vehicle?.value,
    registration: registration?.value,
    sections: details.length ? [section] : [],
    fileNames: input.attachments,
    primary: input.actionUrl
      ? { label: input.actionLabel, url: input.actionUrl }
      : undefined,
    secondary: [],
    email: input.contactEmail || undefined,
    phone: input.phone || undefined,
    address: input.address || undefined,
    footer: input.footer || undefined,
    palette: palette(input.brandColour),
    preserveCopy: true,
    formatProse: input.formatProse,
  };
  return renderHtml(view);
}
