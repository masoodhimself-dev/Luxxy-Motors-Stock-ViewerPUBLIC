import { CazooLeadError, readCazooLeadDetails } from "./cazoo-lead-parser";

const escape = (value: string) => value.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char]!));
const htmlText = (value: string) => escape(value).replace(/\n/g, "<br>");

export function renderCazooForwardEmail(
  subject: string,
  body: string,
  blockedAddresses: readonly (string | null)[] = [],
  replyDomain?: string,
  format: "current" | "before-part-ex" = "current",
) {
  let lead: ReturnType<typeof readCazooLeadDetails> | undefined;
  try {
    const details = readCazooLeadDetails({ subject: subject.replace(/^Cazoo lead: /, ""), text: body });
    if (details.knownLayout && (format === "current" || !details.partExchange)) lead = details;
  } catch (error) {
    if (!(error instanceof CazooLeadError)) throw error;
  }
  const candidate = lead?.email;
  const replyTo = candidate && !blockedAddresses.includes(candidate) &&
    !(replyDomain && candidate.endsWith(`@${replyDomain}`)) ? candidate : undefined;
  const title = lead ? [lead.vehicleTitle, lead.listedPrice].filter(Boolean).join(" · ") : "Cazoo enquiry";
  const type = lead?.enquiryType
    .replace(/^Urgent\s+Test drive\s+Reserve$/i, "Test drive and reservation · Urgent")
    .replace(/(?:[ \t]*\n[ \t]*)+|[ \t]{2,}/g, " · ");
  const facts: [string, string][] = lead ? [["Registration", lead.registration]] : [];
  if (lead?.partExchange) {
    const otherTypes = type?.replace(/^Part-ex(?:change)?(?: · |$)/i, "");
    facts.push(["Enquiry", ["Part exchange", otherTypes].filter(Boolean).join(" · ")]);
    const { registration, mileage } = lead.partExchange;
    const tradeIn = [registration, mileage === null ? null : `${mileage.toLocaleString("en-GB")} miles`].filter(Boolean).join(" · ");
    if (tradeIn) facts.push(["Trade-in", tradeIn]);
  } else if (type) facts.push(["Enquiry", type]);
  const phone = lead?.phone?.replace(/^(07\d{3})(\d{6})$/, "$1 $2");
  const customer = [lead?.customerName === "Customer" ? undefined : lead?.customerName, phone, replyTo ?? "Customer email unavailable"].filter(Boolean).join("\n");
  const message = lead
    ? lead.message || "No message included."
    : body || "No message included.";
  const note = replyTo ? "Reply to this email to contact the customer."
    : "Check the enquiry in DealerOS or use the phone number if supplied.";
  const messageLabel = lead ? "Customer message" : "Original enquiry for review";
  const text = [title, ...facts.map(([label, value]) => `${label}: ${value}`), "", "Customer", customer, "", messageLabel, message, "", note].join("\n");
  const section = (label: string, value: string) => `<h2 style="margin:0 0 6px;color:#172740;font-size:16px;line-height:1.4">${label}</h2><p style="margin:0 0 20px">${htmlText(value)}</p>`;
  const html = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;font:16px/1.5 Arial,sans-serif;color:#172740;overflow-wrap:anywhere">
    <tr><td style="padding:12px 16px 20px">
      <h1 style="font-size:24px;line-height:1.3;margin:0 0 10px">${escape(title)}</h1>
      ${facts.map(([label, value]) => `<p style="margin:2px 0"><strong>${label}</strong> · ${escape(value)}</p>`).join("")}
      <div style="height:0;margin:18px 0;border-top:1px solid #d7dde7"></div>
      ${section("Customer", customer)}
      ${section(messageLabel, message)}
      <p style="margin:0;color:#475569;font-size:14px">${note}</p>
    </td></tr>
  </table>`;
  return {
    subject: lead ? `Cazoo enquiry · ${lead.vehicleTitle.slice(0, 160)} (${lead.registration})` : subject,
    text,
    html,
    replyTo,
  };
}
