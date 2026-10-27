import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultEmailAppearance,
  defaultEmailTemplates,
  renderEmailTemplate,
  type EmailFacts,
} from "@workspace/vehicle-meta";
import {
  previewEmailTemplate,
  sampleEmailVariables,
} from "./lib/email-template-preview";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const template = {
  subject: "Your car — {{customer_name}}",
  body: "Hi {{customer_name}},\n\nHere are your details.\nAnother line.\n\nThanks,\n{{dealer_name}}",
};
test("new layout resolves branding variables and never adds another greeting or rewrites dealer copy", () => {
  const saved = {
    subject: "A note from {{dealer_name}}",
    body: "Dear {{customer_name}},\n\nPlease keep this wording exactly.\n\nKind regards,\nPat at {{dealer_name}}",
    headline: "An update for {{customer_name}}",
  };
  const before = JSON.stringify(saved);
  const rendered = renderEmailTemplate(
    saved,
    sampleEmailVariables,
    [],
    {
      ...defaultEmailAppearance,
      heading: "{{dealer_name}}",
      footer: "Speak to {{dealer_name}} on {{dealer_phone}}.",
    },
    { templateId: "enquiry_message" },
  );
  assert.equal(JSON.stringify(saved), before);
  assert.equal(rendered.subject, "A note from Example Motors");
  assert.equal(
    rendered.bodyText,
    "Dear Alex Taylor,\n\nPlease keep this wording exactly.\n\nKind regards,\nPat at Example Motors",
  );
  assert.doesNotMatch(rendered.html, /\{\{|Hello Alex|Hi Alex/);
  assert.equal((rendered.html.match(/Dear Alex Taylor/g) ?? []).length, 1);
  assert.match(rendered.html, /Speak to Example Motors on 07700 900123/);
});
test("the layout does not add unselected car facts, attachment claims or business-state validation", () => {
  const rendered = renderEmailTemplate(
    {
      subject: "A quick question",
      body: "Has the payment received yesterday reached your account?",
    },
    sampleEmailVariables,
    [
      { label: "Amount received", value: 0 },
      { label: "Payment status", value: "pending" },
    ],
    defaultEmailAppearance,
    { templateId: "invoice" },
  );
  assert.match(rendered.html, /Amount received/);
  assert.match(rendered.html, /pending/);
  assert.doesNotMatch(
    rendered.html,
    /Your invoice is attached|>Attached<|Volkswagen Golf|AB22 CDE/,
  );
  assert.equal(
    rendered.bodyText,
    "Has the payment received yesterday reached your account?",
  );
});
test("every template renders a complete responsive HTML email and a useful text alternative", () => {
  for (const item of defaultEmailTemplates) {
    const preview = previewEmailTemplate(item.id, item);
    assert.match(preview.html, /<!doctype html>/i);
    assert.match(preview.html, /lang="en-GB"/);
    assert.match(preview.html, /name="viewport"/);
    assert.match(preview.html, /@media screen/);
    assert.match(preview.html, /role="presentation"/);
    assert.match(preview.html, /mso/);
    assert.match(preview.html, /Example Motors/);
    assert.ok(preview.text.length > 40);
    assert.ok(!preview.html.includes("{{"));
    assert.ok(!preview.subject.includes("SAMPLE-001"));
    assert.ok(!preview.text.includes("SAMPLE-001"));
    assert.ok(!preview.html.includes("SAMPLE-001"));
    assert.equal(preview.sent, false);
    assert.equal(preview.sample, true);
    assert.ok(Buffer.byteLength(preview.html) < 102_000);
  }
});
test("legacy internal references stay hidden while document numbers, bank references and secure links survive", () => {
  const reference = "K4QM-9TXR";
  const url = `https://example.test/viewing/private-token?reference=${reference}`;
  const rendered = renderEmailTemplate(
    {
      subject: "Your test drive — {{reference}}",
      body: "Hi {{customer_name}},\n\nEnquiry reference: {{reference}}\nBooking reference: ACDE-3467\n\nYour appointment is confirmed for {{appointment_time}}.\n{{message}}\nInvoice: {{document_number}}\nManage: {{manage_url}}",
      headline: "Your test drive — K4QM-9TXR",
    },
    {
      ...sampleEmailVariables,
      reference,
      manage_url: url,
      document_number: "INV-2026-0042",
      message:
        "Sale reference: SALE-2026-0008\nPayment reference: BANK-042\nWe look forward to seeing you.",
    },
    [
      { label: "Reference", value: reference },
      { label: "Enquiry reference", value: reference },
      { label: "Sale", value: reference },
      { label: "Vehicle", value: sampleEmailVariables.vehicle_title },
      { label: "Payment reference", value: "BANK-042" },
      { label: "Document", value: "INV-2026-0042" },
    ],
    {
      ...defaultEmailAppearance,
      footer: "Booking reference: {{reference}}\nReply if you need help.",
    },
    { templateId: "booking_confirmation", attachments: ["INV-2026-0042.pdf"] },
  );
  assert.equal(rendered.subject, "Your test drive");
  for (const raw of [rendered.bodyText, rendered.text, rendered.html]) {
    const body = raw.replaceAll("&#8203;", "").replaceAll(url, "");
    assert.doesNotMatch(body, /K4QM-9TXR|ACDE-3467|SALE-2026-0008/);
    assert.doesNotMatch(
      body,
      /Enquiry reference:|Booking reference:|Sale reference:/,
    );
    assert.match(body, /INV-2026-0042/);
    assert.match(body, /BANK-042/);
  }
  assert.ok(
    rendered.html.includes(`href="${url}"`),
    "The original private URL remains intact",
  );
  assert.ok(rendered.text.includes(url));
  assert.match(rendered.text, /Monday 19 October 2026 at 10:30/);
  assert.match(rendered.text, /2022 Volkswagen Golf/);
  const referenceOnly = renderEmailTemplate(
    { subject: "{{reference}}", body: "Please reply with any questions." },
    { reference },
    [],
    defaultEmailAppearance,
    { templateId: "booking_confirmation" },
  );
  assert.equal(referenceOnly.subject, "Test drive confirmed");
  const prefixed = renderEmailTemplate(
    {
      subject: "{{reference}} — Your appointment",
      body: "Your booking reference is {{reference}}.\n\nYour appointment is confirmed.\nYour payment reference is BANK-042.",
    },
    { reference },
    [],
    defaultEmailAppearance,
    { templateId: "booking_confirmation" },
  );
  assert.equal(prefixed.subject, "Your appointment");
  assert.equal(
    prefixed.bodyText,
    "Your appointment is confirmed.\nYour payment reference is BANK-042.",
  );
  assert.doesNotMatch(prefixed.text, /Your booking reference is|K4QM-9TXR/);
});
test("facts omit missing values but retain meaningful zeros and custom wording", () => {
  const facts: EmailFacts = [
    { label: "Amount received", value: 0 },
    { label: "Missing registration", value: "" },
    { label: "Missing history", value: null },
    { label: "Missing colour", value: undefined },
  ];
  const rendered = renderEmailTemplate(
    template,
    { ...sampleEmailVariables, customer_name: "Pat" },
    facts,
  );
  assert.match(rendered.html, /Amount received/);
  assert.match(rendered.text, /Amount received: 0/);
  for (const name of [
    "Missing registration",
    "Missing history",
    "Missing colour",
  ])
    assert.ok(!rendered.html.includes(name));
  assert.match(rendered.html, /Hi Pat/);
  assert.match(rendered.html, /Another line/);
  assert.ok(!rendered.html.includes("Confirmed details"));
  const empty = renderEmailTemplate(template, {}, [], {
    ...defaultEmailAppearance,
    heading: "",
  });
  assert.ok(!empty.html.includes('<td class="email-brand"'));
  assert.match(empty.html, /Hi there,/);
});
test("untrusted subjects, messages, facts, footers and attachment names never become HTML", () => {
  const attack = "<img src=x onerror=evil()>";
  const rendered = renderEmailTemplate(
    { subject: "{{customer_name}}", body: "{{message}}" },
    {
      customer_name: "Pat\r\nBCC: attacker",
      message: `${attack}\n<script>bad()</script>`,
    },
    [{ label: attack, value: attack }],
    { ...defaultEmailAppearance, heading: "{{customer_name}}", footer: attack },
    { attachments: [attack + ".pdf"] },
  );
  assert.ok(!rendered.html.includes("<img"));
  assert.ok(!rendered.html.includes("<script>"));
  assert.ok(rendered.html.includes("&lt;img"));
  assert.ok(!/[\r\n]/.test(rendered.subject));
  assert.ok(rendered.text.includes(attack));
});
test("only valid secure links become action buttons, with actions omitted after cancellation", () => {
  const booking = defaultEmailTemplates.find(
    (t) => t.id === "booking_confirmation",
  )!;
  const ready = renderEmailTemplate(
    booking,
    sampleEmailVariables,
    [],
    defaultEmailAppearance,
    { templateId: booking.id },
  );
  assert.match(ready.html, /Manage your test drive/);
  assert.match(ready.text, /Manage your test drive: https:\/\/example.test/);
  for (const url of [
    "javascript:evil()",
    "http://example.test/path",
    "https://user:password@example.test/path",
    'https://example.test/" onclick="evil()',
    "https://example.test\\@evil.test/path",
  ]) {
    const rendered = renderEmailTemplate(
      booking,
      { ...sampleEmailVariables, manage_url: url },
      [],
      defaultEmailAppearance,
      { templateId: booking.id },
    );
    assert.ok(!rendered.html.includes('class="cta"'));
  }
  const cancelled = renderEmailTemplate(
    booking,
    sampleEmailVariables,
    [],
    defaultEmailAppearance,
    { templateId: "booking_cancellation" },
  );
  assert.ok(!cancelled.html.includes('class="cta"'));
});
test("accent buttons keep contrasting text and copy stays readable with a bright brand colour", () => {
  const dark = renderEmailTemplate(
    template,
    sampleEmailVariables,
    [],
    { ...defaultEmailAppearance, brandColour: "#172033" },
    { templateId: "booking_confirmation" },
  );
  const light = renderEmailTemplate(
    template,
    sampleEmailVariables,
    [],
    { ...defaultEmailAppearance, brandColour: "#FFFFFF" },
    { templateId: "booking_confirmation" },
  );
  assert.match(dark.html, /color:#FFFFFF;background-color:#172033/);
  assert.match(light.html, /color:#000000;background-color:#FFFFFF/);
  assert.match(light.html, /color:#172033/);
  const mid = renderEmailTemplate(
    template,
    sampleEmailVariables,
    [],
    { ...defaultEmailAppearance, brandColour: "#777777" },
    { templateId: "booking_confirmation" },
  );
  assert.match(mid.html, /color:#000000;background-color:#777777/);
});
test("attachment card lists only supplied file names and supports image-blocked email clients", () => {
  const withFiles = renderEmailTemplate(
    template,
    sampleEmailVariables,
    [],
    defaultEmailAppearance,
    { attachments: ["INV-100.pdf", "service-book.jpg"] },
  );
  assert.match(withFiles.html, />Attached</);
  assert.match(withFiles.html, /INV-100.pdf/);
  assert.match(withFiles.text, /service-book.jpg/);
  const none = renderEmailTemplate(template, sampleEmailVariables, []);
  assert.ok(!none.html.includes(">Attached<"));
  assert.ok(!none.html.includes("<img"));
  const branded = renderEmailTemplate(template, sampleEmailVariables, [], {
    ...defaultEmailAppearance,
    logoUrl: "https://example.test/logo.png",
  });
  assert.match(branded.html, /alt="Example Motors"/);
  assert.match(branded.html, />Example Motors<\/p>/);
});
test("booking previews present truthful sample states", () => {
  const preview = (id: string) =>
    previewEmailTemplate(
      id,
      defaultEmailTemplates.find((t) => t.id === id)!,
    );
  assert.match(preview("booking_request").text, /not confirmed yet/);
  assert.match(
    preview("booking_request").text,
    /Appointment status: requested — awaiting confirmation/,
  );
  assert.match(
    preview("booking_cancellation").text,
    /Appointment status: cancelled/,
  );
});

test("dealers can customise the in-email title without changing recorded facts", () => {
  const rendered = renderEmailTemplate(
    { ...template, headline: "Ready when you are, {{customer_name}}" },
    sampleEmailVariables,
    [{ label: "Payment status", value: "pending" }],
    defaultEmailAppearance,
    { templateId: "booking_request" },
  );
  assert.match(rendered.html, /Ready when you are, Alex Taylor/);
  assert.match(rendered.html, /pending/);
  assert.match(rendered.text, /Ready when you are/);
  assert.throws(
    () =>
      renderEmailTemplate(
        { ...template, headline: "Unsafe\nheader" },
        sampleEmailVariables,
        [],
      ),
    /one line/,
  );
});

test("editable copy stays separate from the fully branded plain-text alternative", () => {
  const rendered = renderEmailTemplate(
    template,
    sampleEmailVariables,
    [{ label: "Vehicle", value: "Ford Focus" }],
    defaultEmailAppearance,
    { templateId: "enquiry_message" },
  );
  assert.ok(!rendered.bodyText.includes(sampleEmailVariables.dealer_phone!));
  assert.ok(!rendered.bodyText.includes("Details for your records"));
  assert.match(rendered.text, /07700 900123/);
  assert.match(rendered.text, /Vehicle: Ford Focus/);
  assert.match(rendered.html, /font-size:26px/);
  assert.ok(!rendered.html.includes("font-size:32px"));
});

test("long vehicle facts, filenames and substituted headings stay bounded and break safely", () => {
  const long = "W".repeat(1200);
  const rendered = renderEmailTemplate(
    {
      subject: "Your details",
      body: "Hello {{customer_name}},\n\n{{message}}",
      headline: "{{vehicle_title}}",
    },
    {
      ...sampleEmailVariables,
      vehicle_title: long,
      customer_name: "José O’Neill",
      message:
        "The asking price is £12,400. Please let us know if you have questions.",
    },
    [
      { label: "Vehicle", value: long },
      { label: "Cash price", value: "£12,400.00" },
    ],
    { ...defaultEmailAppearance, heading: "{{vehicle_title}}" },
    { templateId: "vehicle_details", attachments: [long + ".pdf"] },
  );
  const title = /<h1[^>]*>(.*?)<\/h1>/
    .exec(rendered.html)![1]!
    .replaceAll("&#8203;", "");
  assert.equal(Array.from(title).length, 200);
  assert.ok(title.endsWith("…"));
  assert.ok(rendered.html.includes("&#8203;"));
  assert.match(rendered.html, /table-layout:fixed/);
  assert.match(rendered.html, /José O’Neill/);
  assert.match(rendered.html, /£12,400\.00/);
  assert.ok(rendered.text.includes(long));
  assert.ok(!rendered.html.includes("Â"));
});

test("prose links exclude sentence punctuation while private action URLs stay exact", () => {
  const capability =
    "https://example.test/test-drive-declaration/Abc_123?token=A%2FB%2BC";
  const rendered = renderEmailTemplate(
    {
      subject: "Your private page",
      body: "See https://example.test/stock. You can also visit (https://example.test/contact).",
    },
    { ...sampleEmailVariables, portal_url: capability },
    [{ label: "Private page", value: capability }],
    defaultEmailAppearance,
    {
      templateId: "enquiry_message",
      actionUrl: capability,
      actionLabel: "Read and sign",
    },
  );
  assert.match(rendered.html, /href="https:\/\/example\.test\/stock"/);
  assert.ok(!rendered.html.includes('href="https://example.test/stock."'));
  assert.match(rendered.html, /href="https:\/\/example\.test\/contact"/);
  assert.ok(
    rendered.html.includes(`href="${capability.replaceAll("&", "&amp;")}"`),
  );
  assert.ok(
    !rendered.html.includes(">Private page</th>"),
    "the same capability URL is not repeated in a details table",
  );
  assert.ok(rendered.text.includes(capability));
});

test("logo geometry has an explicit email-client width and a readable text fallback", () => {
  const rendered = renderEmailTemplate(template, sampleEmailVariables, [], {
    ...defaultEmailAppearance,
    logoUrl: "https://example.test/logo.png",
  });
  assert.match(rendered.html, /width="180"/);
  assert.match(
    rendered.html,
    /width:180px;max-width:100%;height:auto;max-height:56px/,
  );
  assert.match(rendered.html, />Example Motors<\/p>/);
  assert.match(rendered.html, /alt="Example Motors"/);
});

test("write fictional visual samples only when explicitly requested", async () => {
  const directory = process.env.EMAIL_DESIGN_OUTPUT_DIR;
  if (!directory) return;
  await mkdir(directory, { recursive: true });
  const samples: Array<{ id: string; label: string }> = [];
  for (const item of defaultEmailTemplates) {
    const rendered = previewEmailTemplate(item.id, item);
    await writeFile(
      path.join(directory, item.id + ".html"),
      rendered.html,
      "utf8",
    );
    samples.push({ id: item.id, label: item.label });
  }
  const wideLogo = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="150" viewBox="0 0 720 150"><rect width="150" height="150" rx="12" fill="#172033"/><text x="75" y="108" font-family="Arial" font-size="100" font-weight="bold" text-anchor="middle" fill="#fff">E</text><text x="180" y="88" font-family="Arial" font-size="54" font-weight="bold" fill="#172033">EXAMPLE MOTORS</text></svg>`;
  const logo =
    "data:image/svg+xml;base64," + Buffer.from(wideLogo).toString("base64");
  const sample = previewEmailTemplate(
    "booking_confirmation",
    defaultEmailTemplates.find((item) => item.id === "booking_confirmation")!,
    {
      ...defaultEmailAppearance,
      logoUrl: "https://example.test/offline-sample-logo.svg",
    },
  );
  await writeFile(
    path.join(directory, "booking-logo.html"),
    sample.html.replace("https://example.test/offline-sample-logo.svg", logo),
    "utf8",
  );
  samples.push({
    id: "booking-logo",
    label: "Booking with fictional offline logo",
  });
  const long = renderEmailTemplate(
    {
      subject: "Long vehicle details",
      body: "Hi {{customer_name}},\n\nHere are the car details you asked for. Reply if you would like to arrange a visit.\n\nThanks,\n{{dealer_name}}",
      headline: "Vehicle details",
    },
    sampleEmailVariables,
    [
      {
        label: "Vehicle",
        value:
          "2022 Mercedes-Benz C Class 2.0 C200 AMG Line Night Edition Premium Plus G-Tronic+ Euro 6 (s/s) 4dr",
      },
      { label: "Registration", value: "AB22 CDE" },
      { label: "Cash price", value: "£12,400.00" },
      { label: "Reference", value: "LONG-REFERENCE-" + "ABCD".repeat(30) },
      {
        label: "Vehicle page",
        value:
          "https://example.test/vehicle/" + "long-vehicle-reference".repeat(6),
      },
    ],
    defaultEmailAppearance,
    {
      templateId: "vehicle_details",
      attachments: [
        "Service-history-book-and-supporting-records-" +
          "document-".repeat(10) +
          ".pdf",
      ],
    },
  );
  await writeFile(path.join(directory, "long-facts.html"), long.html, "utf8");
  samples.push({ id: "long-facts", label: "Long facts and attachment names" });
  await writeFile(
    path.join(directory, "index.html"),
    '<!doctype html><meta charset="utf-8"><title>Fictional email design samples</title><style>body{font:16px Arial;margin:32px;color:#172d3e}a{color:#24577a}li{margin:14px 0}</style><h1>Email design samples</h1><p>Fictional records. No email was sent. The optional logo is an offline SVG used only in this visual fixture.</p><ul>' +
      samples
        .map((item) => `<li><a href="${item.id}.html">${item.label}</a></li>`)
        .join("") +
      "</ul>",
    "utf8",
  );
});
