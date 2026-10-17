/** Plain-text email copy shared by the editor and the server. Facts are supplied by the server. */
export const emailTemplateVariables = [
  "dealer_name",
  "dealer_email",
  "dealer_phone",
  "dealer_address",
  "customer_name",
  "customer_email",
  "reference",
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
    subject: "Your appointment details — {{reference}}",
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
    subject: "Your {{dealer_name}} enquiry — {{reference}}",
    body:
      greeting +
      "Thanks for getting in touch about {{vehicle_title}}. We’ve received your enquiry and will be in touch. If there’s anything else you’d like to ask, reply to this email." +
      signoff,
  },
  {
    id: "dealer_notification",
    label: "New enquiry for the team",
    category: "Enquiries",
    subject: "New enquiry — {{reference}}",
    body: "A customer has contacted {{dealer_name}} about {{vehicle_title}}.\n\nCustomer: {{customer_name}}\nEmail: {{customer_email}}\nPreferred contact: {{preferred_contact}}\nMessage: {{message}}",
  },
  {
    id: "callback",
    label: "Callback request",
    category: "Enquiries",
    subject: "Your callback request — {{reference}}",
    body:
      greeting +
      "Thanks for requesting a call about {{vehicle_title}}. We’ve received your request and will call you as soon as we can." +
      signoff,
  },
  {
    id: "booking_request",
    label: "Booking request received",
    category: "Bookings",
    subject: "Test drive requested — {{reference}}",
    body:
      greeting +
      "Thanks for requesting a test drive of {{vehicle_title}} at {{appointment_time}}. We’ll check the time and contact you to confirm.\n\nYour appointment is not confirmed yet." +
      signoff,
  },
  {
    id: "booking_confirmation",
    label: "Booking confirmed",
    category: "Bookings",
    subject: "Your {{dealer_name}} test drive — {{reference}}",
    body:
      greeting +
      "You’re booked in to test drive {{vehicle_title}}. Check your visit details below — we look forward to meeting you.\n\n{{visit_instructions}}\n{{parking_instructions}}" +
      signoff,
  },
  {
    id: "booking_change",
    label: "Booking changed",
    category: "Bookings",
    subject: "Your test drive has changed — {{reference}}",
    body:
      greeting +
      "We’ve updated your test drive of {{vehicle_title}}. Please check the new date, time and status below before setting off.\n\n{{visit_instructions}}\n{{parking_instructions}}" +
      signoff,
  },
  {
    id: "booking_cancellation",
    label: "Booking cancelled",
    category: "Bookings",
    subject: "Test drive cancelled — {{reference}}",
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
    subject: "Your reservation — {{reference}}",
    body:
      greeting +
      "Thanks for your reservation request for {{vehicle_title}}. Your current reservation and payment status are shown below. We’ll be in touch about the next steps." +
      signoff,
  },
  {
    id: "reservation_payment",
    label: "Reservation payment confirmed",
    category: "Reservations",
    subject: "Your reservation deposit — {{reference}}",
    body:
      greeting +
      "We’ve confirmed your reservation deposit for {{vehicle_title}}. Check the payment details below and keep this email for your records." +
      signoff,
  },
  {
    id: "reservation_refund",
    label: "Reservation refund",
    category: "Reservations",
    subject: "Reservation refund — {{reference}}",
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
        if (!(emailTemplateVariables as readonly string[]).includes(variable))
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
export type EmailRenderOptions = {
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
function emailContrast(colour: string): string {
  const rgb = [1, 3, 5]
    .map((index) => parseInt(colour.slice(index, index + 2), 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
  const luminance = 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!;
  if (1.05 / (luminance + 0.05) >= 4.5) return "#ffffff";
  const dark = [0.09, 0.1255, 0.2].map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
  );
  const darkLuminance =
    0.2126 * dark[0]! + 0.7152 * dark[1]! + 0.0722 * dark[2]!;
  return (luminance + 0.05) / (darkLuminance + 0.05) >= 4.5
    ? "#172033"
    : "#000000";
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
/** One restrained, email-safe layout shared by messages, bookings and documents. */
export function renderEmailTemplate(
  template: Pick<EmailTemplate, "subject" | "body" | "headline">,
  variables: Record<string, string | number | null | undefined>,
  facts: EmailFacts,
  appearance: EmailAppearance = defaultEmailAppearance,
  options: EmailRenderOptions = {},
) {
  const copy = validateEmailTemplate(template),
    branding = validateEmailAppearance(appearance);
  const interpolate = (value: string) =>
    value.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_token, key: string) =>
      String(variables[key] ?? ""),
    );
  const subject = interpolate(copy.subject)
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
      fact.value !== null &&
      fact.value !== undefined &&
      String(fact.value).trim() !== "",
  );
  const presentation = emailPresentation[options.templateId ?? ""] ?? {
    title: "A message for you",
    kicker: "Your dealership",
  };
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
  const foreground = emailContrast(branding.brandColour);
  const contactEmail =
    typeof variables.dealer_email === "string" &&
    /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(variables.dealer_email)
      ? variables.dealer_email
      : "";
  const phone = String(variables.dealer_phone ?? "").trim();
  const compactPhone = phone.replace(/[ ()-]/g, ""),
    dial = /^\+?\d{7,15}$/.test(compactPhone) ? compactPhone : "";
  const address = String(variables.dealer_address ?? "").trim();
  const contact = [
    contactEmail
      ? `<a class="email-contact" href="mailto:${escapeEmailHtml(encodeURIComponent(contactEmail).replaceAll("%40", "@"))}" style="display:inline-block;padding:5px 0;color:#24577a;text-decoration:underline;word-break:break-all">${breakEmailText(contactEmail)}</a>`
      : "",
    phone
      ? dial
        ? `<a class="email-contact" href="tel:${escapeEmailHtml(dial)}" style="display:inline-block;padding:5px 0;color:#24577a;text-decoration:underline">${breakEmailText(phone)}</a>`
        : breakEmailText(phone)
      : "",
  ]
    .filter(Boolean)
    .join(
      '<span class="email-contact-divider" style="color:#9aa8b3"> &nbsp;·&nbsp; </span>',
    );
  const paragraphs = prose
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;overflow-wrap:anywhere;word-break:break-word;color:#344454">${linkedEmailText(paragraph).replaceAll("\n", "<br>")}</p>`,
    )
    .join("");
  const factRows = details
    .filter((fact) => !actionUrl || fact.value !== actionUrl)
    .map(
      (fact) =>
        `<tr><th scope="row" width="36%" style="width:36%;padding:11px 14px 11px 0;border-bottom:1px solid #e1e7ed;font-size:13px;line-height:1.6;font-weight:400;text-align:left;vertical-align:top;overflow-wrap:anywhere;word-break:break-word;color:#536474">${breakEmailText(fact.label)}</th><td style="padding:11px 0;border-bottom:1px solid #e1e7ed;font-size:14px;line-height:1.6;font-weight:600;vertical-align:top;overflow-wrap:anywhere;word-break:break-word;color:#172d3e">${linkedEmailText(String(fact.value))}</td></tr>`,
    )
    .join("");
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
  const brandHeader =
    branding.logoUrl || heading
      ? `<tr><td class="email-brand" style="padding:24px 28px 20px;border-bottom:1px solid #e1e7ed">${branding.logoUrl ? `<img class="email-logo" src="${escapeEmailHtml(branding.logoUrl)}" alt="${escapeEmailHtml(dealer || heading)}" width="180" style="display:block;width:180px;max-width:100%;height:auto;max-height:56px;object-fit:contain;object-position:left center;margin:0 0 12px;border:0">` : ""}${heading ? `<p style="margin:0;font-size:16px;font-weight:700;line-height:1.5;overflow-wrap:anywhere;word-break:break-word;color:#172d3e">${breakEmailText(heading)}</p>` : ""}</td></tr>`
      : "";
  const detailsHtml = factRows
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;table-layout:fixed;margin:24px 0 0;background:#f7f9fa;border:1px solid #e1e7ed;border-radius:4px"><tr><td class="email-details" style="padding:16px 18px"><h2 style="margin:0 0 6px;font-size:14px;line-height:1.5;font-weight:700;color:#172d3e">${detailsHeading}</h2><table width="100%" cellpadding="0" cellspacing="0" style="width:100%;table-layout:fixed;border-collapse:collapse">${factRows}</table></td></tr></table>`
    : "";
  const actionHtml = actionUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" class="email-action" style="margin:24px 0 0"><tr><td bgcolor="${branding.brandColour}" style="border-radius:4px"><a class="email-button" href="${escapeEmailHtml(actionUrl)}" style="display:inline-block;padding:14px 20px;border:1px solid ${branding.brandColour};border-radius:4px;background:${branding.brandColour};color:${foreground};font-size:14px;font-weight:700;line-height:1.5;text-align:center;text-decoration:none;mso-padding-alt:14px 20px">${actionLabel}</a></td></tr></table>`
    : "";
  const attachmentsHtml = attachments.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;table-layout:fixed;margin:24px 0 0;border-top:1px solid #e1e7ed"><tr><td style="padding:18px 0 0"><h2 style="margin:0 0 10px;font-size:13px;line-height:1.5;font-weight:700;color:#172d3e">Included with this email <span style="font-weight:400;color:#607485">(${attachments.length} ${attachments.length === 1 ? "file" : "files"})</span></h2>${attachments.map((name) => `<p style="margin:6px 0;font-size:13px;line-height:1.6;overflow-wrap:anywhere;word-break:break-word;color:#536474">${breakEmailText(name)}</p>`).join("")}</td></tr></table>`
    : "";
  const footerHtml =
    footer || contact || address
      ? `<tr><td class="email-footer" style="padding:18px 28px 20px;border-top:1px solid #e1e7ed;background:#fafbfc;border-radius:0 0 6px 6px">${contact ? `<p style="margin:0;font-size:13px;line-height:1.6">${contact}</p>` : ""}${address ? `<p style="margin:8px 0 0;font-size:12px;line-height:1.7;overflow-wrap:anywhere;color:#607485">${linkedEmailText(address).replaceAll("\n", "<br>")}</p>` : ""}${footer ? `<div style="margin-top:12px;font-size:12px;line-height:1.7;overflow-wrap:anywhere;color:#607485">${linkedEmailText(footer).replaceAll("\n", "<br>")}</div>` : ""}</td></tr>`
      : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeEmailHtml(subject)}</title><style>table{border-spacing:0}a{color:#24577a}@media only screen and (max-width:600px){.email-shell{padding:12px 8px!important}.email-brand{padding:22px 20px 18px!important}.email-pad{padding:24px 20px!important}.email-title{font-size:23px!important}.email-details{padding:12px 14px!important}.email-action{width:100%!important}.email-button{display:block!important;text-align:center!important}.email-footer{padding:16px 20px!important}.email-contact{display:block!important;min-height:28px;padding:8px 0!important}.email-contact-divider{display:none!important}.email-logo{max-width:180px!important}}</style></head><body style="margin:0;padding:0;background:#f3f5f6;color:#172d3e;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%"><div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escapeEmailHtml(prose.replace(/\s+/g, " ").slice(0, 140))}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;table-layout:fixed;background:#f3f5f6"><tr><td class="email-shell" align="center" style="padding:28px 16px"><!--[if mso]><table role="presentation" width="600"><tr><td><![endif]--><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;table-layout:fixed;background:#ffffff;border:1px solid #dce3e8;border-radius:6px"><tr><td style="height:4px;background:${branding.brandColour};border-radius:6px 6px 0 0;font-size:0;line-height:0">&nbsp;</td></tr>${brandHeader}<tr><td class="email-pad" style="padding:28px"><p style="margin:0 0 8px;font-size:10px;line-height:1.5;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#607485">${escapeEmailHtml(presentation.kicker)}</p><h1 class="email-title" style="margin:0 0 20px;font-size:25px;line-height:1.35;font-weight:700;overflow-wrap:anywhere;word-break:break-word;color:#172d3e">${breakEmailText(title)}</h1>${paragraphs}${detailsHtml}${actionHtml}${attachmentsHtml}</td></tr>${footerHtml}</table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`;
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
