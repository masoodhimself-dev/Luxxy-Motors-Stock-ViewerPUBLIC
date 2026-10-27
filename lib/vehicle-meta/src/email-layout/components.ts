import {
  displayText as t,
  escapeHtml as e,
  mailLink,
  phoneLink,
} from "./safety.ts";
import type { AppointmentDisplay, TemplateId } from "./types.ts";

export const SYSTEM = {
  font: "Arial,Helvetica,sans-serif",
  ink: "#172033",
  muted: "#5A626E",
  rule: "#DFE3E8",
  white: "#FFFFFF",
  success: "#245B42",
  pending: "#805500",
  danger: "#963438",
} as const;
const copy = `font-family:${SYSTEM.font};font-size:16px;line-height:25px;color:${SYSTEM.ink};word-wrap:break-word;overflow-wrap:anywhere;mso-line-height-rule:at-least;`;
const small = `font-family:${SYSTEM.font};font-size:13px;line-height:20px;color:${SYSTEM.muted};word-wrap:break-word;overflow-wrap:anywhere;`;
export type Fact = {
  label: string;
  value: string;
  tone?: "success" | "pending" | "danger";
};
export type Section = { title: string; facts?: Fact[]; paragraphs?: string[] };
export type View = {
  templateId: TemplateId;
  appointmentDisplay?: AppointmentDisplay;
  preserveCopy?: boolean;
  formatProse?: (value: string) => string;
  subject: string;
  headline: string;
  openingCount?: number;
  dealerName: string;
  logo?: string;
  heading?: string;
  greeting: string;
  paragraphs: string[];
  vehicleTitle?: string;
  registration?: string;
  sections: Section[];
  attachmentNotice?: string;
  fileNames: string[];
  primary?: { label: string; url: string };
  secondary: { label: string; url: string }[];
  email?: string;
  phone?: string;
  address?: string;
  footer?: string;
  palette: { brand: string; buttonText: string; link: string };
};
const documentIds = new Set([
  "invoice",
  "invoice_copy",
  "payment_receipt",
  "balance_statement",
  "document_email",
]);
const table = (html: string) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed;border-collapse:collapse;">${html}</table>`;
const row = (html: string, padding = "0 32px 23px") =>
  html
    ? `<tr><td class="content" style="padding:${padding};${copy}">${html}</td></tr>`
    : "";
export const paragraph = (value: string) =>
  `<p style="margin:0 0 15px;${copy}">${t(value)}</p>`;
const fact = (s: Section | undefined, label: string) =>
  s?.facts?.find((f) => f.label === label);
