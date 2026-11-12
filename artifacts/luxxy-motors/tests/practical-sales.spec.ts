import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  changeSaleWorkspace,
  createSaleWorkspace,
  publicSaleWorkspace,
  SaleWorkspaceError,
  saleWorkspaceTotals,
  type SaleWorkspaceBranding,
  type SaleWorkspaceCommand,
  type SaleWorkspaceContext,
  type SaleWorkspaceRecord,
} from "../../../lib/vehicle-meta/src/sale-workspace";
import { confirmInvoiceVehicle, fixtureInvoiceVehicleReview } from "./sales-pdf-fixture";
import { saleDocumentPdfBytes } from "../../../lib/vehicle-meta/src/sale-document-pdf";

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== "1", "Fictional sales only; all writes are intercepted.");

const vehicleId = "11111111-1111-4111-8111-111111111111";
const branding: SaleWorkspaceBranding = {
  identity: { name: "Practical Motors", logoText: "PRACTICAL MOTORS", logoAsset: "" },
  contact: { phone: "020 0000 0123", email: "sales@example.test" },
  address: { street: "25 Fictional Road", city: "Harrow", region: "London", postcode: "HA2 2BB" },
  legal: { companyName: "Practical Motors Limited", companyNumber: "TEST123", vatNumber: "" },
  presentation: { linkColour: "#215a7e" },
};

/** HTTP fixture backed by the application's real reducer. No live sale or dealership is mutated. */
class PracticalSalesApi {
  reservationTerms = "Fictional dealer reservation terms for this isolated test.";
  sales = new Map<string, SaleWorkspaceRecord>();
  blockedWrites: string[] = [];
  commands: SaleWorkspaceCommand[] = [];
  archives = new Map<string, Uint8Array>();
  private numbers: Record<string, number> = {};

  current() { return [...this.sales.values()].at(-1)!; }

  context(): SaleWorkspaceContext {
    return {
      now: new Date().toISOString(), actor: "Fixture Staff", actorId: "fixture-invoice-staff", branding,
      vehicle: { id: vehicleId, title: "2018 Fixture Touring 1.6", year: 2018, fuel: "Petrol", transmission: "Automatic", mileage: 42000 },
      paperwork: { reservationTerms: this.reservationTerms, saleTerms: "Fictional dealer terms of sale for this isolated test." },
      nextId: () => crypto.randomUUID(),
      nextNumber: type => `${type.toUpperCase()}-TEST-${String(this.numbers[type] = (this.numbers[type] ?? 0) + 1).padStart(4, "0")}`,
    };
  }

