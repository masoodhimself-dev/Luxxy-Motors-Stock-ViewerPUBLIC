import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { archivedPdf, attachGuidedSale, confirmInvoiceVehicle, expectA4, openedPdf, openInvoiceCompose, openSavedPaperwork, pdfPageCount, pdfText } from "./sales-pdf-fixture";
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

const fixtureVehicleId = "11111111-1111-4111-8111-111111111111";
const logo = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="48" viewBox="0 0 200 48"><rect width="200" height="48" rx="4" fill="#174c6b"/><text x="100" y="30" fill="white" text-anchor="middle" font-family="Arial" font-size="17">EXAMPLE MOTORS</text></svg>')}`;

function sale(overrides: Partial<SaleDraft> = {}): SaleDraft {
  return {
    id: "11111111-1111-4111-8111-111111111112",
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
    documentType = "invoice" as SaleWorkspaceDocument["type"],
    open = true,
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
  const disclosures: SaleWorkspaceDocument = { ...invoice, id: "vehicle-details", number: "VEH-TEST-001", type: "vehicle-details", title: "Vehicle details and disclosures" };
  const documents = [invoice, statement, ...(receipt ? [receipt] : []), disclosures];
  const archives = new Map(documents.map(document => [document.id, archivedPdf(document)]));
  await page.route("**/api/sale-workspace/*/documents/*/pdf", route => {
    const id = new URL(route.request().url()).pathname.split("/").at(-2)!;
    return route.fulfill({ contentType: "application/pdf", body: archives.get(id)! });
  });
  const record: SaleWorkspaceRecord = {
    id: draft.id,
    reference: draft.id,
    revision: 1,
    draft: frozenDraft,
    payments: ledger,
    documents,
    events: [],
    createdAt: "2026-10-04T10:00:00Z",
    updatedAt: "2026-10-04T10:00:00Z",
  };
  await page.route("**/api/sale-workspace", route => route.request().method() === "GET"
    ? route.fulfill({ json: { sales: [record], preview: true } })
    : route.fallback());
  await page.route(`**/api/sale-workspace/${record.id}`, route => route.request().method() === "GET"
    ? route.fulfill({ json: { sale: record, preview: true } })
    : route.fallback());
  await page.goto("/portal?section=sales");
  await page.getByRole("button", { name: new RegExp(draft.customer) }).click();
  await expect(page.getByRole("heading", { name: "Sale overview", exact: true })).toBeVisible();
  if (open) await openSavedPaperwork(page, documents.find(document => document.type === documentType)!);
  return { writes, errors, documents, archives, record };
}

async function downloadSaved(page: Page) {
  const awaited = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  const download = await awaited;
  return { bytes: await readFile((await download.path())!), filename: download.suggestedFilename() };
}

async function switchPaperwork(page: Page, document: SaleWorkspaceDocument) {
  await page.getByRole("button", { name: "All actions", exact: true }).first().click();
  await openSavedPaperwork(page, document);
}

test("archived statement separates sale price, exchanges and mixed payments", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { writes, errors, archives, documents } = await openDocument(page, completeSale, { documentType: "statement" });
  const statement = await openedPdf(page);
  expect(statement).toEqual(archives.get("statement"));
  const text = await pdfText(statement);
  for (const value of [
    "15,000.00", "Delivery to agreed address", "250.00", "10,200.00", "1,350.00", "8,850.00",
    "Example Motors Limited", "TEST012345", "42,000", "Petrol", "Automatic", "4 Oct 2026",
    ...completeSale.exchanges!.flatMap(exchange => [exchange.registration, exchange.description]),
    ...completeSale.payments!.flatMap(payment => [payment.method, payment.reference]),
  ]) expect(text).toContain(value);
  expect(text).not.toMatch(/DRAFT - not issued|VAT registration/);
  await switchPaperwork(page, documents.find(document => document.type === "receipt")!);
  const receipt = await openedPdf(page);
  expect(receipt).toEqual(archives.get("receipt"));
  expect(await pdfText(receipt)).toContain("250.00");
  expect(await pdfText(receipt)).not.toMatch(/TRANSFER-EXAMPLE-102|CASH-EXAMPLE-103/);
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test("phone invoice is accessible and omits missing optional details", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const minimalSale = sale({ email: "", phone: "", address: "", registration: "", notes: "", collection: "", exchanges: [], payments: [], adjustments: [] });
  const { writes, errors } = await openDocument(page, minimalSale, { minimal: true });
  await expect(page.getByRole("button", { name: "Open & print invoice", exact: true })).toBeVisible();
  const pdf = await openedPdf(page);
  const text = await pdfText(pdf);
  expect(text).toContain("Example Motors");
  expect(text).toContain("15,000.00");
  expect(text).not.toMatch(/Customer name|Vehicle not selected|Contact seller|undefined|null|VAT registration|Company number|Registration  /i);
  expectA4(pdf);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.scrollingElement!.scrollHeight <= innerHeight + 1)).toBe(true);
  expect((await downloadSaved(page)).bytes).toEqual(pdf);
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test("opening and downloading the same invoice returns a one-page A4 archive", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { writes, archives, documents } = await openDocument(page, completeSale);
  const pdf = await openedPdf(page);
  expect(pdf).toEqual(archives.get("invoice"));
  expect(await pdfText(pdf)).toContain("8,850.00");
  expect(await pdfText(pdf)).toContain("INV-TEST-001");
  expect(pdfPageCount(pdf)).toBe(1);
  expectA4(pdf);
  const download = await downloadSaved(page);
  expect(download.filename).toBe("INV-TEST-001.pdf");
  expect(download.bytes).toEqual(pdf);
  await expect(page.locator("body > .sales-print-copy")).toHaveCount(0);
  await switchPaperwork(page, documents.find(document => document.type === "vehicle-details")!);
  expect(await pdfText(await openedPdf(page))).toContain(completeSale.notes);
  expect(writes).toEqual([]);
});

