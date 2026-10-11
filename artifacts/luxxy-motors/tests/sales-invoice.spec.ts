import { expect, test, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { archivedPdf, editView, expectA4, optionalPanel, pdfPageCount, pdfText, previewPdf, previewView, saleStep } from "./sales-pdf-fixture";
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
  await page.route("**/api/sale-workspace", (route) =>
    route.fulfill({ json: { sales: [record], preview: true } }),
  );
  await page.goto("/portal?section=sales");
  await page.getByRole("button", { name: new RegExp(draft.customer) }).click();
  await saleStep(page, "Completion");
  await previewView(page);
  if (!preview)
    await page
      .getByLabel("Document", { exact: true })
      .selectOption(documentType);
  await previewView(page);
  await expect(page.locator(".sales-document")).toContainText("Example Motors");
  await previewPdf(page);
  return { writes, errors, documents, archives, record };
}

async function downloadSaved(page: Page) {
  const awaited = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download saved PDF", exact: true }).click();
  const download = await awaited;
  return { bytes: await readFile((await download.path())!), filename: download.suggestedFilename() };
}

test("invoice separates sale price, exchanges and mixed payment records accurately", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { writes, errors, archives } = await openDocument(page, completeSale, { documentType: "statement" });
  const invoice = page.locator(".sales-document");
  await expect(invoice).toContainText("£15,000.00");
  await expect(invoice).toContainText("Delivery to agreed address");
  await expect(invoice).toContainText("-£250.00");
  for (const exchange of completeSale.exchanges!) {
    await expect(invoice).toContainText(exchange.registration);
    await expect(invoice).toContainText(exchange.description);
  }
  for (const payment of completeSale.payments!) {
    await expect(invoice).toContainText(payment.method);
    await expect(invoice).toContainText(payment.reference);
  }
  await expect(invoice).toContainText("2026-10-04");
  await expect(invoice).toContainText("£10,200.00");
  await expect(invoice).toContainText("£1,350.00");
  await expect(invoice).toContainText("£8,850.00");
  const statementPdf = await previewPdf(page);
  expect(statementPdf).toEqual(archives.get("statement"));
  const text = statementPdf.toString("latin1");
  for (const value of ["Example Motors Limited", "TEST012345", "42,000", "Petrol", "Automatic", "4 Oct 2026", "TRANSFER-EXAMPLE-102", "CASH-EXAMPLE-103"]) expect(text).toContain(value);
  expect(text).not.toContain("DRAFT - not issued");
  expect(text).not.toContain("VAT registration");
  await mkdir(output, { recursive: true });
  await invoice.screenshot({ path: `${output}/invoice-desktop.png` });
  await page.getByLabel("Document", { exact: true }).selectOption("receipt");
  await expect(invoice).toContainText("£250.00");
  await expect(invoice).not.toContainText("TRANSFER-EXAMPLE-102");
  await expect(invoice).not.toContainText("CASH-EXAMPLE-103");
  expect(await previewPdf(page)).toEqual(archives.get("receipt"));
  expect(writes).toEqual([]); expect(errors).toEqual([]);
});

test("phone invoice remains readable and omits missing optional details", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const minimalSale = sale({ email: "", phone: "", address: "", registration: "", notes: "", collection: "", exchanges: [], payments: [], adjustments: [] });
  const { writes, errors } = await openDocument(page, minimalSale, { minimal: true });
  const invoice = page.locator(".sales-document");
  await expect(invoice).toContainText("£15,000.00");
  const pdf = await previewPdf(page);
  expect(pdfText(pdf)).toContain("Example Motors");
  expect(pdfText(pdf)).not.toMatch(/Customer name|Vehicle not selected|Contact seller|undefined|null|VAT registration|Company number|Registration  /i);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir(output, { recursive: true });
  await invoice.screenshot({ path: `${output}/invoice-phone.png` });
  const canvas = invoice.locator('canvas[data-rendered="true"]').first();
  expect((await canvas.boundingBox())!.width).toBeGreaterThan(250);
  expect(writes).toEqual([]); expect(errors).toEqual([]);
});