function metadata(view: View): string {
  const doc = view.sections.find((s) => s.title === "Document details");
  if (doc)
    return [
      fact(doc, "Document")?.value ?? view.headline,
      fact(doc, "Document number")?.value,
      fact(doc, "Issued") ? `Issued ${fact(doc, "Issued")!.value}` : undefined,
    ]
      .filter(Boolean)
      .join(" · ");
  const appointment = view.sections.find((s) => s.title === "Appointment");
  if (appointment)
    return [
      view.templateId.startsWith("booking_") ? "Test drive" : "Appointment",
      fact(appointment, "Status")?.value,
    ]
      .filter(Boolean)
      .join(" · ");
  return (
    (
      {
        vehicle_details: "Vehicle information",
        service_history: "Vehicle records",
        pre_accident_photos: "Requested vehicle photos",
        enquiry_message: "Your vehicle enquiry",
        enquiry_acknowledgement: "Enquiry received",
        dealer_notification: "Customer enquiry",
        callback: "Callback request",
      } as Partial<Record<TemplateId, string>>
    )[view.templateId] ?? ""
  );
}
function vehicle(view: View, letter = false): string {
  if (!view.vehicleTitle && !view.registration) return "";
  const content = `${!letter ? `<p class="secondary" style="margin:0 0 5px;${small}">Your vehicle</p>` : ""}${view.vehicleTitle ? `<p style="margin:0 0 3px;${copy}font-size:${letter ? 16 : 18}px;line-height:25px;font-weight:bold;">${t(view.vehicleTitle)}</p>` : ""}${view.registration ? `<p class="secondary" style="margin:0;${small}">Registration <span style="color:${SYSTEM.ink};font-weight:bold;letter-spacing:.4px;">${t(view.registration)}</span></p>` : ""}`;
  return row(
    letter
      ? table(
          `<tr><td style="padding:1px 0 1px 15px;border-left:3px solid ${view.palette.brand};">${content}</td></tr>`,
        )
      : content,
  );
}
function section(s: Section, format: (value: string) => string = t): string {
  const rows = (s.facts ?? [])
    .map(
      (f) =>
        `<tr><th scope="row" width="38%" align="left" valign="top" style="padding:6px 14px 6px 0;${copy}font-size:14px;line-height:22px;font-weight:normal;color:${SYSTEM.muted};">${t(f.label)}</th><td valign="top" style="padding:6px 0;${copy}font-size:15px;line-height:23px;${f.tone ? `color:${SYSTEM[f.tone]};font-weight:bold;` : ""}">${format(f.value)}</td></tr>`,
    )
    .join("");
  return row(
    `<h2 style="margin:0 0 7px;${copy}font-size:15px;line-height:23px;font-weight:bold;">${t(s.title)}</h2>${rows ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed;border-collapse:collapse;border-top:1px solid ${SYSTEM.rule};">${rows}</table>` : ""}${(s.paragraphs ?? []).map((p) => `<p class="secondary" style="margin:9px 0 0;${small}">${t(p)}</p>`).join("")}`,
  );
}
function documentSummary(s: Section, view: View): string {
  const money = (s.facts ?? []).filter((f) =>
    ["Amount", "Amount received", "Balance on this document"].includes(f.label),
  );
  const invoice = ["invoice", "invoice_copy"].includes(view.templateId);
  const label = (f: Fact) =>
    f.label === "Amount" && invoice
      ? "Invoice amount"
      : f.label === "Amount received" && invoice
        ? "Payments received"
        : f.label === "Balance on this document" && invoice
          ? "Balance on invoice"
          : f.label;
  const rows = money
    .map((f, i) => {
      const balance = f.label === "Balance on this document";
      return `<tr><th scope="row" align="left" valign="top" style="padding:${i === 0 ? 15 : balance ? 14 : 0}px 12px ${balance ? 0 : 12}px 0;${balance && i > 0 ? `border-top:1px solid ${SYSTEM.rule};` : ""}${copy}font-size:${balance ? 16 : 15}px;font-weight:${balance ? "bold" : "normal"};">${t(label(f))}</th><td class="amount" width="44%" align="right" valign="top" style="width:44%;padding:${i === 0 ? 15 : balance ? 14 : 0}px 0 ${balance ? 0 : 12}px;${balance && i > 0 ? `border-top:1px solid ${SYSTEM.rule};` : ""}${copy}font-size:${balance ? 18 : 15}px;font-weight:${balance ? "bold" : "normal"};">${t(f.value)}</td></tr>`;
    })
    .join("");
  const status = fact(s, "Payment status");
  const statusHtml = status
    ? `<span style="${status.tone ? `color:${SYSTEM[status.tone]};` : ""}">${t(status.value)}${/[.!?]$/.test(status.value) ? "" : "."}</span> `
    : "";
  if (!rows && !statusHtml && !s.paragraphs?.length) return "";
  return row(
    `${rows ? `<table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;table-layout:fixed;border-collapse:collapse;border-top:1px solid ${SYSTEM.rule};">${rows}</table>` : ""}${statusHtml || s.paragraphs?.length ? `<p class="secondary" style="margin:9px 0 0;${small}">${statusHtml}${(s.paragraphs ?? []).map(t).join("<br>")}</p>` : ""}`,
  );
}
function appointmentTime(s: Section, view: View): string {
  const time = (s.facts ?? []).find(
    (f) => f.label.includes("(UK time)") && !f.label.startsWith("Previous"),
  );
  const previous = fact(s, "Previous time (UK time)"),
    duration = fact(s, "Duration"),
    d = view.appointmentDisplay;
  let html = "";
  if (time && d) {
    html = table(
      `<tr><td class="when-date" width="50%" valign="top" style="width:50%;padding:15px 20px 15px 0;border-top:1px solid ${SYSTEM.rule};border-bottom:1px solid ${SYSTEM.rule};">${d.day ? `<p class="secondary" style="margin:0 0 4px;${small}">${t(d.day)}</p>` : ""}<p style="margin:0;${copy}font-size:22px;line-height:28px;font-weight:bold;letter-spacing:-.4px;">${t(d.date)}</p>${d.year ? `<p class="secondary" style="margin:3px 0 0;${small}">${t(d.year)}</p>` : ""}</td><td class="when-time" valign="top" style="padding:15px 0 15px 22px;border-top:1px solid ${SYSTEM.rule};border-bottom:1px solid ${SYSTEM.rule};border-left:1px solid ${SYSTEM.rule};"><p class="secondary" style="margin:0 0 4px;${small}">UK time${d.timezone ? " · " + t(d.timezone) : ""}</p><p style="margin:0;${copy}font-size:22px;line-height:28px;font-weight:bold;letter-spacing:-.4px;">${t(d.time)}</p>${duration ? `<p class="secondary" style="margin:3px 0 0;${small}">${t(duration.value)}</p>` : ""}</td></tr>`,
    );
  } else if (time) {
    html = `<p class="secondary" style="margin:0 0 5px;${small}">${t(time.label)}</p><p style="margin:0;${copy}font-size:20px;line-height:28px;font-weight:bold;">${t(time.value)}</p>${duration ? `<p class="secondary" style="margin:5px 0 0;${small}">${t(duration.value)}</p>` : ""}`;
  } else if (duration)
    html = `<p style="margin:0;${copy}">Duration: ${t(duration.value)}</p>`;
  if (previous)
    html += `<p class="secondary" style="margin:9px 0 0;${small}">Previously: ${t(previous.value)}</p>`;
  return row(html);
}
function visit(s: Section): string {
  const address = fact(s, "Address");
  if (!address && !s.paragraphs?.length) return "";
  return row(
    `${address ? `<p class="secondary" style="margin:0 0 6px;${small}">Where to find us</p><p style="margin:0 0 9px;${copy}font-size:15px;line-height:23px;">${t(address.value)}</p>` : ""}${s.paragraphs?.length ? `<p style="margin:0;${copy}font-size:15px;line-height:23px;">${s.paragraphs.map(t).join(" ")}</p>` : ""}`,
  );
}
function action(view: View): string {
  if (!view.primary && !view.secondary.length) return "";
  const primary = view.primary
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:270px;border-collapse:separate;table-layout:fixed;"><tr><td bgcolor="${view.palette.brand}" style="background-color:${view.palette.brand};border:1px solid ${view.palette.brand};border-radius:5px;mso-padding-alt:12px 20px;"><a class="cta" href="${e(view.primary.url)}" style="display:block;padding:12px 20px;font-family:${SYSTEM.font};font-size:15px;line-height:23px;font-weight:bold;color:${view.palette.buttonText};background-color:${view.palette.brand};text-align:center;text-decoration:none;border-radius:5px;overflow-wrap:anywhere;word-wrap:break-word;">${t(view.primary.label)}</a></td></tr></table>`
    : "";
  return row(
    primary +
      view.secondary
        .map(
          (a) =>
            `<p style="margin:12px 0 0;${copy}font-size:14px;"><a href="${e(a.url)}" style="color:${view.palette.link};text-decoration:underline;">${t(a.label)}</a></p>`,
        )
        .join(""),
  );
}
function files(view: View, notice: boolean): string {
  if (!(notice && view.attachmentNotice) && !view.fileNames.length) return "";
  return row(
    `${notice && view.attachmentNotice ? paragraph(view.attachmentNotice) : ""}${view.fileNames.length ? `<p style="margin:0;${small}"><strong style="color:${SYSTEM.ink};">Attached</strong>${view.fileNames.length === 1 ? "&nbsp; " : "<br>"}${view.fileNames.map(t).join("<br>")}</p>` : ""}`,
  );
}
function contact(view: View): string {
  const links: string[] = [];
  if (view.email) {
    const href = mailLink(view.email);
    links.push(
      href
        ? `<a href="${e(href)}" style="color:${view.palette.link};text-decoration:underline;">${t(view.email)}</a>`
        : t(view.email),
    );
  }
  if (view.phone) {
    const href = phoneLink(view.phone);
    links.push(
      href
        ? `<a href="${e(href)}" style="color:${view.palette.link};text-decoration:none;">${t(view.phone)}</a>`
        : t(view.phone),
    );
  }
  const title = view.logo ? view.dealerName : "Contact the dealership";
  return row(
    table(
      `<tr><td style="border-top:1px solid ${SYSTEM.rule};padding:20px 0 0;"><p style="margin:0 0 7px;${copy}font-size:14px;line-height:21px;font-weight:bold;">${t(title)}</p>${links.length ? `<p style="margin:0 0 8px;${small}">${links.join("<br>")}</p>` : ""}${view.address ? `<p class="secondary" style="margin:0;${small}">${t(view.address.replace(/\n/g, ", "))}</p>` : ""}${view.footer ? `<p class="secondary" style="margin:8px 0 0;${small}">${t(view.footer)}</p>` : ""}${!links.length ? `<p style="margin:0;${small}">Reply to this email to contact us.</p>` : ""}</td></tr>`,
    ),
    "0 32px 28px",
  );
}
type Block =
  | { kind: "paragraphs"; items: string[] }
  | { kind: "vehicle"; letter?: boolean }
  | { kind: "section" | "document" | "appointment" | "visit"; section: Section }
  | { kind: "actions" }
  | { kind: "files"; notice: boolean };
