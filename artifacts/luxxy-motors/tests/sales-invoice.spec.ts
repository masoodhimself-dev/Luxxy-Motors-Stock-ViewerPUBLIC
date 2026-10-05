import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { totals, type SaleDraft } from "../src/components/sales-demo/model";
import type {
  SaleWorkspaceDocument,
  SaleWorkspacePayment,
  SaleWorkspaceRecord,
} from "@workspace/vehicle-meta";

test.skip(
  process.env.LUXXY_LOCAL_PREVIEW !== "1",
  "Browser-local sales preview only",
);

const output = "output/ui-premium/invoices";
const fixtureVehicleId = "11111111-1111-4111-8111-111111111111";
const logo = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="48" viewBox="0 0 200 48"><rect width="200" height="48" rx="4" fill="#174c6b"/><text x="100" y="30" fill="white" text-anchor="middle" font-family="Arial" font-size="17">EXAMPLE MOTORS</text></svg>')}`;

function sale(overrides: Partial<SaleDraft> = {}): SaleDraft {
  return {
    id: "DEMO-INVOICE-001",
    customer: "Alex Example",
    email: "alex@example.test",
    phone: "07000 000123",
    address: "10 Example Road\nHarrow\nHA1 1AA",
    vehicleId: fixtureVehicleId,
    vehicle: "2018 Example Touring 1.6",
    registration: "AB18 XYZ",
    price: "15000",
    partExchange: false,
    pxRegistration: "",
    pxDescription: "",
    pxValue: "",
    deposit: "",
    paymentMethod: "Bank transfer",
    notes: "Collection by appointment. Bring the agreed vehicle documents.",
    collection: "2026-10-20",
    preparation: false,
    documents: false,
    handover: false,
    ...overrides,
  };
}

const completeSale = sale({
  exchanges: [
    {
      registration: "PX11 AAA",
      description: "Example Hatchback",
      value: "3000",
    },
    { registration: "PX12 BBB", description: "Example Estate", value: "1250" },
    { registration: "PX13 CCC", description: "Example City", value: "500" },
  ],
  adjustments: [
    { description: "Delivery to agreed address", amount: "150", kind: "fee" },
    {
      description: "Administration agreed with buyer",
      amount: "50",
      kind: "fee",
    },
    { description: "Agreed discount", amount: "250", kind: "discount" },
  ],
  payments: [
    {
      amount: "250",
      method: "Card",
      date: "2026-10-04",
      reference: "CARD-EXAMPLE-101",
    },
    {
      amount: "1000",
      method: "Bank transfer",
      date: "2026-10-05",
      reference: "TRANSFER-EXAMPLE-102",
    },
    {
      amount: "100",
      method: "Cash",
      date: "2026-10-06",
      reference: "CASH-EXAMPLE-103",
    },
  ],
});