test("normal invoice preview and download are the same one-page A4 archive", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { writes, archives } = await openDocument(page, completeSale);
  const pdf = await previewPdf(page);
  expect(pdf).toEqual(archives.get("invoice"));
  expect(pdf.toString("latin1")).toContain("8,850.00");
  expect(pdf.toString("latin1")).toContain("Sales invoice INV-TEST-001");
  expect(pdfPageCount(pdf)).toBe(1); expectA4(pdf);
  const download = await downloadSaved(page);
  expect(download.filename).toBe("INV-TEST-001.pdf");
  expect(download.bytes).toEqual(pdf);
  const opened = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Print document", exact: true }).click();
  const popup = await opened;
  await expect.poll(() => popup.url()).toMatch(/^blob:/);
  const openedBytes = await page.evaluate(async url => [...new Uint8Array(await (await fetch(url)).arrayBuffer())], popup.url());
  expect(Buffer.from(openedBytes)).toEqual(pdf);
  await popup.close();
  await expect(page.locator("body > .sales-print-copy")).toHaveCount(0);
  await expect(page.locator(".sales-pdf-document input, .sales-pdf-document textarea, .sales-pdf-document select, .sales-pdf-document button")).toHaveCount(0);
  await page.getByLabel("Document", { exact: true }).selectOption("vehicle-details");
  expect((await previewPdf(page)).toString("latin1")).toContain(completeSale.notes);
  await mkdir(output, { recursive: true }); await writeFile(`${output}/invoice-a4.pdf`, pdf);
  expect(writes).toEqual([]);
});

test("dense statement continues on A4 pages and retains every payment, charge and disclosure", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const dense = sale({ price: "50000", exchanges: completeSale.exchanges,
    adjustments: Array.from({ length: 22 }, (_, index) => ({ description: `Agreed service item ${index + 1} with full details for the buyer`, amount: "10", kind: "fee" as const })),
    payments: Array.from({ length: 24 }, (_, index) => ({ amount: "20", method: index % 2 ? "Cash" : "Bank transfer", date: "2026-10-04", reference: `PAYMENT-RECORD-${index + 1}` })),
    notes: Array.from({ length: 15 }, (_, index) => `Agreed collection note ${index + 1}: Full vehicle documentation is reviewed with the customer at handover.`).join("\n") + "\nFINAL-INVOICE-NOTE-END",
  });
  const { writes, errors, archives } = await openDocument(page, dense, { documentType: "statement" });
  const pdf = await previewPdf(page);
  expect(pdf).toEqual(archives.get("statement"));
  for (const value of ["Agreed service item 22", "PAYMENT-RECORD-24", "44,990.00"]) expect(pdf.toString("latin1")).toContain(value);
  expect(pdfPageCount(pdf)).toBeGreaterThan(1); expectA4(pdf);
  await expect(page.locator('canvas[data-rendered="true"]')).toHaveCount(pdfPageCount(pdf));
  await page.getByLabel("Document", { exact: true }).selectOption("vehicle-details");
  const disclosures = await previewPdf(page);
  expect(disclosures.toString("latin1")).toContain("FINAL-INVOICE-NOTE-END");
  expectA4(disclosures);
  await mkdir(output, { recursive: true }); await writeFile(`${output}/invoice-dense-a4.pdf`, pdf);
  expect(writes).toEqual([]); expect(errors).toEqual([]);
});

test("an edit that worsens an existing credit cannot print a draft invoice", async ({ page }) => {
  const { writes } = await openDocument(page, sale({ payments: [{ amount: "15001", method: "Cash", date: "2026-10-04", reference: "OVERPAYMENT-TEST" }] }), { preview: true });
  await editView(page); await saleStep(page, "Deal details");
  await page.getByLabel("Agreed vehicle price (£)").fill("14999");
  await previewView(page);
  const popups: string[] = []; page.on("popup", popup => popups.push(popup.url()));
  await page.getByRole("button", { name: "Print draft", exact: true }).click();
  await editView(page);
  await expect(page.getByRole("alert")).toContainText("Part exchange, discounts and payments cannot exceed the total due.");
  expect(popups).toEqual([]);
  await expect(page.locator(".sales-print-copy")).toHaveCount(0);
  expect(writes).toEqual([]);
});