test("dense statement continues on A4 pages and retains every payment, charge and disclosure", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const dense = sale({ price: "50000", exchanges: completeSale.exchanges,
    adjustments: Array.from({ length: 22 }, (_, index) => ({ description: `Agreed service item ${index + 1} with full details for the buyer`, amount: "10", kind: "fee" as const })),
    payments: Array.from({ length: 24 }, (_, index) => ({ amount: "20", method: index % 2 ? "Cash" : "Bank transfer", date: "2026-10-04", reference: `PAYMENT-RECORD-${index + 1}` })),
    notes: Array.from({ length: 15 }, (_, index) => `Agreed collection note ${index + 1}: Full vehicle documentation is reviewed with the customer at handover.`).join("\n") + "\nFINAL-INVOICE-NOTE-END",
  });
  const { writes, errors, archives, documents } = await openDocument(page, dense, { documentType: "statement" });
  const pdf = await openedPdf(page);
  expect(pdf).toEqual(archives.get("statement"));
  const text = await pdfText(pdf);
  for (const value of [
    ...dense.adjustments!.map((_, index) => `Agreed service item ${index + 1}`),
    ...dense.payments!.map(payment => payment.reference),
    "44,990.00",
  ]) expect(text).toContain(value);
  expect(pdfPageCount(pdf)).toBeGreaterThan(1);
  expectA4(pdf);
  await switchPaperwork(page, documents.find(document => document.type === "vehicle-details")!);
  const disclosures = await openedPdf(page);
  expect(await pdfText(disclosures)).toContain("FINAL-INVOICE-NOTE-END");
  expectA4(disclosures);
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test("a price edit that worsens an existing credit cannot save or issue another invoice", async ({ page }) => {
  const { writes, record } = await openDocument(page, sale({ payments: [{ amount: "15001", method: "Cash", date: "2026-10-04", reference: "OVERPAYMENT-TEST" }] }), { open: false });
  const frozenDocuments = structuredClone(record.documents);
  await page.getByRole("button", { name: "Change car", exact: true }).click();
  await page.getByLabel("Agreed vehicle price (£)").fill("14999");
  const popups: string[] = [];
  page.on("popup", popup => popups.push(popup.url()));
  await page.getByRole("button", { name: "Choose customer", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Part exchange, discounts and payments cannot exceed the total due.");
  await expect(page.getByRole("heading", { name: "Choose a car", exact: true })).toBeVisible();
  expect(popups).toEqual([]);
  expect(record.documents).toEqual(frozenDocuments);
  expect(writes).toEqual([]);
});

for (const width of [390, 820, 1440]) test(`receipts remain under saved paperwork at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const draft = sale({ payments: [{ id: "deposit", date: "2026-10-10", amount: "500", method: "Bank transfer", reference: "Deposit payment", status: "confirmed", kind: "deposit" }] });
  const audit = await openDocument(page, draft, { open: false });
  await expect(page.getByRole("button", { name: "Open & print invoice" })).toHaveCount(0);
  await expect(page.getByText("Blank stationery")).toHaveCount(0);
  const receipt = audit.documents.find(document => document.type === "receipt")!;
  await openSavedPaperwork(page, receipt);
  const bytes = await openedPdf(page);
  expect(bytes).toEqual(audit.archives.get(receipt.id));
  const text = await pdfText(bytes);
  for (const value of [receipt.number, "500.00", "14,500.00"]) expect(text).toContain(value);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(audit.writes).toEqual([]);
  expect(audit.errors).toEqual([]);
});

test("issuing a new invoice after viewing a receipt opens the newly saved PDF", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const fixture = await openDocument(page, sale({ payments: [{ amount: "500", method: "Cash", date: "2026-10-10", reference: "PRINT-REGRESSION", status: "confirmed", kind: "deposit" }] }), { documentType: "receipt" });
  const receipt = await openedPdf(page);
  const record = structuredClone(fixture.record);
  const state = await attachGuidedSale(page, record);
  await page.getByRole("button", { name: "All actions", exact: true }).first().click();
  await openInvoiceCompose(page);
  await confirmInvoiceVehicle(page);
  await page.getByRole("checkbox", { name: /checked the customer, vehicle, agreed price/ }).check();
  await page.getByRole("button", { name: "Create & save invoice", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sales invoice", exact: true })).toBeVisible();
  const invoice = state.sale!.documents.at(-1)!;
  expect(invoice.type).toBe("invoice");
  expect(invoice.id).not.toBe("invoice");
  expect(state.commands.map(command => command.action)).toEqual(["issue-invoice"]);
  const bytes = await openedPdf(page);
  expect(bytes).toEqual(archivedPdf(invoice));
  expect(bytes).not.toEqual(receipt);
  await expect(page.locator("body > .sales-print-copy")).toHaveCount(0);
  expect(state.blockedWrites).toEqual([]);
  expect(fixture.writes).toEqual([]);
  expect(fixture.errors).toEqual([]);
});
