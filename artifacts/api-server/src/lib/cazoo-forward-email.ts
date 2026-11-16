import { customerWhatsAppDraft, customerWhatsAppNumber, customerWhatsAppUrl, isRestrictedAppleRelayEmail } from "@workspace/vehicle-meta";
import { CazooLeadError, readCazooLeadDetails } from "./cazoo-lead-parser";
import { appleRelayDealerContact } from "./notification-email-copy";
import { publicSeoOrigin } from "./public-page-seo";
import { permittedVehicleSheetImage } from "./vehicle-sheet-image";

const escape = (value: string) => value.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char]!));
const htmlText = (value: string) => escape(value).replace(/\n/g, "<br>");
const escapeAttribute = (value: string) => escape(value).replace(/"/g, "&quot;");
type PortalDestination = { origin: string; enquiryId: string | null };
type ForwardAction = { label: string; href: string; outlined?: boolean };

export type CazooForwardVehicle = {
  name: string | null;
  trim: string | null;
  year: string | null;
  mileage: string | null;
  fuel: string | null;
  gearbox: string | null;
  websitePrice: string | null;
  photoUrl: string | null;
  mileageValue?: number | null;
  websitePriceValue?: number | null;
  shortPath?: string | null;
};

function portalActions(
  destination: PortalDestination | undefined,
  canReply: boolean,
  whatsappLink: string | null,
  legacyWhatsAppNumber: string | null,
): ForwardAction[] {
  const origin = publicSeoOrigin(destination?.origin);
  const enquiryId = destination?.enquiryId;
  const directWhatsApp: ForwardAction[] = [];
  if (whatsappLink) directWhatsApp.push({ label: "Reply on WhatsApp", href: whatsappLink, outlined: true });
  else if (!enquiryId && legacyWhatsAppNumber) {
    directWhatsApp.push({ label: "Open WhatsApp", href: `https://wa.me/${legacyWhatsAppNumber}`, outlined: true });
  }
  if (!origin) return directWhatsApp;
  const url = new URL("/portal", origin);
  if (!enquiryId) {
    url.search = new URLSearchParams({ section: "settings", settingsTab: "emails" }).toString();
    return [{ label: "Review Cazoo enquiry in DealerOS", href: url.href }, ...directWhatsApp];
  }
  url.search = new URLSearchParams({ section: "notifications", workView: "customers", enquiryId }).toString();
  url.searchParams.set("enquiryAction", "reply");
  const reply = { label: "Reply in DealerOS", href: url.href };
  url.searchParams.set("enquiryAction", "fix-email");
  const fix = { label: canReply ? "Fix email address" : "Add customer email", href: url.href };
  const actions: ForwardAction[] = canReply ? [reply, ...directWhatsApp] : [...directWhatsApp];
  if (legacyWhatsAppNumber) {
    url.searchParams.set("enquiryAction", "whatsapp");
    actions.push({ label: "Reply on WhatsApp", href: url.href, outlined: true });
  }
  return [...actions, fix];
}

export function renderCazooForwardEmail(
  subject: string,
  body: string,
  blockedAddresses: readonly (string | null)[] = [],
  replyDomain?: string,
  format: "current" | "before-part-ex" = "current",
  destination?: PortalDestination,
  vehicle?: CazooForwardVehicle,
  options: { whatsapp?: "direct" | "legacy"; allowLegacyAppleReply?: boolean } = {},
) {
  let lead: ReturnType<typeof readCazooLeadDetails> | undefined;
  try {
    const details = readCazooLeadDetails({ subject: subject.replace(/^Cazoo lead: /, ""), text: body });
    if (details.knownLayout && (format === "current" || !details.partExchange)) lead = details;
  } catch (error) {
    if (!(error instanceof CazooLeadError)) throw error;
  }
  const candidate = lead?.email;
  const appleRelay = !options.allowLegacyAppleReply && isRestrictedAppleRelayEmail(candidate);
  const replyTo = !appleRelay && candidate && !blockedAddresses.includes(candidate) &&
    !(replyDomain && candidate.endsWith(`@${replyDomain}`)) ? candidate : undefined;
  const linkedVehicle = lead && vehicle ? vehicle : null;
  const title = linkedVehicle
    ? linkedVehicle.name || lead?.vehicleTitle || "Cazoo enquiry"
    : lead ? [lead.vehicleTitle, lead.listedPrice].filter(Boolean).join(" · ") : "Cazoo enquiry";
  const type = lead?.enquiryType
    .replace(/^Urgent\s+Test drive\s+Reserve$/i, "Test drive and reservation · Urgent")
    .replace(/(?:[ \t]*\n[ \t]*)+|[ \t]{2,}/g, " · ");
  const facts: [string, string][] = lead ? [["Registration", lead.registration]] : [];
  if (linkedVehicle) {
    if (lead?.listedPrice) facts.push(["Listed on Cazoo", lead.listedPrice]);
    else if (linkedVehicle.websitePrice) facts.push(["Website price", linkedVehicle.websitePrice]);
    const details = [
      ["Trim", linkedVehicle.trim],
      ["Year", linkedVehicle.year],
      ["Mileage", linkedVehicle.mileage],
      ["Fuel", linkedVehicle.fuel],
      ["Gearbox", linkedVehicle.gearbox],
    ] as const;
    for (const [label, value] of details) {
      if (value) facts.push([label, value]);
    }
  }
  if (lead?.partExchange) {
    // Keep the original layout intact for unlinked and already queued forwards.
    const otherTypes = linkedVehicle
      ? type?.replace(/^Part[-‑– ]+(?:exchange|ex)(?:\s*[·,:–—-]\s*|\s+|$)/i, "").trim()
      : type?.replace(/^Part-ex(?:change)?(?: · |$)/i, "");
    facts.push(["Enquiry", ["Part exchange", otherTypes].filter(Boolean).join(" · ")]);
    const { registration, mileage } = lead.partExchange;
    const tradeIn = [registration, mileage === null ? null : `${mileage.toLocaleString("en-GB")} miles`].filter(Boolean).join(" · ");
    if (tradeIn) facts.push(["Trade-in", tradeIn]);
  } else if (type) facts.push(["Enquiry", type]);
  const phone = lead?.phone?.replace(/^(07\d{3})(\d{6})$/, "$1 $2");
  const customer = [lead?.customerName === "Customer" ? undefined : lead?.customerName, phone, appleRelay ? "Private Apple email" : replyTo ?? "Customer email unavailable"].filter(Boolean).join("\n");
  const message = lead
    ? lead.message || "No message included."
    : body || "No message included.";
  let whatsappLink: string | null = null;
  if ((options.whatsapp === "direct" || appleRelay) && lead?.phone) {
    const origin = publicSeoOrigin(destination?.origin);
    const shortPath = linkedVehicle?.shortPath;
    const vehicleUrl = origin && shortPath && /^\/s\/[a-z0-9]{8}$/.test(shortPath) ? new URL(shortPath, origin).href : null;
    const carName = linkedVehicle?.name ?? lead.vehicleTitle;
    const year = linkedVehicle?.year;
    const vehicleTitle = [year && !carName.startsWith(`${year} `) ? year : null, carName, linkedVehicle?.trim].filter(Boolean).join(" ");
    whatsappLink = customerWhatsAppUrl(lead.phone, customerWhatsAppDraft({
      customerName: lead.customerName === "Customer" ? null : lead.customerName,
      vehicleTitle,
      registration: lead.registration,
      mileage: linkedVehicle?.mileageValue,
      price: linkedVehicle?.websitePriceValue,
      vehicleUrl,
    }));
  }
  const legacyWhatsAppNumber = options.whatsapp === "legacy" && lead?.phone ? customerWhatsAppNumber(lead.phone) : null;
  const hasWhatsApp = Boolean(whatsappLink || legacyWhatsAppNumber);
  const relayContact = appleRelay ? appleRelayDealerContact(lead?.phone, whatsappLink) : null;
  const actions = relayContact
    ? [
        ...relayContact.actions.map(({ label, url }) => ({ label, href: url, outlined: true })),
        ...portalActions(destination, false, null, null),
      ]
    : portalActions(destination, Boolean(replyTo), whatsappLink, legacyWhatsAppNumber);
  const note = relayContact?.notice ?? (actions.length && destination?.enquiryId
    ? replyTo
      ? "Use Reply in DealerOS to keep the customer's response with this enquiry."
      : hasWhatsApp
        ? "Reply on WhatsApp or add the customer's confirmed email in DealerOS."
        : "Add the customer's confirmed email in DealerOS before replying."
    : replyTo
      ? "Reply to this email to contact the customer."
      : hasWhatsApp
        ? "Check the enquiry in DealerOS or contact the customer on WhatsApp."
        : "Check the enquiry in DealerOS or use the phone number if supplied.");
  const messageLabel = lead ? "Customer message" : "Original enquiry for review";
  const text = [title, ...facts.map(([label, value]) => `${label}: ${value}`), "", "Customer", customer, "", messageLabel, message, "", note,
    ...actions.flatMap(({ label, href }) => ["", label, href])].join("\n");
  const links = actions.map(({ label, href, outlined }, index) => {
    const style = index === 0
      ? "display:inline-block;padding:10px 15px;border-radius:6px;background:#172740;color:#fff;font-weight:700;text-decoration:none"
      : outlined
        ? "display:inline-block;padding:9px 14px;border:1px solid #172740;border-radius:6px;color:#172740;font-weight:700;text-decoration:none"
        : "display:inline-block;padding:10px 0;color:#172740;font-weight:700;text-decoration:underline";
    return `<p style="margin:0 0 6px"><a href="${escapeAttribute(href)}" style="${style}">${label}</a></p>`;
  }).join("");
  const section = (label: string, value: string) => `<h2 style="margin:0 0 6px;color:#172740;font-size:16px;line-height:1.4">${label}</h2><p style="margin:0 0 20px">${htmlText(value)}</p>`;
  const photoUrl = linkedVehicle?.photoUrl;
  const factsHtml = facts.map(([label, value]) => `<p style="margin:2px 0"><strong>${label}</strong> · ${escape(value)}</p>`).join("");
  const vehicleSummary = permittedVehicleSheetImage(photoUrl)
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
        <td width="38%" valign="top" style="padding:4px 14px 0 0">
          <img src="${escape(photoUrl).replace(/"/g, "&quot;")}" alt="${escape(title).replace(/"/g, "&quot;")}" width="188" referrerpolicy="no-referrer" style="display:block;width:100%;max-width:188px;height:auto;border-radius:6px">
        </td><td valign="top">${factsHtml}</td>
      </tr></table>`
    : factsHtml;
  const html = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;font:16px/1.5 Arial,sans-serif;color:#172740;overflow-wrap:anywhere">
    <tr><td style="padding:12px 16px 20px">
      <h1 style="font-size:24px;line-height:1.3;margin:0 0 10px">${escape(title)}</h1>
      ${vehicleSummary}
      <div style="height:0;margin:18px 0;border-top:1px solid #d7dde7"></div>
      ${section("Customer", customer)}
      ${section(messageLabel, message)}
      <p style="margin:0;color:#475569;font-size:14px">${note}</p>${links ? `<div style="margin-top:16px">${links}</div>` : ""}
    </td></tr>
  </table>`;
  return {
    subject: lead ? `Cazoo enquiry · ${lead.vehicleTitle.slice(0, 160)} (${lead.registration})` : subject,
    text,
    html,
    replyTo,
  };
}

/** A staff notification for a customer message already accepted into the enquiry. */
export function renderCazooCustomerReplyForwardEmail(input: {
  origin: string;
  enquiryId: string;
  replyId: string;
  customerName: string;
  vehicleTitle: string | null;
  vehicleRegistration: string | null;
  subject: string;
  message: string;
  customerAddress?: string;
  customerPhone?: string | null;
  allowLegacyAppleReply?: boolean;
}) {
  const origin = publicSeoOrigin(input.origin);
  if (!origin) return null;
  const url = new URL("/portal", origin);
  url.search = new URLSearchParams({
    section: "notifications",
    workView: "customers",
    enquiryId: input.enquiryId,
    enquiryAction: "reply",
    enquiryReplyId: input.replyId,
  }).toString();

  const headerText = (value: string) => value.replace(/[\p{Cc}\p{Cf}]/gu, " ").trim().slice(0, 150);
  const subject = `Cazoo customer reply · ${headerText(input.vehicleTitle ?? "") || headerText(input.subject) || "Your enquiry"}`;
  const customer = headerText(input.customerName) || "Customer";
  const vehicle = [input.vehicleTitle, input.vehicleRegistration].filter(Boolean).join(" · ");
  const message = input.message || "This email contained no readable text.";
  const appleRelay = !input.allowLegacyAppleReply && isRestrictedAppleRelayEmail(input.customerAddress);
  const title = "New reply to your Cazoo enquiry";
  const footer = "This reply is saved in DealerOS. Staff sign-in required.";
  let notice = "";
  let actions = [{ label: "Reply in DealerOS", url: url.href }];
  if (appleRelay) {
    url.searchParams.delete("enquiryReplyId");
    url.searchParams.set("enquiryAction", "fix-email");
    const whatsapp = customerWhatsAppUrl(input.customerPhone ?? "", customerWhatsAppDraft({
      customerName: input.customerName,
      vehicleTitle: input.vehicleTitle,
      registration: input.vehicleRegistration,
    }));
    const contact = appleRelayDealerContact(input.customerPhone, whatsapp);
    notice = contact.notice;
    actions = [...contact.actions, { label: "Add customer email", url: url.href }];
  }
  const text = [
    title, customer, vehicle, "", message, "", ...(notice ? [notice, ""] : []),
    ...actions.flatMap(({ label, url }) => [label, url, ""]), footer,
  ].join("\n");
  const links = actions.map(({ label, url }, index) => {
    const style = index === 0
      ? "display:inline-block;padding:10px 15px;border-radius:6px;background:#172740;color:#fff;font-weight:700;text-decoration:none"
      : "display:inline-block;padding:8px 0;color:#172740;font-weight:700;text-decoration:underline";
    return `<p style="margin:0 0 10px"><a href="${escapeAttribute(url)}" style="${style}">${label}</a></p>`;
  }).join("");
  const html = `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;font:16px/1.5 Arial,sans-serif;color:#172740;overflow-wrap:anywhere">
    <tr><td style="padding:12px 16px 20px">
      <h1 style="font-size:24px;line-height:1.3;margin:0 0 10px">${title}</h1>
      <p style="margin:0 0 16px"><strong>${escape(customer)}</strong>${vehicle ? `<br>${escape(vehicle)}` : ""}</p>
      <div style="border-top:1px solid #d7dde7;padding-top:14px;margin-bottom:18px">${htmlText(message)}</div>
      ${notice ? `<p style="margin:0 0 14px;color:#475569;font-size:14px">${notice}</p>` : ""}${links}
      <p style="margin:0;color:#475569;font-size:14px">${footer}</p>
    </td></tr>
  </table>`;
  return { subject, text, html };
}