for (const width of [390, 820, 1440]) test(`classic receipt and blank stationery remain secondary choices at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const draft = sale({ payments: [{ id: "deposit", date: "2026-10-10", amount: "500", method: "Bank transfer", reference: "Deposit payment", status: "confirmed", kind: "deposit" }] });
  const audit = await openDocument(page, draft);
  await page.getByLabel("Document", { exact: true }).selectOption("receipt");
  await editView(page); await optionalPanel(page, "Other documents & receipt styles");
  await page.getByLabel("Receipt print style").selectOption("classic");
  await previewView(page);
  const receipt = page.locator(".sales-document-workbench .receipt-book");
  await expect(receipt).toContainText("RCP-TEST-001");
  await expect(receipt).toContainText("£500.00");
  await expect(receipt).toContainText("£14,500.00");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir("output/ui-premium/classic-receipt", { recursive: true });
  await receipt.screenshot({ path: `output/ui-premium/classic-receipt/filled-${width}.png` });
  if (width === 1440) {
    await page.evaluate(() => { window.print = () => {}; });
    await page.getByRole("button", { name: "Print document", exact: true }).click();
    await page.emulateMedia({ media: "print" });
    await expect(page.locator("body > .sales-print-copy")).toBeVisible();
    await expect(page.locator("body > .sales-print-copy")).toContainText("£500.00");
    const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
    expect(pdfPageCount(pdf)).toBe(1);
    await mkdir("../../output/pdf", { recursive: true }); await writeFile("../../output/pdf/classic-receipt-website-example.pdf", pdf);
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint"))); await page.emulateMedia({ media: "screen" });
  }
  await editView(page); await page.getByLabel("Receipt print style").selectOption("blank"); await previewView(page);
  await expect(receipt).not.toContainText(draft.customer);
  await expect(receipt).not.toContainText("RCP-TEST-001");
  await expect(receipt).not.toContainText("£500.00");
  await expect(receipt).toContainText("Blank stationery");
  expect(audit.writes).toEqual([]); expect(audit.errors).toEqual([]);
});


test("issuing an invoice after choosing classic receipt restores the standard PDF print path", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const fixture = await openDocument(page, sale({ payments: [{ amount: "500", method: "Cash", date: "2026-10-10", reference: "CLASSIC-PRINT-REGRESSION", status: "confirmed", kind: "deposit" }] }));
  await page.getByLabel("Document", { exact: true }).selectOption("receipt");
  await optionalPanel(page, "Other documents & receipt styles");
  await page.getByLabel("Receipt print style").selectOption("classic");
  await expect(page.locator(".sales-document-workbench .receipt-book")).toBeVisible();
  const invoice = { ...structuredClone(fixture.documents.find(document => document.type === "invoice")!), id: "invoice-revised", number: "INV-TEST-002", version: 2 };
  const bytes = archivedPdf(invoice); fixture.archives.set(invoice.id, bytes);
  const mutations: string[] = [];
  await page.route(`**/api/sale-workspace/${fixture.record.id}/documents`, route => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON().type).toBe("invoice");
    mutations.push(new URL(route.request().url()).pathname);
    return route.fulfill({ json: { sale: { ...fixture.record, revision: 2, documents: [...fixture.documents, invoice] }, document: invoice, preview: true } });
  });
  await page.getByRole("button", { name: "Issue another invoice copy", exact: true }).click();
  await expect(page.getByLabel("Receipt print style")).toHaveValue("modern");
  expect(await previewPdf(page)).toEqual(bytes);
  await expect(page.locator(".sales-document-workbench .receipt-book")).toHaveCount(0);
  await page.evaluate(() => {
    (window as typeof window & { stationeryPrintCalls: number }).stationeryPrintCalls = 0;
    window.print = () => { (window as typeof window & { stationeryPrintCalls: number }).stationeryPrintCalls++; };
  });
  const opened = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Print document", exact: true }).click();
  const popup = await opened; await expect.poll(() => popup.url()).toMatch(/^blob:/);
  const printBytes = await page.evaluate(async url => [...new Uint8Array(await (await fetch(url)).arrayBuffer())], popup.url());
  expect(Buffer.from(printBytes)).toEqual(bytes);
  expect(await page.evaluate(() => (window as typeof window & { stationeryPrintCalls: number }).stationeryPrintCalls)).toBe(0);
  await expect(page.locator("body > .sales-print-copy")).toHaveCount(0);
  await popup.close();
  expect(mutations).toEqual([`/api/sale-workspace/${fixture.record.id}/documents`]);
  expect(fixture.writes).toEqual([]); expect(fixture.errors).toEqual([]);
});
