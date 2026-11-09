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
  email: string | null;
  phone: string | null;
  message: string;
  contactWarnings?: ("phone_needs_checking" | "customer_name_missing" | "customer_email_missing")[];
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
    .trim();
  // Some email renderers repeat a link target after its visible text. Accept
  // that exact shape only when both independently valid numbers agree.
  const pair = /^([+\d(][\d \t().\-‐‑‒–—+]*?)[ \t]+\([ \t]*tel:[ \t]*([+\d][\d \t.\-‐‑‒–—+]*)[ \t]*\)$/i.exec(phone);
  if (pair) {
    const visible = cazooPhone(pair[1]!);
    const target = cazooPhone(pair[2]!);
    return visible && visible === target ? visible : null;
  }
  phone = phone.replace(/[\s().\-‐‑‒–—]/g, "");
  const international = /^(?:\+44|0044|44)0?([1-9]\d{9})$/.exec(phone);
  if (international) phone = `0${international[1]}`;
  if (/^7\d{9}$/.test(phone)) phone = `0${phone}`;
  return /^0[1-9]\d{9}$/.test(phone) ? phone : null;
}

type CustomerEmailLine =
  | { kind: "email"; email: string }
  | { kind: "missing" }
  | { kind: "invalid" }
  | { kind: "other" };

function cazooCustomerEmailLine(value: string): CustomerEmailLine {
  const labelled = /^e-?mail[ \t]*:/i.test(value);
  const candidate = value.replace(/^e-?mail[ \t]*:[ \t]*/i, "").trim();
  if (labelled && /^(?:|-|—|n\/a|none|not provided|not supplied)$/i.test(candidate))
    return { kind: "missing" };

  // Do not search for addresses inside arbitrary text or strip URL queries.
  // A mailto prefix is accepted only as a complete, otherwise valid address.
  const address = (text: string) => mailbox(text.replace(/^mailto:/i, ""));
  const direct = address(candidate);
  if (direct) return { kind: "email", email: direct };
  const pair = /^([^\s()<>]+)[ \t]+\([ \t]*([^\s()<>]+)[ \t]*\)$/.exec(candidate);
  if (pair) {
    const visible = address(pair[1]!);
    const target = address(pair[2]!);
    if (visible && visible === target) return { kind: "email", email: visible };
  }
  if (labelled || /@|\bmailto:/i.test(candidate)) return { kind: "invalid" };
  return { kind: "other" };
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
      /(?:^|\n)[ \t]*Customer details[ \t]*\n([\s\S]*?)(?=\n[ \t]*(?:(?:Call|Email)(?:[ \t]+[^\n]*)?[ \t]*(?=\n|$)|Follow us|This email was sent|cazoo logo|Trustpilot|CorrelationID:)|$)/gi,
    ),
  ];
  if (messages.length !== 1 || details.length !== 1)
    throw new CazooLeadError("unrecognised_message_layout");
  const lines = details[0]![1]!
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const emailLines = lines.map(cazooCustomerEmailLine);
  const emails = [...new Set(emailLines.flatMap((line) => line.kind === "email" ? [line.email] : []))];
  if (emailLines.some((line) => line.kind === "invalid") || emails.length > 1 || emails[0] === "dealerleads@info.cazoo.co.uk")
    throw new CazooLeadError("missing_or_ambiguous_customer_email");
  const phoneLines = lines.filter((s) => /^(?:phone|telephone|tel|mobile)\s*:/i.test(s) || /^[+\d(][\d\s().\-‐‑‒–—+]*(?:(?:ext(?:ension)?\.?|x|#)\s*\d+)?$/i.test(s) || /^[+\d(][^\r\n]*\([ \t]*tel:/i.test(s));
  const phones = [...new Set(phoneLines.map(cazooPhone))];
  const phone = phones.length === 1 ? phones[0]! : null;
  const contactWarnings: NonNullable<CazooLead["contactWarnings"]> = [];
  if (phoneLines.length && !phone) contactWarnings.push("phone_needs_checking");
  if (!emails.length) contactWarnings.push("customer_email_missing");
  const nameLines = lines.filter((s, index) => emailLines[index]!.kind === "other" && !phoneLines.includes(s));
  // With no valid email, an extra unclassified contact line may be a broken
  // address. Do not silently absorb it into the customer's name.
  if (!emails.length && nameLines.length > 1)
    throw new CazooLeadError("missing_or_ambiguous_customer_email");
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
    email: emails[0] ?? null,
    phone,
    message,
    ...(contactWarnings.length ? { contactWarnings } : {}),
  };
}
