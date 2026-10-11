import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
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
  sales = new Map<string, SaleWorkspaceRecord>();
  blockedWrites: string[] = [];
  commands: SaleWorkspaceCommand[] = [];
  archives = new Map<string, Uint8Array>();
  private numbers: Record<string, number> = {};

  current() { return [...this.sales.values()].at(-1)!; }

  context(): SaleWorkspaceContext {
    return {
      now: new Date().toISOString(), actor: "Fixture Staff", branding,
      vehicle: { id: vehicleId, title: "2018 Fixture Touring 1.6", year: 2018, fuel: "Petrol", transmission: "Automatic", mileage: 42000 },
      paperwork: { reservationTerms: "Fictional dealer reservation terms for this isolated test.", saleTerms: "Fictional dealer terms of sale for this isolated test." },
      nextId: () => crypto.randomUUID(),
      nextNumber: type => `${type.toUpperCase()}-TEST-${String(this.numbers[type] = (this.numbers[type] ?? 0) + 1).padStart(4, "0")}`,
    };
  }

  async attach(context: BrowserContext) {
    await context.route("**/api/**", async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path.startsWith("/api/sale-workspace")) return this.handle(route);
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
      let command: SaleWorkspaceCommand;
      if (method === "PUT") command = { action: "update", draft: body.draft };
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

async function editor(page: Page) {
  const edit = page.getByRole("button", { name: "Edit sale", exact: true });
  if (await edit.isVisible()) await edit.click();
}

async function screenshot(page: Page, name: string, width: number) {
  await page.evaluate(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    for (const element of document.querySelectorAll<HTMLElement>(".sales-premium-content, .sales-active-sheet, .sales-deal-overview")) element.scrollTo({ top: 0, left: 0, behavior: "instant" });
  });
  await page.waitForFunction(() => window.scrollY === 0);
  await page.screenshot({ path: `output/ui-premium/practical-sales/${name}-${width}.png`, fullPage: true });
}

async function startDeal(page: Page) {
  await page.goto("/portal?section=sales");
  await page.getByRole("button", { name: "New sale", exact: true }).first().click();
  await page.getByLabel("Customer name", { exact: true }).fill("Alex Practical");
  await page.getByLabel("Telephone", { exact: true }).fill("07000 000123");
  await page.getByLabel("Email", { exact: true }).fill("alex@example.test");
  await page.getByLabel("Address", { exact: true }).fill("10 Fictional Customer Road\nHarrow\nHA1 1AA");
  await page.getByLabel("Vehicle", { exact: true }).selectOption(vehicleId);
  await page.getByLabel("Agreed vehicle price (£)").fill("12000");
}