  async attach(context: BrowserContext) {
    await context.route("**/api/**", async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path.startsWith("/api/sale-workspace")) return this.handle(route);
      if (/^\/api\/sale-operations\/[^/]+\/calculation-check$/.test(path) && request.method() === "POST") {
        return route.fulfill({ json: { status: "unavailable", message: "Optional calculation check disabled in the fixture." } });
      }
      if (path === "/api/dealer-settings" && request.method() === "GET") {
        const response = await route.fetch();
        const settings = await response.json();
        return route.fulfill({ response, json: {
          ...settings, ...branding,
          contact: { ...settings.contact, ...branding.contact },
          address: { ...settings.address, ...branding.address },
          legal: { ...settings.legal, ...branding.legal },
          presentation: { ...settings.presentation, ...branding.presentation },
        } });
      }
      if (path === "/api/portal/session") return route.fulfill({ json: { state: "allowed", name: "Fixture Staff", email: "staff@example.test" } });
      if (path === "/api/enquiries") return route.fulfill({ json: [] });
      if (path === "/api/reservations") return route.fulfill({ json: { reservations: [] } });
      if (path === "/api/stock") return route.fulfill({ json: {
        schemaVersion: 1, count: 1, dealerName: branding.identity.name,
        cars: [{ id: vehicleId, advertId: "FICTIONAL-ADVERTISEMENT", make: "Fixture", model: "Touring", year: 2018,
          title: "2018 Fixture Touring 1.6", price: 12000, currency: "GBP", mileage: 42000,
          registration: "2018 (18 reg)", registrationBand: "18", plate: "AB18 XYZ", vrm: "AB18 XYZ", vrmVerified: true,
          fuel: "Petrol", transmission: "Automatic", heroImage: null, images: [], inventoryStatus: this.current()?.lifecycle?.status ?? "available" }],
      } });
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
        this.blockedWrites.push(`${request.method()} ${path}`);
        return route.fulfill({ status: 403, json: { error: "Real dealership writes are blocked by this test." } });
      }
      return route.continue();
    });
  }

  private async handle(route: Route) {
    const request = route.request();
    const method = request.method();
    const segments = new URL(request.url()).pathname.split("/").filter(Boolean).slice(2);
    const body = method === "GET" ? {} : request.postDataJSON();
    try {
      if (method === "GET") {
        if (segments[0] === "paperwork") return route.fulfill({ json: { saleTerms: this.context().paperwork!.saleTerms, reservationTerms: this.context().paperwork!.reservationTerms } });
        if (segments[1] === "documents" && segments[3] === "pdf") {
          const bytes = this.archives.get(segments[2]);
          return bytes ? route.fulfill({ contentType: "application/pdf", body: Buffer.from(bytes) }) : route.fulfill({ status: 404, json: { error: "Fictional archive not found." } });
        }
        return route.fulfill({ json: segments.length ? { sale: publicSaleWorkspace(this.sales.get(segments[0])!), preview: true } : { sales: [...this.sales.values()].map(publicSaleWorkspace), preview: true } });
      }
      if (!segments.length && method === "POST") {
        const result = createSaleWorkspace(body, this.context(), `SALE-TEST-${this.sales.size + 1}`);
        this.sales.set(result.sale.id, result.sale);
        return route.fulfill({ status: 201, json: { ...result, sale: publicSaleWorkspace(result.sale), preview: true } });
      }
      const [id, section, target, action] = segments;
      const saved = this.sales.get(id);
      if (!saved) return route.fulfill({ status: 404, json: { error: "Fictional sale not found." } });
      if (section === "invoice-vehicle-review") {
        expect(body.expectedRevision).toBe(saved.revision);
        const context = this.context();
        const review = fixtureInvoiceVehicleReview(saved, context.now);
        saved.invoiceVehicleReview = { review, revision: saved.revision, actorId: context.actorId!, stockIdentity: "" };
        return route.fulfill({ json: { review } });
      }
      let command: SaleWorkspaceCommand;
      if (method === "PUT") command = { action: "update", draft: body.draft };
      else if (section === "invoice-payments") command = { action: "invoice-payment", payment: body.payment };
      else if (section === "issue-invoice") command = { action: "issue-invoice", kind: body.kind, acknowledge: body.acknowledge, vehicleReview: body.vehicleReview };
      else if (section === "payments" && !target) command = { action: "payment", payment: body.payment };
      else if (section === "payments" && action === "confirm") command = { action: "confirm", paymentId: target, date: body.date, reserveVehicle: body.reserveVehicle === true };
      else if (section === "take-deposit") command = { action: "take-deposit", payment: body.payment };
      else if (section === "complete-sale") command = { action: "complete-sale", acknowledge: body.acknowledge };
      else if (section === "handover") command = { action: "handover", recipient: body.recipient, acknowledgeOutstanding: body.acknowledgeOutstanding };
      else if (section === "documents") command = { action: "document", type: body.type };
      else return route.fulfill({ status: 400, json: { error: `Unimplemented fictional request: ${section}` } });
      this.commands.push(command);
      const result = changeSaleWorkspace(saved, command, { expectedRevision: body.expectedRevision, requestId: body.requestId }, this.context());
      this.sales.set(id, result.sale);
      for (const document of result.sale.documents) if (!this.archives.has(document.id)) this.archives.set(document.id, saleDocumentPdfBytes(document));
      return route.fulfill({ json: { ...result, sale: publicSaleWorkspace(result.sale), preview: true } });
    } catch (error) {
      return route.fulfill({ status: error instanceof SaleWorkspaceError ? error.status : 500, json: { error: error instanceof Error ? error.message : "Fictional request failed." } });
    }
  }
}

const actions = (page: Page) => page.locator(".sales-flow-menu");
const menu = (page: Page) => page.getByRole("button", { name: "All actions", exact: true }).first().click();
const choice = (page: Page, name: RegExp) => actions(page).getByRole("button", { name }).click();

async function startDeal(page: Page) {
  await page.goto("/portal?section=sales", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "New sale", exact: true }).first().click();
  await page.getByRole("button", { name: /Choose Fixture Touring/ }).click();
  await expect(page.getByLabel("Agreed vehicle price (£)", { exact: true })).toHaveValue("12000");
  await page.getByRole("button", { name: "Choose customer", exact: true }).click();
  await page.getByLabel("Customer’s full name", { exact: true }).fill("Alex Practical");
  await page.getByLabel("Telephone", { exact: true }).fill("07000 000123");
  await page.getByLabel("Email for the invoice", { exact: true }).fill("alex@example.test");
  await page.getByLabel("Customer address", { exact: true }).fill("10 Fictional Road, Harrow, HA1 1AA");
  await saveAndOpenActions(page);
}

async function saveAndOpenActions(page: Page) {
  await page.locator(".sale-desk-section-actions, .sales-flow-mobile-action").getByRole("button", { name: "Choose what to do", exact: true }).click();
  await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeVisible();
}

