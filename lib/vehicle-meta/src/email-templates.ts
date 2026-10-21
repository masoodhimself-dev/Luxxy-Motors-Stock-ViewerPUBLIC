import { renderLegacyEmailTemplate } from "./email-layout/legacy-email-templates.ts";
import { renderCompatibleEmailLayout } from "./email-layout/compatible-layout.ts";
/** Plain-text email copy shared by the editor and the server. Facts are supplied by the server. */
export const emailTemplateVariables = [
  "dealer_name",
  "dealer_email",
  "dealer_phone",
  "dealer_address",
  "customer_name",
  "customer_email",
  "vehicle_title",
  "vehicle_registration",
  "appointment_time",
  "appointment_status",
  "duration",
  "visit_instructions",
  "parking_instructions",
  "manage_url",
  "message",
  "preferred_contact",
  "document_number",
  "document_type",
  "amount",
  "amount_received",
  "balance",
  "payment_status",
  "reservation_status",
  "portal_url",
  "expires_at",
] as const;
export type EmailTemplateVariable = (typeof emailTemplateVariables)[number];
export type EmailTemplate = {
  id: string;
  label: string;
  category:
    "Enquiries" | "Bookings" | "Reservations" | "Sales" | "Customer access";
  subject: string;
  body: string;
  headline?: string;
};
export type EmailAppearance = {
  logoUrl: string;
  brandColour: string;
  heading: string;
  footer: string;
};
export const defaultEmailAppearance: EmailAppearance = {
  logoUrl: "",
  brandColour: "#172033",
  heading: "{{dealer_name}}",
  footer: "",
};
const greeting = "Hi {{customer_name}},\n\n";
const signoff = "\n\nThanks,\n{{dealer_name}}";
export const defaultEmailTemplates: readonly EmailTemplate[] = [
  {
    id: "invoice_copy",
    label: "Send a saved invoice",
    category: "Enquiries",
    subject: "Your invoice — {{vehicle_title}}",
    body:
      greeting +
      "Your invoice is attached, ready to download and keep. If anything needs explaining, reply to this email and we’ll help." +
      signoff,
  },
  {
    id: "vehicle_details",
    label: "Vehicle details",
    category: "Enquiries",
    subject: "{{vehicle_title}} — vehicle details",
    body:
      greeting +
      "Here’s a closer look at {{vehicle_title}}. You’ll find the car’s details below. Have a question or want to take it for a drive? Reply to this email and we’ll help you arrange it." +
      signoff,
  },
  {
    id: "service_history",
    label: "Service-book photos",
    category: "Enquiries",
    subject: "{{vehicle_title}} — service history",
    body:
      greeting +
      "The service-book photos we discussed are attached. Take a look in your own time, and reply if you’d like us to explain any of the entries." +
      signoff,
  },
  {
    id: "pre_accident_photos",
    label: "Pre-accident photos",
    category: "Enquiries",
    subject: "{{vehicle_title}} — requested photos",
    body:
      greeting +
      "The pre-accident photos we discussed are attached. If you’d like to talk through them or ask about the car’s history, just reply to this email." +
      signoff,
  },
  {
    id: "appointment_details",
    label: "Appointment details",
    category: "Enquiries",
    subject: "Your appointment details — {{vehicle_title}}",
    body:
      greeting +
      "Here are your appointment details. Check the date, time and confirmation status below. If you need to change anything, reply or give us a call." +
      signoff,
  },
  {
    id: "enquiry_message",
    label: "Customer message from enquiries",
    category: "Enquiries",
    subject: "{{vehicle_title}} — {{dealer_name}}",
    body: greeting + "{{message}}" + signoff,
  },
  {
    id: "enquiry_acknowledgement",
    label: "Enquiry acknowledgement",
    category: "Enquiries",
    subject: "Your {{dealer_name}} enquiry — {{vehicle_title}}",
    body:
      greeting +
      "Thanks for getting in touch about {{vehicle_title}}. We’ve received your enquiry and will be in touch. If there’s anything else you’d like to ask, reply to this email." +
      signoff,
  },
  {
    id: "dealer_notification",
    label: "New enquiry for the team",
    category: "Enquiries",
    subject: "New enquiry — {{customer_name}} · {{vehicle_title}}",
    body: "A customer has contacted {{dealer_name}} about {{vehicle_title}}.\n\nCustomer: {{customer_name}}\nEmail: {{customer_email}}\nPreferred contact: {{preferred_contact}}\nMessage: {{message}}",
  },
  {
    id: "callback",
    label: "Callback request",
    category: "Enquiries",
    subject: "Your callback request — {{vehicle_title}}",
    body:
      greeting +
      "Thanks for requesting a call about {{vehicle_title}}. We’ve received your request and will call you as soon as we can." +
      signoff,
  },
  {
    id: "booking_request",
    label: "Booking request received",
    category: "Bookings",
    subject: "Test drive requested — {{vehicle_title}}",
    body:
      greeting +
      "Thanks for requesting a test drive of {{vehicle_title}} at {{appointment_time}}. We’ll check the time and contact you to confirm.\n\nYour appointment is not confirmed yet." +
      signoff,
  },
  {
    id: "booking_confirmation",
    label: "Booking confirmed",
    category: "Bookings",
    subject: "Your {{dealer_name}} test drive — {{vehicle_title}}",
    body:
      greeting +
      "You’re booked in to test drive {{vehicle_title}}. Check your visit details below — we look forward to meeting you.\n\n{{visit_instructions}}\n{{parking_instructions}}" +
      signoff,
  },
  {
    id: "booking_change",
    label: "Booking changed",
    category: "Bookings",
    subject: "Your test drive has changed — {{vehicle_title}}",
    body:
      greeting +
      "We’ve updated your test drive of {{vehicle_title}}. Please check the new date, time and status below before setting off.\n\n{{visit_instructions}}\n{{parking_instructions}}" +
      signoff,
  },
  {
    id: "booking_cancellation",
    label: "Booking cancelled",
    category: "Bookings",
    subject: "Test drive cancelled — {{vehicle_title}}",
    body:
      greeting +
      "Your test drive of {{vehicle_title}} has been cancelled. If you’d like to arrange another time, reply or call us — we’ll be happy to help." +
      signoff,
  },
  {
    id: "booking_reminder",
    label: "Booking reminder",
    category: "Bookings",
    subject: "Reminder: your {{dealer_name}} test drive",
    body:
      greeting +
      "We’re looking forward to seeing you for your test drive of {{vehicle_title}}. Here’s a reminder of your visit details.\n\n{{visit_instructions}}\n{{parking_instructions}}" +
      signoff,
  },
  {
    id: "reservation_confirmation",
    label: "Reservation confirmation",
    category: "Reservations",
    subject: "Your reservation — {{vehicle_title}}",
    body:
      greeting +
      "Thanks for your reservation request for {{vehicle_title}}. Your current reservation and payment status are shown below. We’ll be in touch about the next steps." +
      signoff,
  },
  {
    id: "reservation_payment",
    label: "Reservation payment confirmed",
    category: "Reservations",
    subject: "Your reservation deposit — {{vehicle_title}}",
    body:
      greeting +
      "We’ve confirmed your reservation deposit for {{vehicle_title}}. Check the payment details below and keep this email for your records." +
      signoff,
  },
  {
    id: "reservation_refund",
    label: "Reservation refund",
    category: "Reservations",
    subject: "Reservation refund — {{vehicle_title}}",
    body:
      greeting +
      "We’ve recorded a refund against your reservation of {{vehicle_title}}. The details are below. Your bank may take a little time to show the funds." +
      signoff,
  },
  {
    id: "invoice",
    label: "Invoice",
    category: "Sales",
    subject: "Invoice {{document_number}} — {{dealer_name}}",
    body:
      greeting +
      "Your invoice for {{vehicle_title}} is attached. Keep a copy for your records. If you have a question about the invoice, reply and we’ll help." +
      signoff,
  },
  {
    id: "payment_receipt",
    label: "Payment receipt",
    category: "Sales",
    subject: "Receipt {{document_number}} — {{dealer_name}}",
    body:
      greeting +
      "Your payment receipt for {{vehicle_title}} is attached. The details below reflect the issued document. Thank you — please keep the receipt for your records." +
      signoff,
  },
  {
    id: "balance_statement",
    label: "Balance statement",
    category: "Sales",
    subject: "Balance statement {{document_number}} — {{dealer_name}}",
    body:
      greeting +
      "Your balance statement for {{vehicle_title}} is attached. It shows the balance recorded when the document was issued. Reply or call us if you’d like to discuss the next payment." +
      signoff,
  },
  {
    id: "document_email",
    label: "Sales document",
    category: "Sales",
    subject: "{{document_type}} {{document_number}} — {{dealer_name}}",
    body:
      greeting +
      "Your {{document_type}} for {{vehicle_title}} is attached. Keep it for your records." +
      signoff,
  },
  {
    id: "customer_access_link",
    label: "Private customer page link",
    category: "Customer access",
    subject: "Your private {{dealer_name}} customer page",
    body:
      greeting +
      "Your private customer page brings your car, documents and recorded payments together. Open it using the secure link below.\n\nKeep this link private. It expires at {{expires_at}}." +
      signoff,
  },
];
export class EmailTemplateError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "EmailTemplateError";
    this.status = status;
  }
}
export function validateEmailTemplate(
  value: unknown,
): Pick<EmailTemplate, "subject" | "body" | "headline"> {
  const input = value as {
    subject?: unknown;
    body?: unknown;
    headline?: unknown;
  } | null;
  if (
    !input ||
    typeof input.subject !== "string" ||
    typeof input.body !== "string"
  )
    throw new EmailTemplateError("Enter a subject and message.");
  const subject = input.subject.trim(),
    body = input.body.trim();
  if (
    !subject ||
    subject.length > 200 ||
    /[\r\n\u0000-\u001f\u007f]/.test(subject)
  )
    throw new EmailTemplateError(
      "The subject must be 1–200 characters on one line.",
    );
  if (
    !body ||
    body.length > 12_000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(body)
  )
    throw new EmailTemplateError("The message must be 1–12,000 characters.");
  if (
    input.headline !== undefined &&
    (typeof input.headline !== "string" ||
      input.headline.length > 200 ||
      /[\r\n\u0000-\u001f\u007f]/.test(input.headline))
  )
    throw new EmailTemplateError(
      "Keep the email title within 200 characters on one line.",
    );
  const headline =
    typeof input.headline === "string" ? input.headline.trim() : undefined;
  for (const copy of [subject, body, headline ?? ""]) {
    const remainder = copy.replace(
      /\{\{\s*([a-z_]+)\s*\}\}/g,
      (_token, variable: string) => {
        // Accept legacy saved templates, but the renderer never exposes this
        // retired variable. It is deliberately absent from the editor choices.
        if (
          variable !== "reference" &&
          !(emailTemplateVariables as readonly string[]).includes(variable)
        )
          throw new EmailTemplateError(`Unknown variable: ${variable}.`);
        return "";
      },
    );
    if (remainder.includes("{{") || remainder.includes("}}"))
      throw new EmailTemplateError(
        "Use variables in the form {{customer_name}}.",
      );
  }
  return { subject, body, ...(headline === undefined ? {} : { headline }) };
}
export function escapeEmailHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
export function validateEmailAppearance(value: unknown): EmailAppearance {
  const input = value as EmailAppearance | null;
  if (
    !input ||
    typeof input.logoUrl !== "string" ||
    typeof input.brandColour !== "string" ||
    typeof input.heading !== "string" ||
    typeof input.footer !== "string" ||
    Object.keys(input).some(
      (key) => !["logoUrl", "brandColour", "heading", "footer"].includes(key),
    )
  )
    throw new EmailTemplateError("Enter valid email branding settings.");
  const logoUrl = input.logoUrl.trim();
  if (
    logoUrl &&
    (logoUrl.length > 2000 ||
      !/^https:\/\/(?:[a-z0-9-]+\.)+[a-z0-9-]+(?::\d{1,5})?(?:[/?#][^\s]*)?$/i.test(
        logoUrl,
      ) ||
      /[\\<>"\u0000-\u001f]/.test(logoUrl))
  )
    throw new EmailTemplateError(
      "Use a secure HTTPS address without credentials for the email logo.",
    );
  if (!/^#[a-f0-9]{6}$/i.test(input.brandColour))
    throw new EmailTemplateError(
      "Use a six-digit hex colour, for example #172033.",
    );
  const heading = input.heading.trim(),
    footer = input.footer.trim();
  if (heading.length > 200 || footer.length > 4000)
    throw new EmailTemplateError(
      "Keep the heading within 200 characters and footer within 4,000 characters.",
    );
  // The same variable grammar and control-character restrictions apply to global copy.
  validateEmailTemplate({
    subject: heading || "Email",
    body: footer || "Footer",
  });
  return {
    logoUrl,
    brandColour: input.brandColour.toUpperCase(),
    heading,
    footer,
  };
}
export type EmailFacts = Array<{
  label: string;
  value: string | number | null | undefined;
}>;
export type EmailLayoutVersion = "legacy-v1" | "correspondence-v1";
/** Old outbox entries have no marker; unknown versions must never silently rerender. */
export function approvedEmailLayoutVersion(value: unknown): EmailLayoutVersion {
  if (value === undefined || value === "legacy-v1") return "legacy-v1";
  if (value === "correspondence-v1") return value;
  throw new Error("The approved email layout version is unavailable.");
}
export type EmailRenderOptions = {
  layoutVersion?: EmailLayoutVersion;
  templateId?: string;
  attachments?: readonly string[];
};
const emailPresentation: Record<string, { title: string; kicker: string }> = {
  invoice_copy: { title: "Your invoice", kicker: "Your documents" },
  vehicle_details: { title: "Vehicle details", kicker: "Your next car" },
  service_history: {
    title: "Your service-book photos",
    kicker: "Vehicle history",
  },
  pre_accident_photos: {
    title: "The photos you requested",
    kicker: "Vehicle history",
  },
  appointment_details: {
    title: "Your appointment details",
    kicker: "Your showroom visit",
  },
  enquiry_message: { title: "A message for you", kicker: "Your dealership" },
  enquiry_acknowledgement: {
    title: "Thanks for getting in touch",
    kicker: "Your enquiry",
  },
  dealer_notification: {
    title: "A new enquiry to follow up",
    kicker: "Showroom team",
  },
  callback: {
    title: "We’ve received your callback request",
    kicker: "Let’s talk",
  },
  booking_request: {
    title: "Test drive requested",
    kicker: "Awaiting confirmation",
  },
  booking_confirmation: {
    title: "Test drive confirmed",
    kicker: "Your showroom visit",
  },
  booking_change: {
    title: "Your test drive has been updated",
    kicker: "Your showroom visit",
  },
  booking_cancellation: {
    title: "Your test drive is cancelled",
    kicker: "Booking update",
  },
  booking_reminder: {
    title: "Your test drive is coming up",
    kicker: "Your visit reminder",
  },
  reservation_confirmation: {
    title: "Your reservation update",
    kicker: "Your next car",
  },
  reservation_payment: {
    title: "Your deposit is confirmed",
    kicker: "Payment update",
  },
  reservation_refund: {
    title: "Your reservation refund",
    kicker: "Payment update",
  },
  invoice: { title: "Your invoice", kicker: "Your documents" },
  payment_receipt: { title: "Your payment receipt", kicker: "Your documents" },
  balance_statement: {
    title: "Your balance statement",
    kicker: "Your documents",
  },
  document_email: { title: "Your sales document", kicker: "Your documents" },
  customer_access_link: {
    title: "Your private customer page",
    kicker: "Your car and documents",
  },
};
function secureEmailLink(value: unknown): string | undefined {
  if (typeof value !== "string" || /[\\<>"\s\u0000-\u001f]/.test(value))
    return undefined;
  // Explicit HTTPS host grammar; credentials and other schemes never become buttons.
  return /^https:\/\/(?:[a-z0-9-]+\.)+[a-z0-9-]+(?::\d{1,5})?(?:[/?#][^\s]*)?$/i.test(
    value,
  )
    ? value
    : undefined;
}
function breakEmailText(value: string): string {
  // A zero-width break is more reliable than overflow-wrap in older email clients.
  return value
    .split(/(\s+)/)
    .map((part) =>
      /^\s+$/.test(part)
        ? escapeEmailHtml(part)
        : (part.match(/.{1,32}/gu) ?? []).map(escapeEmailHtml).join("&#8203;"),
    )
    .join("");
}
function emailHeaderText(value: string) {
  const characters = Array.from(value.trim());
  return characters.length > 200
    ? characters.slice(0, 199).join("") + "…"
    : value.trim();
}
function linkedEmailText(value: string): string {
  let result = "",
    start = 0;
  for (const match of value.matchAll(/https:\/\/[^\s<>]+/g)) {
    const index = match.index!;
    result += breakEmailText(value.slice(start, index));
    const raw = match[0];
    let candidate = raw.replace(/[.,!?;:]+$/, "");
    while (
      candidate.endsWith(")") &&
      (candidate.match(/\)/g)?.length ?? 0) >
        (candidate.match(/\(/g)?.length ?? 0)
    )
      candidate = candidate.slice(0, -1);
    const link = secureEmailLink(candidate);
    result += link
      ? `<a href="${escapeEmailHtml(link)}" style="color:#24577a;text-decoration:underline;word-break:break-all">${breakEmailText(candidate)}</a>${breakEmailText(raw.slice(candidate.length))}`
      : breakEmailText(raw);
    start = index + raw.length;
  }
  return result + breakEmailText(value.slice(start));
}
const internalReferenceLabel =
  /^(?:(?:internal|enquiry|booking|reservation|sale|customer|chat)\s+)?(?:reference|ref\.?|record\s+(?:number|no\.?))$/i;
/** Hide retired record labels in legacy copy without altering secure URLs or
 * customer-supplied bank/payment references. Stored records remain unchanged. */
function withoutInternalEmailReferences(value: string, reference: string) {
  const marker = "INTERNAL_RECORD_REFERENCE_REMOVED";
  const escaped = reference.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const generated =
    "(?:[ACDEFGHJKLMNPQRTUVWXY34679]{4}-[ACDEFGHJKLMNPQRTUVWXY34679]{4}|(?:ENQ|RSV|SALE|CHAT)-[A-Z0-9-]+)";
  return value
    .split(/(https:\/\/[^\s<>]+)/g)
    .map((part, index) => {
      if (index % 2) return part;
      let cleaned = part.replace(/\{\{\s*reference\s*\}\}/g, marker);
      if (escaped)
        cleaned = cleaned.replace(
          new RegExp(`(?<![A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])`, "g"),
          marker,
        );
      // Only generated-looking values on explicitly internal reference lines are
      // removed when an old saved template contains another record's literal ID.
      cleaned = cleaned.replace(
        new RegExp(
          `(^|\\n)[\\t ]*(?:(?:internal|enquiry|booking|reservation|sale|customer|chat)[\\t ]+)?(?:reference|ref\\.?)[\\t ]*:[\\t ]*${generated}[\\t ]*[.!]?(?=\\n|$)`,
          "gi",
        ),
        "$1",
      );
      cleaned = cleaned.replace(
        new RegExp(
          `(^|\\n)[\\t ]*(?:your[\\t ]+)?(?:(?:internal|enquiry|booking|reservation|sale|customer|chat)[\\t ]+)?(?:reference|ref\\.?|number|no\\.?)[\\t ]*(?::|is)?[\\t ]*${marker}[\\t ]*[.!]?(?=\\n|$)`,
          "gi",
        ),
        "$1",
      );
      return cleaned
        .replace(new RegExp(`[\\t ]*[—–|·-][\\t ]*${marker}`, "g"), "")
        .replace(new RegExp(`${marker}[\\t ]*[—–|·-][\\t ]*`, "g"), "")
        .replaceAll(marker, "")
        .replace(/[\t ]+([,.!?])/g, "$1")
        .replace(/[\t ]{2,}/g, " ")
        .replace(/\n{3,}/g, "\n\n");
    })
    .join("");
}
/** One restrained, email-safe layout shared by messages, bookings and documents. */
export function renderEmailTemplate(
  template: Pick<EmailTemplate, "subject" | "body" | "headline">,
  variables: Record<string, string | number | null | undefined>,
  facts: EmailFacts,
  appearance: EmailAppearance = defaultEmailAppearance,
  options: EmailRenderOptions = {},
) {
  if (options.layoutVersion === "legacy-v1")
    return renderLegacyEmailTemplate(
      template,
      variables,
      facts,
      appearance,
      options,
    );
  const copy = validateEmailTemplate(template),
    branding = validateEmailAppearance(appearance);
  const reference = String(variables.reference ?? "").trim();
  const presentation = emailPresentation[options.templateId ?? ""] ?? {
    title: "A message for you",
    kicker: "Your dealership",
  };
  const interpolate = (value: string) =>
    withoutInternalEmailReferences(value, reference).replace(
      /\{\{\s*([a-z_]+)\s*\}\}/g,
      (_token, key: string) =>
        key === "reference"
          ? ""
          : ["document_number", "manage_url", "portal_url"].includes(key)
            ? String(variables[key] ?? "")
            : withoutInternalEmailReferences(
                String(variables[key] ?? ""),
                reference,
              ),
    );
  const subject = (interpolate(copy.subject) || presentation.title)
    .replace(/[\r\n\u0000-\u001f\u007f]/g, " ")
    .slice(0, 200)
    .trim();
  if (!subject) throw new EmailTemplateError("The rendered subject is empty.");
  const prose = interpolate(copy.body)
    .trim()
    .replace(/^Hi\s*,/, "Hi there,");
  const heading = emailHeaderText(interpolate(branding.heading)),
    footer = interpolate(branding.footer);
  const details = facts.filter(
    (fact) =>
      !internalReferenceLabel.test(fact.label.trim()) &&
      !(
        reference &&
        String(fact.value).trim() === reference &&
        /^(?:sale|enquiry|booking|reservation|customer|chat)$/i.test(
          fact.label.trim(),
        )
      ) &&
      fact.value !== null &&
      fact.value !== undefined &&
      String(fact.value).trim() !== "",
  );
  const title = emailHeaderText(
    copy.headline ? interpolate(copy.headline) : presentation.title,
  );
  const dealer = String(variables.dealer_name ?? "").trim();
  const factText = details
    .map((fact) => `${fact.label}: ${fact.value}`)
    .join("\n");
  const attachments = (options.attachments ?? []).filter((name) => name.trim());
  const actionUrl =
    options.templateId === "customer_access_link"
      ? secureEmailLink(variables.portal_url)
      : options.templateId?.startsWith("booking_") &&
          options.templateId !== "booking_cancellation"
        ? secureEmailLink(variables.manage_url)
        : undefined;
  const actionLabel =
    options.templateId === "customer_access_link"
      ? "Open your private page"
      : "Manage your test drive";
  const contactEmail =
    typeof variables.dealer_email === "string" &&
    /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(variables.dealer_email)
      ? variables.dealer_email
      : "";
  const phone = String(variables.dealer_phone ?? "").trim();
  const address = String(variables.dealer_address ?? "").trim();
  const detailsHeading =
    options.templateId?.startsWith("booking_") ||
    options.templateId === "appointment_details"
      ? "Visit details"
      : options.templateId?.startsWith("reservation_")
        ? "Reservation details"
        : [
              "invoice",
              "invoice_copy",
              "payment_receipt",
              "balance_statement",
              "document_email",
            ].includes(options.templateId ?? "")
          ? "Document details"
          : [
                "vehicle_details",
                "service_history",
                "pre_accident_photos",
              ].includes(options.templateId ?? "")
            ? "Vehicle details"
            : "Details for your records";
  const html = renderCompatibleEmailLayout({
    templateId: options.templateId,
    subject,
    title,
    prose,
    heading,
    footer,
    dealer,
    logoUrl: branding.logoUrl,
    brandColour: branding.brandColour,
    details: details
      .filter((fact) => !actionUrl || fact.value !== actionUrl)
      .map((fact) => ({ label: fact.label, value: String(fact.value) })),
    attachments,
    actionUrl,
    actionLabel,
    contactEmail,
    phone,
    address,
    formatProse: (value) => linkedEmailText(value).replaceAll("\n", "<br>"),
  });
  return {
    subject,
    // Editable copy is separate from the fully branded text alternative.
    bodyText: prose,
    text: [
      heading,
      options.templateId ? title : "",
      prose,
      actionUrl ? `${actionLabel}: ${actionUrl}` : "",
      factText ? `${detailsHeading}\n${factText}` : "",
      attachments.length ? "Attachments\n" + attachments.join("\n") : "",
      [contactEmail, phone].filter(Boolean).join(" · "),
      address,
      footer,
    ]
      .filter(Boolean)
      .join("\n\n"),
    html,
  };
}