async function receivedPayment(page: Page, amount: string, method: string) {
  await editor(page);
  await page.getByRole("button", { name: "Record payment", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Money received", { exact: false })).not.toBeChecked();
  await dialog.getByLabel("Payment amount (£)").fill(amount);
  await dialog.getByRole("combobox", { name: /^Payment method/ }).selectOption(method);
  await dialog.getByLabel("Money received", { exact: false }).check();
  await dialog.getByRole("button", { name: "Save & view receipt", exact: true }).click();
  await expect(dialog).toBeHidden();
}

test("three steps preserve pending funds, reserve on confirmed deposit, issue every receipt and complete before handover", async ({ page, context }) => {
  const api = new PracticalSalesApi(); await api.attach(context);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await startDeal(page);
  const steps = page.getByRole("navigation", { name: "Sale sections" });
  await expect(steps.getByRole("button")).toHaveCount(3);
  for (const name of ["Deal details", "Payments", "Completion"]) await expect(steps.getByRole("button", { name: new RegExp(`^${name}`) })).toBeVisible();
  await expect(page.locator(".sales-decision-bar")).toHaveCount(0);

  await page.getByText("Part exchange (optional)", { exact: true }).click();
  await page.getByRole("button", { name: "Add part-exchange car" }).click();
  await page.getByLabel("Registration 1", { exact: true }).fill("CD16 EFG");
  await page.getByLabel("Make and model 1", { exact: true }).fill("2016 Fictional Hatchback");
  await page.getByLabel("Allowance (£) 1", { exact: true }).fill("3000");
  const fees = page.locator("details").filter({ has: page.locator("summary", { hasText: /Fees (?:and|&) discounts/i }) });
  await fees.locator("summary").click();
  await page.getByRole("button", { name: "Add fee or discount" }).click();
  await page.getByLabel("Description adjustment 1").fill("Delivery");
  await page.getByLabel("Amount (£) adjustment 1").fill("100");
  await page.getByRole("button", { name: "Add fee or discount" }).click();
  await page.locator(".sales-entry-group").filter({ has: page.getByLabel("Description adjustment 2") }).getByRole("combobox").selectOption("discount");
  await page.getByLabel("Description adjustment 2").fill("Agreed discount");
  await page.getByLabel("Amount (£) adjustment 2").fill("250");
  await expect(page.locator(".sales-live-paper")).toContainText("£8,850.00");
  await page.getByRole("button", { name: "Continue to payments", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Payments", exact: true, level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "Record payment", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Money received", { exact: false })).not.toBeChecked();
  await dialog.getByLabel("Payment amount (£)").fill("1000");
  await dialog.getByRole("button", { name: "Save pending payment", exact: true }).click();
  await expect.poll(() => api.current()?.payments[0]?.status).toBe("pending");
  expect(saleWorkspaceTotals(api.current().draft, api.current().payments).balance).toBe(885000);
  expect(api.current().documents).toHaveLength(0);
  expect(api.current().lifecycle?.status).not.toBe("reserved");

  await page.getByRole("button", { name: "Confirm received", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Money received", { exact: false }).check();
  await dialog.getByRole("button", { name: "Confirm & view receipt", exact: true }).click();
  await expect.poll(() => api.current()?.lifecycle?.status).toBe("reserved");
  expect(api.current().documents.filter(d => d.type === "receipt")).toHaveLength(1);
  expect(api.current().documents.some(d => d.type === "reservation")).toBe(true);
  const firstReceipt = structuredClone(api.current().documents.find(d => d.type === "receipt")!);
  const firstReceiptBytes = Buffer.from(api.archives.get(firstReceipt.id)!);
  await expect(page.getByRole("heading", { name: "Payments", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByLabel("Document", { exact: true })).toHaveCount(1);
  await receivedPayment(page, "3000", "Cash");
  expect(api.current().documents.filter(d => d.type === "receipt")).toHaveLength(2);
  expect(saleWorkspaceTotals(api.current().draft, api.current().payments).balance).toBe(485000);
  await receivedPayment(page, "4850", "Bank transfer");
  expect(api.current().documents.filter(d => d.type === "receipt")).toHaveLength(3);
  expect(api.current().documents.find(d => d.id === firstReceipt.id)).toEqual(firstReceipt);
  expect(saleWorkspaceTotals(api.current().draft, api.current().payments).balance).toBe(0);
  await expect(page.getByRole("dialog")).toBeHidden();
  await page.getByRole("button", { name: "Review & complete", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Completion", exact: true, level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Complete sale & issue documents", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "Complete sale & issue pack", exact: true }).click();
  await expect.poll(() => api.current()?.lifecycle?.status).toBe("sold");
  expect(api.current().completedAt).toBeTruthy();
  expect(api.current().draft.fulfilment?.completedAt).toBeUndefined();
  expect(api.current().documents.filter(d => d.type === "invoice")).toHaveLength(1);
  expect(api.current().documents.find(d => d.type === "terms")?.content).toBe(api.context().paperwork!.saleTerms);
  expect(api.current().documents.some(d => d.type === "vehicle-details")).toBe(true);
  await page.getByRole("button", { name: "Mark collected", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Received by", { exact: true }).fill("Alex Practical");
  await dialog.getByRole("button", { name: "Confirm handover", exact: true }).click();
  await expect.poll(() => api.current()?.draft.fulfilment?.completedRecipient).toBe("Alex Practical");
  expect(api.current().documents.find(d => d.id === firstReceipt.id)).toEqual(firstReceipt);
  await page.getByLabel("Document", { exact: true }).selectOption(firstReceipt.id);
  await expect(page.locator(".sales-live-paper")).toContainText("£7,850.00");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download saved PDF", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(`${firstReceipt.number}.pdf`);
  expect(await readFile((await file.path())!)).toEqual(firstReceiptBytes);
  await steps.getByRole("button", { name: /^Deal details/ }).click();
  await expect(page.getByLabel("Customer name", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Vehicle", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("Agreed vehicle price (£)")).toBeDisabled();
  expect(api.blockedWrites).toEqual([]);
});

test("a newly received deposit uses the reserving action and creates its own receipt immediately", async ({ page, context }) => {
  const api = new PracticalSalesApi(); await api.attach(context); await startDeal(page);
  await page.getByRole("button", { name: "Continue to payments", exact: true }).click();
  await receivedPayment(page, "500", "Cash");
  expect(api.commands.at(-1)?.action).toBe("take-deposit");
  expect(api.current().lifecycle?.status).toBe("reserved");
  expect(api.current().documents.filter(document => document.type === "receipt")).toHaveLength(1);
  expect(api.current().documents.find(document => document.type === "receipt")?.paymentAmountPence).toBe(50000);
  expect(saleWorkspaceTotals(api.current().draft, api.current().payments).balance).toBe(1150000);
  await expect(page.getByRole("heading", { name: "Payments", exact: true, level: 1 })).toBeVisible();
  await expect(page.locator(".sales-live-paper")).toContainText("£500.00");
  expect(api.blockedWrites).toEqual([]);
});

for (const width of [390, 820, 1440]) {
  test(`practical sales and invoice remain readable without horizontal overflow at ${width}px`, async ({ page, context }) => {
    const api = new PracticalSalesApi(); await api.attach(context);
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width, height: 1000 }); await startDeal(page);
    const preview = page.getByRole("button", { name: "Invoice preview", exact: true });
    if (await preview.isVisible()) await preview.click();
    await expect(page.locator(".sales-live-paper")).toContainText("Alex Practical");
    await expect(page.locator(".sales-live-paper")).toContainText("£12,000.00");
    await expect(page.locator('.sales-pdf-page[data-rendered="true"]').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await mkdir("output/ui-premium/practical-sales", { recursive: true });
    await screenshot(page, "deal", width);
    await editor(page);
    await page.getByRole("button", { name: "Continue to payments", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Payments", exact: true, level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (width === 390) {
      const amounts = await page.locator(".sales-payment-totals dd").evaluateAll(elements =>
        elements.map(element => ({ whiteSpace: getComputedStyle(element).whiteSpace, fits: element.scrollWidth <= element.clientWidth + 1 })),
      );
      expect(amounts).toHaveLength(3);
      for (const amount of amounts) expect(amount).toEqual({ whiteSpace: "nowrap", fits: true });
    }
    await screenshot(page, "payments", width);
    await page.getByRole("button", { name: "Review & complete", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Completion", exact: true, level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await screenshot(page, "completion", width);
    expect(errors).toEqual([]); expect(api.blockedWrites).toEqual([]);
  });
}
