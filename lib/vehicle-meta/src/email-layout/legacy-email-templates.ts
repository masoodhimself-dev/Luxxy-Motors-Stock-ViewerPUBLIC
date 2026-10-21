/** Frozen pre-upgrade HTML for validating already-approved queued emails only. */
import {
  EmailTemplateError,
  validateEmailTemplate,
  validateEmailAppearance,
  escapeEmailHtml,
  defaultEmailAppearance,
  type EmailTemplate,
  type EmailFacts,
  type EmailAppearance,
  type EmailRenderOptions,
} from "../email-templates.ts";
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
export function renderLegacyEmailTemplate(
  template: Pick<EmailTemplate, "subject" | "body" | "headline">,
  variables: Record<string, string | number | null | undefined>,
  facts: EmailFacts,
  appearance: EmailAppearance = defaultEmailAppearance,
  options: EmailRenderOptions = {},
) {
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