async function openDocument(
  page: Page,
  draft: SaleDraft,
  {
    minimal = false,
    documentType = "invoice" as "invoice" | "statement",
    preview = false,
  } = {},
) {
  const writes: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", (route) => {
    const method = route.request().method();
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
      writes.push(`${method} ${new URL(route.request().url()).pathname}`);
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  await page.route("**/api/dealer-settings", async (route) => {
    const response = await route.fetch();
    const settings = await response.json();
    await route.fulfill({
      json: {
        ...settings,
        identity: {
          ...settings.identity,
          name: "Example Motors",
          logoText: "EXAMPLE MOTORS",
          logoAsset: minimal ? "" : logo,
        },
        contact: minimal
          ? { phone: "", whatsapp: "", email: "" }
          : {
              phone: "020 0000 0123",
              whatsapp: "",
              email: "sales@example.test",
            },
        address: minimal
          ? { street: "", city: "", region: "", postcode: "", mapsUrl: "" }
          : {
              street: "25 Showroom Road",
              city: "Harrow",
              region: "London",
              postcode: "HA2 2BB",
              mapsUrl: "",
            },
        legal: {
          ...settings.legal,
          companyName: minimal ? "" : "Example Motors Limited",
          companyNumber: minimal ? "" : "TEST012345",
          vatNumber: "",
        },
      },
    });
  });
  await page.route("**/api/stock", (route) =>
    route.fulfill({
      json: {
        schemaVersion: 1,
        count: 1,
        dealerName: "Example Motors",
        cars: [
          {
            id: fixtureVehicleId,
            advertId: "TEST-ADVERTISEMENT-1",
            make: "Example",
            model: "Touring",
            year: minimal ? null : 2018,
            title: "Example Touring 1.6",
            variant: null,
            price: 15000,
            currency: "GBP",
            mileage: minimal ? null : 42000,
            registration: minimal ? null : "2018 (18 reg)",
            registrationBand: minimal ? null : "18",
            plate: minimal ? null : "AB18 XYZ",
            vrm: minimal ? null : "AB18 XYZ",
            vrmVerified: minimal ? null : true,
            fuel: minimal ? null : "Petrol",
            transmission: minimal ? null : "Automatic",
            heroImage: null,
            images: [],
          },
        ],
      },
    }),
  );
  await page.route("**/api/enquiries*", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/reservations", (route) =>
    route.fulfill({ json: { reservations: [] } }),
  );
  const amount = totals(draft);
  const ledger: SaleWorkspacePayment[] = (draft.payments ?? []).map(
    (row, index) => ({
      ...row,
      id: `payment-${index}`,
      amountPence: Math.round(Number(row.amount) * 100),
      signedAmountPence: Math.round(Number(row.amount) * 100),
      kind: index === 0 ? "deposit" : "part-payment",
      status: "confirmed",
      recordedBy: "Test staff",
      recordedAt: "2026-10-04T10:00:00Z",
    }),
  );
  const frozenDraft = { ...draft, payments: ledger };
  const snapshot = {
    draft: frozenDraft,
    payments: ledger,
    totals: {
      ...amount,
      totalDue: amount.price + amount.adjustments - amount.allowance,
      confirmedPaid: amount.deposit,
      pending: 0,
    },
    branding: {
      identity: {
        name: "Example Motors",
        logoText: "EXAMPLE MOTORS",
        logoAsset: minimal ? "" : logo,
      },
      contact: { phone: minimal ? "" : "020 0000 0123", email: "" },
      address: minimal
        ? { street: "", city: "", region: "", postcode: "" }
        : {
            street: "25 Showroom Road",
            city: "Harrow",
            region: "London",
            postcode: "HA2 2BB",
          },
      legal: {
        companyName: minimal ? "" : "Example Motors Limited",
        companyNumber: minimal ? "" : "TEST012345",
        vatNumber: "",
      },
    },
    vehicle: {
      title: draft.vehicle,
      year: minimal ? null : 2018,
      fuel: minimal ? null : "Petrol",
      transmission: minimal ? null : "Automatic",
      mileage: minimal ? null : 42000,
    },
  };
  const invoice: SaleWorkspaceDocument = {
    id: "invoice",
    number: "INV-TEST-001",
    type: "invoice",
    title: "Sales invoice",
    issuedAt: "2026-10-04T10:00:00Z",
    issuedBy: "Test staff",
    version: 1,
    balanceAtIssue: amount.balance,
    snapshot,
  };
  const statement: SaleWorkspaceDocument = {
    ...invoice,
    id: "statement",
    number: "STM-TEST-001",
    type: "statement",
    title: "Balance statement",
  };
  const receipt: SaleWorkspaceDocument | undefined = ledger[0]
    ? {
        ...invoice,
        id: "receipt",
        number: "RCP-TEST-001",
        type: "receipt",
        title: "Deposit receipt",
        paymentId: ledger[0].id,
        paymentAmountPence: ledger[0].amountPence,
      }
    : undefined;
  const record: SaleWorkspaceRecord = {
    id: draft.id,
    reference: draft.id,
    revision: 1,
    draft: frozenDraft,
    payments: ledger,
    documents: [invoice, statement, ...(receipt ? [receipt] : [])],
    events: [],
    createdAt: "2026-10-04T10:00:00Z",
    updatedAt: "2026-10-04T10:00:00Z",
  };
  await page.route("**/api/sale-workspace", (route) =>
    route.fulfill({ json: { sales: [record], preview: true } }),
  );
  await page.goto("/portal?section=sales");
  await page.getByRole("button", { name: new RegExp(draft.customer) }).click();
  await page.getByRole("button", { name: "Documents", exact: true }).click();
  if (!preview)
    await page
      .getByLabel("Document", { exact: true })
      .selectOption(documentType);
  await expect(page.locator(".sales-document")).toContainText("Example Motors");
  return { writes, errors };
}

async function preparePrint(page: Page) {
  await page.evaluate(() => {
    window.print = () => {};
  });
  await page
    .getByRole("button", { name: "Print / Save PDF", exact: true })
    .click();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("body > .sales-print-copy")).toBeVisible();
  await expect(page.locator("#root")).toBeHidden();
  await expect(page).toHaveTitle(
    /Example Motors - (Sales invoice|Balance statement|Deposit receipt) - (INV|STM|RCP)-TEST-001/,
  );
  return page.locator("body > .sales-print-copy");
}

