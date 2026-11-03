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
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .trim()
    .slice(0, 48000);
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
    /^Enquiry\s*[-–—]\s*(.+?)\s+([A-Z0-9]{2,4}\s?[A-Z0-9]{2,4})\s*[-–—]\s*([^\r\n]+)$/i.exec(
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
    ...new Set(lines.map(mailbox).filter((s): s is string => Boolean(s))),
  ];
  if (emails.length !== 1 || emails[0] === "dealerleads@info.cazoo.co.uk")
    throw new CazooLeadError("missing_or_ambiguous_customer_email");
  const phoneLines = lines.filter((s) => /^[+\d][\d ()-]{8,20}$/.test(s));
  if (phoneLines.length > 1)
    throw new CazooLeadError("ambiguous_customer_phone");
  let phone = phoneLines[0]?.replace(/[ ()-]/g, "") ?? null;
  if (phone?.startsWith("+44")) phone = "0" + phone.slice(3);
  // Some Cazoo leads omit the UK mobile's domestic trunk prefix.
  if (phone && /^7\d{9}$/.test(phone)) phone = "0" + phone;
  if (phone && !/^0\d{10}$/.test(phone))
    throw new CazooLeadError("invalid_customer_phone");
  const nameLines = lines.filter((s) => !mailbox(s) && !phoneLines.includes(s));
  const customerName = nameLines.join(" ").replace(/\s+/g, " ").trim();
  if (!customerName || customerName.length > 150 || /[<>@]/.test(customerName))
    throw new CazooLeadError("invalid_customer_name");
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
  };
}