async function receivedPayment(page: Page, amount: string, method: string, deposit = false) {
  await choice(page, deposit ? /Take a deposit/ : /Take a payment/);
  await page.getByRole("textbox", { name: /Payment amount/ }).fill(amount);
  await page.getByRole("combobox", { name: /^Payment method/ }).selectOption(method);
  const confirm = page.getByRole("checkbox", { name: /checked that this money has been received/ });
  const save = page.getByRole("button", { name: new RegExp(`^Save £.+ ${deposit ? "deposit" : "payment"}$`) });
  await expect(save).toBeDisabled();
  await confirm.check();
  await save.click();
  if (deposit) {
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(/remove.+available stock/i);
    await dialog.getByRole("button", { name: /Confirm £.+ & reserve car/ }).click();
    await expect(page.getByRole("heading", { name: "Let the customer know" })).toBeVisible();
  } else {
    await expect(page.getByText(/payment recorded\./).first()).toBeVisible();
  }
}

async function issueFullInvoice(page: Page) {
  await choice(page, /Create an invoice/);
  await confirmInvoiceVehicle(page);
  await page.getByRole("checkbox", { name: /checked the customer, vehicle, agreed price/ }).check();
  await page.getByRole("button", { name: "Create & save invoice", exact: true }).click();
  await expect(page.getByRole("button", { name: "Download PDF", exact: true })).toBeVisible();
}