function pdfPageCount(pdf: Buffer) {
  return (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length;
}

function pdfTitle(pdf: Buffer) {
  const title = pdf
    .toString("latin1")
    .match(/\/Title\s*(?:<([\da-f]+)>|\(([^)]*)\))/i);
  if (!title) return "";
  if (title[1]) {
    const bytes = Buffer.from(title[1], "hex");
    return bytes[0] === 0xfe && bytes[1] === 0xff
      ? bytes.subarray(2).swap16().toString("utf16le")
      : bytes.toString("utf8");
  }
  return title[2]
    .replace(/\\([0-7]{1,3})/g, (_, octal) =>
      String.fromCharCode(parseInt(octal, 8)),
    )
    .replace(/\\([\\()])/g, "$1");
}

function expectA4(pdf: Buffer) {
  const mediaBoxes = [
    ...pdf
      .toString("latin1")
      .matchAll(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/g),
  ];
  expect(mediaBoxes.length).toBeGreaterThan(0);
  for (const box of mediaBoxes) {
    expect(Number(box[1])).toBeCloseTo(595, -1);
    expect(Number(box[2])).toBeCloseTo(842, -1);
  }
}

test("invoice separates sale price, exchanges and mixed payment records accurately", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { writes, errors } = await openDocument(page, completeSale, {
    documentType: "statement",
  });
  const invoice = page.locator(".sales-document");
  await expect(invoice.locator(".invoice-items")).toContainText("£15,000.00");
  await expect(invoice.locator(".invoice-items")).toContainText(
    "Delivery to agreed address",
  );
  await expect(invoice.locator(".invoice-items")).toContainText("-£250.00");
  for (const exchange of completeSale.exchanges!) {
    await expect(invoice.locator(".invoice-exchanges")).toContainText(
      exchange.registration,
    );
    await expect(invoice.locator(".invoice-exchanges")).toContainText(
      exchange.description,
    );
  }
  for (const payment of completeSale.payments!) {
    await expect(invoice.locator(".invoice-payments")).toContainText(
      payment.method,
    );
    await expect(invoice.locator(".invoice-payments")).toContainText(
      payment.reference,
    );
  }
  await expect(invoice.locator(".invoice-payments")).toContainText(
    /4\s+Oct(?:ober)?\s+2026|04\/10\/2026/,
  );
  await expect(invoice.locator(".invoice-totals")).toContainText("£14,950.00");
  await expect(invoice.locator(".invoice-totals")).toContainText("-£4,750.00");
  await expect(invoice.locator(".invoice-totals")).toContainText("£1,350.00");
  await expect(invoice.locator(".invoice-balance")).toContainText("£8,850.00");
  await expect(invoice).toContainText("Example Motors Limited");
  await expect(invoice).toContainText("TEST012345");
  await expect(invoice).toContainText("42,000");
  await expect(invoice).toContainText("Petrol");
  await expect(invoice).toContainText("Automatic");
  await expect(invoice).toContainText("Balance statement at issue");
  await expect(invoice).not.toContainText(
    /DEMO.*NOT ISSUED|NO PAYMENT RECEIVED/i,
  );
  await expect(invoice).not.toContainText("VAT number");
  await mkdir(output, { recursive: true });
  await invoice.screenshot({ path: `${output}/invoice-desktop.png` });
  await page.getByLabel("Document", { exact: true }).selectOption("receipt");
  await expect(invoice.locator(".invoice-receipt-amount")).toContainText(
    "£250.00",
  );
  await expect(invoice).toContainText("Payment recorded by staff");
  await expect(invoice).not.toContainText("TRANSFER-EXAMPLE-102");
  await expect(invoice).not.toContainText("CASH-EXAMPLE-103");
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test("phone invoice remains readable and omits missing optional details", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const minimalSale = sale({
    email: "",
    phone: "",
    address: "",
    registration: "",
    notes: "",
    collection: "",
    exchanges: [],
    payments: [],
    adjustments: [],
  });
  const { writes, errors } = await openDocument(page, minimalSale, {
    minimal: true,
  });
  const invoice = page.locator(".sales-document");
  await expect(invoice.locator(".invoice-exchanges")).toHaveCount(0);
  await expect(invoice.locator(".invoice-payments")).toHaveCount(0);
  await expect(invoice).not.toContainText(
    /Customer name|Vehicle not selected|Contact seller|undefined|null|VAT number|Company number|Registration:/i,
  );
  await expect(invoice.locator(".invoice-balance")).toContainText("£15,000.00");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await mkdir(output, { recursive: true });
  await invoice.screenshot({ path: `${output}/invoice-phone.png` });
  const amount = invoice.locator(".invoice-items tbody td").last();
  expect(
    await amount.evaluate((node) =>
      parseFloat(getComputedStyle(node).fontSize),
    ),
  ).toBeGreaterThanOrEqual(12);
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test("normal sale prints as one A4 page without editor controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { writes } = await openDocument(page, completeSale);
  const originalTitle = await page.title();
  const print = await preparePrint(page);
  await expect(print.locator("input, textarea, select, button")).toHaveCount(0);
  expect(await print.evaluate((node) => getComputedStyle(node).padding)).toBe(
    "0px",
  );
  await expect(print).toContainText("£8,850.00");
  await expect(print).toContainText(completeSale.notes);
  const pdf = await page.pdf({
    preferCSSPageSize: true,
    printBackground: true,
  });
  await mkdir(output, { recursive: true });
  await writeFile(`${output}/invoice-a4.pdf`, pdf);
  expect(pdfTitle(pdf)).toBe("Example Motors - Sales invoice - INV-TEST-001");
  expect(pdfPageCount(pdf)).toBe(1);
  expectA4(pdf);
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await expect(page.locator(".sales-print-copy")).toHaveCount(0);
  await expect(page).toHaveTitle(originalTitle);
  expect(writes).toEqual([]);
});

test("dense invoice continues on A4 pages and retains every record and final note", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const dense = sale({
    price: "50000",
    exchanges: completeSale.exchanges,
    adjustments: Array.from({ length: 22 }, (_, index) => ({
      description: `Agreed service item ${index + 1} with full details for the buyer`,
      amount: "10",
      kind: "fee" as const,
    })),
    payments: Array.from({ length: 24 }, (_, index) => ({
      amount: "20",
      method: index % 2 ? "Cash" : "Bank transfer",
      date: "2026-10-04",
      reference: `PAYMENT-RECORD-${index + 1}`,
    })),
    notes:
      Array.from(
        { length: 15 },
        (_, index) =>
          `Agreed collection note ${index + 1}: Full vehicle documentation is reviewed with the customer at handover.`,
      ).join("\n") + "\nFINAL-INVOICE-NOTE-END",
  });
  const { writes, errors } = await openDocument(page, dense, {
    documentType: "statement",
  });
  const print = await preparePrint(page);
  await expect(print.locator(".invoice-items")).toContainText(
    "Agreed service item 22",
  );
  await expect(print.locator(".invoice-payments")).toContainText(
    "PAYMENT-RECORD-24",
  );
  await expect(print).toContainText("FINAL-INVOICE-NOTE-END");
  await expect(print.locator(".invoice-balance")).toContainText("£44,990.00");
  const clipping = await print.evaluate((sheet) =>
    [
      ...sheet.querySelectorAll<HTMLElement>(
        ".invoice-items, .invoice-exchanges, .invoice-payments, .invoice-totals",
      ),
      sheet as HTMLElement,
    ].some((node) => {
      const style = getComputedStyle(node);
      return (
        ["hidden", "clip"].includes(style.overflowY) &&
        node.scrollHeight > node.clientHeight + 1
      );
    }),
  );
  expect(clipping).toBe(false);
  const pdf = await page.pdf({
    preferCSSPageSize: true,
    printBackground: true,
  });
  expect(pdfPageCount(pdf)).toBeGreaterThan(1);
  expectA4(pdf);
  await mkdir(output, { recursive: true });
  await writeFile(`${output}/invoice-dense-a4.pdf`, pdf);
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test("invalid overpaid sale cannot create an issued or printed invoice", async ({
  page,
}) => {
  const { writes } = await openDocument(
    page,
    sale({
      payments: [
        {
          amount: "15001",
          method: "Cash",
          date: "2026-10-04",
          reference: "OVERPAYMENT-TEST",
        },
      ],
    }),
    { preview: true },
  );
  await page.evaluate(() => {
    window.print = () => {
      throw new Error("Invalid draft should not print");
    };
  });
  await page
    .getByRole("button", { name: "Print / Save PDF", exact: true })
    .click();
  await expect(
    page.getByText(
      "Part exchange, discounts and payments cannot exceed the total due.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(page.locator(".sales-print-copy")).toHaveCount(0);
  expect(writes).toEqual([]);
});