function blocks(view: View): Block[] {
  const out: Block[] = [],
    doc = view.sections.find((s) => s.title === "Document details"),
    appointment = view.sections.find((s) => s.title === "Appointment");
  if (view.preserveCopy) {
    // Existing prose already includes any greeting, signoff and attachment wording.
    out.push(
      { kind: "paragraphs", items: view.paragraphs },
      { kind: "vehicle" },
    );
    for (const s of view.sections) out.push({ kind: "section", section: s });
    out.push({ kind: "actions" }, { kind: "files", notice: false });
  } else if (documentIds.has(view.templateId) && doc) {
    const intro = [view.greeting];
    if (view.attachmentNotice) intro.push(view.attachmentNotice);
    if (view.primary) {
      const line = "You can also view it using the link below.";
      if (view.attachmentNotice) intro[intro.length - 1] += " " + line;
      else intro.push(line);
    }
    out.push(
      { kind: "paragraphs", items: intro },
      { kind: "vehicle" },
      { kind: "document", section: doc },
      { kind: "actions" },
      { kind: "files", notice: false },
      { kind: "paragraphs", items: view.paragraphs },
    );
    for (const s of view.sections.filter((s) => s !== doc))
      out.push({ kind: "section", section: s });
  } else if (appointment) {
    out.push(
      {
        kind: "paragraphs",
        items: [view.greeting, ...view.paragraphs.slice(0, 1)],
      },
      { kind: "appointment", section: appointment },
      { kind: "vehicle" },
      { kind: "visit", section: appointment },
      { kind: "actions" },
      { kind: "paragraphs", items: view.paragraphs.slice(1) },
      { kind: "files", notice: true },
    );
    for (const s of view.sections.filter((s) => s !== appointment))
      out.push({ kind: "section", section: s });
  } else if (view.templateId === "enquiry_message") {
    out.push(
      { kind: "vehicle", letter: true },
      { kind: "paragraphs", items: [view.greeting, ...view.paragraphs] },
    );
    for (const s of view.sections) out.push({ kind: "section", section: s });
    out.push({ kind: "files", notice: true }, { kind: "actions" });
  } else {
    const opening = view.paragraphs[0]?.length <= 400 ? 1 : 0;
    out.push(
      {
        kind: "paragraphs",
        items: [view.greeting, ...view.paragraphs.slice(0, opening)],
      },
      { kind: "vehicle" },
    );
    if (view.templateId === "dealer_notification")
      for (const s of view.sections) out.push({ kind: "section", section: s });
    out.push({ kind: "paragraphs", items: view.paragraphs.slice(opening) });
    if (view.templateId !== "dealer_notification")
      for (const s of view.sections) out.push({ kind: "section", section: s });
    out.push({ kind: "files", notice: true }, { kind: "actions" });
  }
  return out;
}
function blockHtml(b: Block, view: View): string {
  switch (b.kind) {
    case "paragraphs":
      return row(
        b.items
          .filter(Boolean)
          .map((p) =>
            view.formatProse
              ? `<p style="margin:0 0 15px;${copy}">${view.formatProse(p)}</p>`
              : paragraph(p),
          )
          .join(""),
        "0 32px 8px",
      );
    case "vehicle":
      return vehicle(view, b.letter);
    case "section":
      return section(b.section, view.formatProse);
    case "document":
      return documentSummary(b.section, view);
    case "appointment":
      return appointmentTime(b.section, view);
    case "visit":
      return visit(b.section);
    case "actions":
      return action(view);
    case "files":
      return files(view, b.notice);
  }
}
export function renderHtml(view: View): string {
  const phone = view.phone && phoneLink(view.phone),
    meta = metadata(view);
  const identity = view.logo
    ? `<img src="${e(view.logo)}" width="180" alt="${e(view.dealerName)}" style="display:block;border:0;width:180px;max-width:100%;height:auto;max-height:56px;object-fit:contain;object-position:left center;font-family:${SYSTEM.font};font-size:16px;color:${SYSTEM.ink};">`
    : t(view.dealerName);
  const header = table(
    `<tr><td class="dealer-name" valign="middle" style="${copy}font-size:20px;line-height:26px;font-weight:bold;letter-spacing:-.5px;">${identity}${view.heading ? `<p class="secondary" style="margin:4px 0 0;${small}font-weight:normal;letter-spacing:normal;">${t(view.heading)}</p>` : ""}</td>${view.phone ? `<td class="header-phone" width="140" align="right" valign="middle" style="width:140px;${small}">${phone ? `<a href="${e(phone)}" style="color:${view.palette.link};text-decoration:none;">${t(view.phone)}</a>` : t(view.phone)}</td>` : ""}</tr>`,
  );
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${e(view.subject)}</title><style>@media screen and (max-width:480px){.content{padding-left:22px!important;padding-right:22px!important}.header-phone{display:none!important}.dealer-name{width:100%!important}.when-date{padding-right:16px!important}.when-time{padding-left:16px!important}.headline{font-size:24px!important;line-height:30px!important}}@media(prefers-color-scheme:dark){.email-body,.email-shell{background-color:#141A24!important}.email-shell p,.email-shell h1,.email-shell h2,.email-shell td,.email-shell th,.email-shell span,.email-shell strong{color:#EEF1F6!important}.email-shell .secondary{color:#B9C2CE!important}.email-shell a{color:#BFD5FF!important}.email-shell .cta{color:${view.palette.buttonText}!important;background-color:${view.palette.brand}!important;border:1px solid #8F9CB0!important}}</style></head><body class="email-body" bgcolor="#FFFFFF" style="margin:0;padding:0;width:100%;background-color:#FFFFFF;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;"><tr><td align="center"><!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]--><table role="presentation" class="email-shell" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FFFFFF" style="width:100%;max-width:600px;background-color:#FFFFFF;table-layout:fixed;border-collapse:collapse;"><tr><td height="4" bgcolor="${view.palette.brand}" style="height:4px;line-height:4px;font-size:0;background-color:${view.palette.brand};">&nbsp;</td></tr>${row(header, "28px 32px 28px")}${row(`${meta ? `<p class="secondary" style="margin:0 0 8px;${small}">${t(meta)}</p>` : ""}<h1 class="headline" style="margin:0;font-family:${SYSTEM.font};font-size:26px;line-height:32px;font-weight:bold;color:${SYSTEM.ink};letter-spacing:-.5px;overflow-wrap:anywhere;word-wrap:break-word;">${t(view.headline)}</h1>`, "0 32px 18px")}${blocks(
    view,
  )
    .map((b) => blockHtml(b, view))
    .join(
      "",
    )}${contact(view)}</table><!--[if mso]></td></tr></table><![endif]--></td></tr></table></body></html>`;
}
export function renderPlainText(view: View): string {
  const parts = [view.dealerName, view.heading, metadata(view), view.headline];
  for (const b of blocks(view)) {
    switch (b.kind) {
      case "paragraphs":
        parts.push(...b.items);
        break;
      case "vehicle":
        if (view.vehicleTitle || view.registration)
          parts.push(
            [
              view.vehicleTitle,
              view.registration
                ? `Registration ${view.registration}`
                : undefined,
            ]
              .filter(Boolean)
              .join("\n"),
          );
        break;
      case "document": {
        const facts = (b.section.facts ?? []).filter(
          (f) => !["Document", "Document number", "Issued"].includes(f.label),
        );
        parts.push(
          [
            ...facts.map((f) => `${f.label}: ${f.value}`),
            ...(b.section.paragraphs ?? []),
          ].join("\n"),
        );
        break;
      }
      case "appointment":
        parts.push(
          (b.section.facts ?? [])
            .filter((f) => f.label !== "Address" && f.label !== "Status")
            .map((f) => `${f.label}: ${f.value}`)
            .join("\n"),
        );
        break;
      case "visit":
        parts.push(
          [fact(b.section, "Address")?.value, ...(b.section.paragraphs ?? [])]
            .filter(Boolean)
            .join("\n"),
        );
        break;
      case "section":
        parts.push(
          [
            b.section.title,
            ...(b.section.facts ?? []).map((f) => `${f.label}: ${f.value}`),
            ...(b.section.paragraphs ?? []),
          ].join("\n"),
        );
        break;
      case "actions":
        if (view.primary)
          parts.push(`${view.primary.label}\n${view.primary.url}`);
        for (const a of view.secondary) parts.push(`${a.label}\n${a.url}`);
        break;
      case "files":
        if (b.notice && view.attachmentNotice)
          parts.push(view.attachmentNotice);
        if (view.fileNames.length)
          parts.push(
            "Attached files\n" + view.fileNames.map((n) => "- " + n).join("\n"),
          );
        break;
    }
  }
  parts.push(
    [view.email, view.phone, view.address, view.footer]
      .filter(Boolean)
      .join("\n") || "Reply to this email to contact us.",
  );
  return parts.filter((p) => p?.trim()).join("\n\n") + "\n";
}