test("guided sale records a deposit and later payments and preserves the original receipt", async ({ page, context }) => {
  const api = new PracticalSalesApi(); await api.attach(context);
  await startDeal(page);
  const steps = page.getByRole("navigation", { name: "Sale steps" });
  for (const name of ["Car", "Customer", "Choose what to do"]) await expect(steps.getByRole("button", { name, exact: true })).toBeVisible();
  await receivedPayment(page, "1000", "Bank transfer", true);
  const firstReceipt = structuredClone(api.current().documents.find(doc => doc.type === "receipt")!);
  const firstReceiptBytes = Buffer.from(api.archives.get(firstReceipt.id)!);
  await page.getByRole("button", { name: "Back to sale", exact: true }).click();
  await receivedPayment(page, "3000", "Cash");
  await menu(page);
  await receivedPayment(page, "8000", "Bank transfer");
  expect(saleWorkspaceTotals(api.current().draft, api.current().payments).balance).toBe(0);
  await menu(page);
  await issueFullInvoice(page);
  const invoice = api.current().documents.find(doc => doc.type === "invoice")!;
  expect(invoice.snapshot.totals.confirmedPaid).toBe(1200000);
  expect(api.current().documents.find(doc => doc.id === firstReceipt.id)).toEqual(firstReceipt);
  expect(api.current().lifecycle?.status).toBe("reserved");
  await menu(page);
  await page.getByRole("button", { name: "Payments and documents", exact: true }).click();
  const receiptRow = page.locator(".sale-desk-document-list > div").filter({ hasText: firstReceipt.number });
  await receiptRow.getByRole("button", { name: "View & share" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(`${firstReceipt.number}.pdf`);
  expect(await readFile((await file.path())!)).toEqual(firstReceiptBytes);
  expect(api.blockedWrites).toEqual([]);
});

for (const terms of ["configured", "absent"] as const) {
  test(`recording a deposit reserves stock and saves a receipt with reservation terms ${terms}`, async ({ page, context }) => {
    const api = new PracticalSalesApi();
    if (terms === "absent") api.reservationTerms = "";
    await api.attach(context); await startDeal(page);
    await receivedPayment(page, "500", "Cash", true);
    expect(api.commands.at(-1)?.action).toBe("invoice-payment");
    expect(api.current().lifecycle?.status).toBe("reserved");
    const receipts = api.current().documents.filter(document => document.type === "receipt");
    expect(receipts).toHaveLength(1);
    expect(receipts[0].paymentAmountPence).toBe(50000);
    expect(saleWorkspaceTotals(api.current().draft, api.current().payments).balance).toBe(1150000);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download receipt", exact: true }).click();
    expect(await readFile((await (await download).path())!)).toEqual(Buffer.from(api.archives.get(receipts[0].id)!));
    expect(api.blockedWrites).toEqual([]);
  });
}

test("editing the customer never generates a PDF until staff ask for the saved copy", async ({ page, context }) => {
  const api = new PracticalSalesApi(); await api.attach(context); await startDeal(page);
  let pdfRequests = 0;
  page.on("request", request => { if (/\/documents\/[^/]+\/pdf$/.test(request.url())) pdfRequests++; });
  await page.getByRole("button", { name: "Back to customer", exact: true }).click();
  const customer = page.getByLabel("Customer’s full name", { exact: true });
  await customer.fill(""); await customer.pressSequentially("Jordan Blake", { delay: 25 });
  await saveAndOpenActions(page);
  expect(api.current().documents).toHaveLength(0);
  expect(pdfRequests).toBe(0);
  await issueFullInvoice(page);
  expect(api.current().documents.at(-1)?.snapshot.draft.customer).toBe("Jordan Blake");
  expect(pdfRequests).toBe(0);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  expect((await download).suggestedFilename()).toBe(`${api.current().documents.at(-1)!.number}.pdf`);
  expect(pdfRequests).toBe(1);
  expect(api.blockedWrites).toEqual([]);
});

for (const width of [390, 820, 1440]) {
  test(`the guided breakdown and issued invoice fit at ${width}px`, async ({ page, context }) => {
    const api = new PracticalSalesApi(); await api.attach(context);
    const partExchangeLookups: unknown[] = [];
    await page.route("**/api/staff/part-exchange/check", async route => {
      partExchangeLookups.push(route.request().postDataJSON());
      await route.fulfill({ json: {
        registration: "CD16EFG",
        dvla: {
          status: "available",
          details: {
            registration: "CD16EFG", checkedAt: "2026-11-11T15:00:00Z",
            make: "FORD", colour: "BLUE", fuelType: "PETROL",
            yearOfManufacture: 2016, engineCapacity: 1242, taxStatus: "SORN",
          },
        },
        dvsa: {
          status: "available",
          estimate: null,
          history: {
            registration: "CD16EFG", checkedAt: "2026-11-11T15:00:00Z",
            make: "FORD", model: "FIESTA", recall: "Unknown",
            tests: [{
              completedDate: "2026-08-17T10:00:00Z", result: "PASSED",
              expiryDate: "2027-08-16", mileage: "62450", mileageUnit: "MI",
              defects: [],
            }],
          },
        },
      } });
    });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 }); await startDeal(page);
    await page.getByRole("button", { name: "Extras or part exchange", exact: true }).click();
    await page.getByRole("button", { name: "Add part exchange", exact: true }).click();
    await page.getByLabel("Part-exchange registration", { exact: true }).fill("CD16 EFG");
    await page.getByLabel("Vehicle description", { exact: true }).fill("Fictional part-exchange vehicle");
    await page.getByLabel("Allowance (£)", { exact: true }).fill("1000.10");
    expect(partExchangeLookups).toHaveLength(0);
    await page.getByRole("button", { name: "Check part exchange", exact: true }).click();
    const partExchange = page.getByRole("region", { name: "Part-exchange result", exact: true });
    await expect(partExchange).toContainText(/62,450/);
    await expect(partExchange).toContainText("SORN");
    expect(partExchangeLookups).toHaveLength(1);
    expect(partExchangeLookups[0]).toMatchObject({ registration: "CD16EFG" });
    await expect(page.getByLabel("Part-exchange registration", { exact: true })).toHaveValue("CD16 EFG");
    await expect(page.getByLabel("Vehicle description", { exact: true })).toHaveValue("Fictional part-exchange vehicle");
    await expect(page.getByLabel("Allowance (£)", { exact: true })).toHaveValue("1000.10");
    const screenshots = process.env.PART_EXCHANGE_SCREENSHOTS;
    if (screenshots && width !== 820) {
      await mkdir(screenshots, { recursive: true });
      await page.mouse.move(0, 0);
      await page.locator(".invoice-adjustment-row").filter({ has: partExchange }).screenshot({
        path: join(screenshots, `sales-${width === 390 ? "phone" : "desktop"}.png`),
      });
    }
    await page.getByRole("button", { name: "Add fee or discount", exact: true }).click();
    await page.getByLabel("Description", { exact: true }).fill("Agreed extra");
    await page.getByLabel("Amount (£)", { exact: true }).fill("100.10");
    await page.getByRole("button", { name: "Save details", exact: true }).click();
    await expect.poll(() => saleWorkspaceTotals(api.current().draft, api.current().payments).balance).toBe(1110000);
    if (width === 390) {
      const balance = page.getByRole("button", { name: /Left to pay.*£11,100.00/ });
      await expect(balance).toBeInViewport();
      await balance.click();
      await expect(page.getByRole("region", { name: "Payment breakdown" })).toContainText("£11,100.00");
      await page.keyboard.press("Escape");
      await expect(balance).toHaveAttribute("aria-expanded", "false");
    } else {
      await expect(page.locator("[aria-label='Sale amounts']")).toContainText("£11,100.00");
    }
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
    expect(await fits()).toBe(true);
    await menu(page);
    await issueFullInvoice(page);
    expect(await fits()).toBe(true);
    expect(api.current().documents.at(-1)?.snapshot.totals.totalDue).toBe(1110000);
    expect(api.blockedWrites).toEqual([]);
    expect(errors).toEqual([]);
  });
}
