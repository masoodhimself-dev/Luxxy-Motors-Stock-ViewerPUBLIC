import { convert } from "html-to-text";
import { mailbox } from "./customer-email-replies";

export class CazooLeadError extends Error {
  constructor(public code: string) {
    super(code);
  }
}
export type CazooLead = {
  correlationId: string;
  registration: string;
  vehicleTitle: string;
  customerName: string;
  email: string;
  phone: string | null;
  message: string;
  contactWarnings?: ("phone_needs_checking" | "customer_name_missing")[];
};
export function cazooEmailText(email: {
  text?: string | null;
  html?: string | null;
}) {
  return (
    email.text?.trim() ||
    convert(email.html || "", {
      wordwrap: false,
      selectors: [
        { selector: "img", format: "skip" },
        { selector: "a", options: { ignoreHref: true } },
      ],
      limits: { maxInputLength: 1_000_000 },
    })
  )
    .replace(/\r\n?/g, "\n")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/[\u200b\ufeff]/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .trim()
    .slice(0, 48000);
}

/** Formatting repairs only; an uncertain optional phone must not block an email lead. */
function cazooPhone(value: string): string | null {
  let phone = value.normalize("NFKC").replace(/^(?:phone|telephone|tel|mobile)\s*:?\s*/i, "")
    .replace(/[\s().\-‐‑‒–—]/g, "");
  const international = /^(?:\+44|0044|44)0?([1-9]\d{9})$/.exec(phone);
  if (international) phone = `0${international[1]}`;
  if (/^7\d{9}$/.test(phone)) phone = `0${phone}`;
  return /^0[1-9]\d{9}$/.test(phone) ? phone : null;
}

function cazooCustomerMailbox(value: string): string | null {
  return mailbox(value.replace(/^e-?mail\s*:\s*/i, ""));
}
/** Parse the known direct-delivery Cazoo layout, never quoted forwards or arbitrary mail. */
export function parseCazooLead(email: {
  from: string;
  subject: string;
  text?: string | null;
  html?: string | null;
  authentication?: { dmarc?: string } | null;
}): CazooLead {
  if (mailbox(email.from) !== "dealerleads@info.cazoo.co.uk")
    throw new CazooLeadError("sender_not_cazoo");
  // The signed webhook authenticates delivery, not the apparent email sender.
  if (email.authentication?.dmarc?.toLowerCase() !== "pass")
    throw new CazooLeadError("sender_authentication_unverified");
  return parseCazooLeadBody(email);
}

/** Known-layout extraction; caller must separately authenticate the delivery. */
export function parseCazooLeadBody(email: { subject: string; text?: string | null; html?: string | null }): CazooLead {
  const subject =
    /^Enquiry\s*[-–—]\s*(.+?)\s+([A-Z0-9]{2,4}[ \t\u00a0\u202f]*[A-Z0-9]{2,4})\s*[-–—]\s*([^\r\n]+)$/i.exec(
      email.subject.trim(),
    );
  if (!subject) throw new CazooLeadError("unrecognised_subject");
  const text = cazooEmailText(email);
  const correlations = [
    ...text.matchAll(/(?:^|\n)\s*CorrelationID:\s*([a-f0-9]{32})\s*(?=\n|$)/gi),
  ];
  if (correlations.length !== 1)
    throw new CazooLeadError("missing_or_ambiguous_reference");
  const messages = [
    ...text.matchAll(
      /(?:^|\n)\s*Customer message\s*\n([\s\S]*?)\n\s*Enquiry type\s*(?:\n|$)/gi,
    ),
  ];
  const details = [
    ...text.matchAll(
      /(?:^|\n)\s*Customer details\s*\n([\s\S]*?)(?=\n\s*(?:Call\s|Email\s|Follow us|This email was sent|cazoo logo|Trustpilot)|$)/gi,
    ),
  ];
  if (messages.length !== 1 || details.length !== 1)
    throw new CazooLeadError("unrecognised_message_layout");
  const lines = details[0]![1]!
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const emails = [
    ...new Set(lines.map(cazooCustomerMailbox).filter((s): s is string => Boolean(s))),
  ];
  if (emails.length !== 1 || emails[0] === "dealerleads@info.cazoo.co.uk")
    throw new CazooLeadError("missing_or_ambiguous_customer_email");
  const phoneLines = lines.filter((s) => /^(?:phone|telephone|tel|mobile)\s*:/i.test(s) || /^[+\d(][\d\s().\-‐‑‒–—+]*(?:(?:ext(?:ension)?\.?|x|#)\s*\d+)?$/i.test(s));
  const phones = [...new Set(phoneLines.map(cazooPhone))];
  const phone = phones.length === 1 ? phones[0]! : null;
  const contactWarnings: NonNullable<CazooLead["contactWarnings"]> = [];
  if (phoneLines.length && !phone) contactWarnings.push("phone_needs_checking");
  const nameLines = lines.filter((s) => !cazooCustomerMailbox(s) && !phoneLines.includes(s));
  const suppliedName = nameLines.join(" ").replace(/\s+/g, " ").trim();
  if (suppliedName.length > 150 || /[<>@]/.test(suppliedName))
    throw new CazooLeadError("invalid_customer_name");
  const customerName = suppliedName || "Customer";
  if (!suppliedName) contactWarnings.push("customer_name_missing");
  const message = messages[0]![1]!.trim();
  if (!message || message.length > 12000)
    throw new CazooLeadError("invalid_customer_message");
  return {
    correlationId: correlations[0]![1]!.toLowerCase(),
    registration: subject[2]!.replace(/\s/g, "").toUpperCase(),
    vehicleTitle: subject[1]!.trim().slice(0, 200),
    customerName,
    email: emails[0]!,
    phone,
    message,
    ...(contactWarnings.length ? { contactWarnings } : {}),
  };
}
