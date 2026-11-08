import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Route,
} from "@playwright/test";
import { readFile } from "node:fs/promises";
import { archivedPdf } from "./sales-pdf-fixture";
import {
  changeSaleWorkspace,
  createSaleWorkspace,
  publicSaleWorkspace,
  SaleWorkspaceError,
  saleWorkspaceTotals,
  type SaleWorkspaceBranding,
  type SaleWorkspaceCommand,
  type SaleWorkspaceContext,
  type SaleWorkspaceDraft,
  type SaleWorkspaceRecord,
} from "../../../lib/vehicle-meta/src/sale-workspace";

test.skip(
  process.env.LUXXY_LOCAL_PREVIEW !== "1",
  "Isolated local preview with all sale writes intercepted.",
);

const vehicleId = "11111111-1111-4111-8111-111111111111";
const branding: SaleWorkspaceBranding = {
  identity: {
    name: "Fixture Motors",
    logoText: "FIXTURE MOTORS",
    logoAsset: "",
  },
  contact: { phone: "020 0000 0123", email: "sales@example.test" },
  address: {
    street: "25 Fixture Road",
    city: "Harrow",
    region: "London",
    postcode: "HA2 2BB",
  },
  legal: {
    companyName: "Fixture Motors Limited",
    companyNumber: "FIXTURE123",
    vatNumber: "",
  },
  presentation: { linkColour: "#215a7e" },
};

function draft(
  overrides: Partial<SaleWorkspaceDraft> = {},
): SaleWorkspaceDraft {
  return {
    id: "",
    customer: "Alex Lifecycle",
    email: "alex@example.test",
    phone: "07000 000123",
    address: "10 Customer Road\nHarrow\nHA1 1AA",
    vehicleId,
    vehicle: "2018 Fixture Touring 1.6",
    registration: "AB18 XYZ",
    price: "12000",
    partExchange: false,
    pxRegistration: "",
    pxDescription: "",
    pxValue: "",
    deposit: "",
    paymentMethod: "Bank transfer",
    notes: "",
    collection: "",
    preparation: false,
    documents: false,
    handover: false,
    exchanges: [],
    adjustments: [],
    payments: [],
    fulfilment: {
      method: "collection",
      viewed: "not-yet-viewed",
      address: "",
      recipient: "",
      phone: "",
      scheduledDate: "",
      timeWindow: "",
      instructions: "",
    },
    ...overrides,
  };
}

/** This is an isolated HTTP adapter to the real pure sale reducer, not a second implementation of money rules. */
class FixtureSalesApi {
  sales = new Map<string, SaleWorkspaceRecord>();
  blockedWrites: string[] = [];
  calls: Array<{
    method: string;
    path: string;
    body: Record<string, unknown>;
  }> = [];
  loseNextPaymentResponse = false;
  archives = new Map<string, Buffer>();
  now = new Date().toISOString();
  private ids = 0;
  private numbers: Record<string, number> = {};

  context(): SaleWorkspaceContext {
    return {
      now: this.now,
      actor: "Fixture Staff",
      branding,
      paperwork: { saleTerms: "Fictional sale terms for isolated lifecycle tests.", reservationTerms: "Fictional reservation terms for isolated lifecycle tests." },
      vehicle: {
        id: vehicleId,
        title: "2018 Fixture Touring 1.6",
        year: 2018,
        fuel: "Petrol",
        transmission: "Automatic",
        mileage: 42000,
      },
      nextId: () => `fixture-${++this.ids}`,
      nextNumber: (type) =>
        `${type.toUpperCase()}-${String((this.numbers[type] = (this.numbers[type] ?? 0) + 1)).padStart(4, "0")}`,
    };
  }

  seed(value = draft()) {
    const sale = createSaleWorkspace(
      { draft: value, requestId: `fixture-create-${this.ids + 1}` },
      this.context(),
      `SALE-${this.sales.size + 1}`,
    ).sale;
    this.sales.set(sale.id, sale);
    return sale;
  }

  change(id: string, command: SaleWorkspaceCommand) {
    const current = this.sales.get(id)!;
    const result = changeSaleWorkspace(
      current,
      command,
      {
        expectedRevision: current.revision,
        requestId: `fixture-command-${this.ids + 1}`,
      },
      this.context(),
    );
    this.sales.set(id, result.sale);
    this.archive(result.sale);
    return result;
  }

  private archive(sale: SaleWorkspaceRecord) {
    for (const document of sale.documents) if (!this.archives.has(document.id)) this.archives.set(document.id, archivedPdf(document));
  }

  current() {
    return [...this.sales.values()].at(-1)!;
  }

  async attach(context: BrowserContext) {
    await context.route("**/api/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const method = request.method();
      if (path.startsWith("/api/sale-workspace")) return this.handle(route);
      if (/^\/api\/sale-operations\/[^/]+\/calculation-check$/.test(path))
        return route.fulfill({ json: { status: "unavailable", message: "AI check unavailable in this fixture." } });
      if (path === "/api/portal/session")
        return route.fulfill({
          json: {
            state: "allowed",
            name: "Fixture Staff",
            email: "staff@example.test",
          },
        });
      if (path === "/api/enquiries") return route.fulfill({ json: [] });
      if (path === "/api/stock")
        return route.fulfill({
          json: {
            schemaVersion: 1,
            count: 1,
            dealerName: "Fixture Motors",
            cars: [
              {
                id: vehicleId,
                advertId: "FIXTURE-ADVERTISEMENT",
                make: "Fixture",
                model: "Touring",
                year: 2018,
                title: "2018 Fixture Touring 1.6",
                price: 12000,
                currency: "GBP",
                mileage: 42000,
                registration: "2018 (18 reg)",
                registrationBand: "18",
                plate: "AB18 XYZ",
                vrm: "AB18 XYZ",
                vrmVerified: true,
                fuel: "Petrol",
                transmission: "Automatic",
                heroImage: null,
                images: [],
              },
            ],
          },
        });
      if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
        this.blockedWrites.push(`${method} ${path}`);
        return route.fulfill({
          status: 403,
          json: { error: "This test blocks real dealership mutations." },
        });
      }
      return route.continue();
    });
  }

  private async handle(route: Route) {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const segments = path.split("/").filter(Boolean).slice(2);
    const method = request.method();
    const body = method === "GET" ? {} : request.postDataJSON();
    this.calls.push({ method, path, body });
    try {
      if (method === "GET") {
        if (segments[0] === "paperwork") return route.fulfill({ json: this.context().paperwork });
        if (segments[1] === "documents" && segments[3] === "pdf") {
          const bytes = this.archives.get(segments[2]);
          return bytes ? route.fulfill({ contentType: "application/pdf", body: bytes }) : route.fulfill({ status: 404, json: { error: "Fixture archive not found." } });
        }
        const result = segments.length
          ? {
              sale: publicSaleWorkspace(this.sales.get(segments[0])!),
              preview: true,
            }
          : {
              sales: [...this.sales.values()].map(publicSaleWorkspace),
              preview: true,
            };
        return route.fulfill({ json: result });
      }
      if (!segments.length && method === "POST") {
        const result = createSaleWorkspace(
          body,
          this.context(),
          `SALE-${this.sales.size + 1}`,
        );
        this.sales.set(result.sale.id, result.sale);
        return route.fulfill({
          status: 201,
          json: {
            ...result,
            sale: publicSaleWorkspace(result.sale),
            preview: true,
          },
        });
      }
      const [id, section, target, action] = segments;
      const current = this.sales.get(id);
      if (!current)
        return route.fulfill({
          status: 404,
          json: { error: "Sale not found." },
        });
      let command: SaleWorkspaceCommand;
      if (method === "PUT") command = { action: "update", draft: body.draft };
      else if (section === "payments" && !target)
        command = { action: "payment", payment: body.payment };
      else if (section === "payments" && action === "confirm")
        command = { action: "confirm", paymentId: target, date: body.date, reserveVehicle: body.reserveVehicle === true, reserveConfirmed: body.reserveConfirmed === true, acceptShortfall: body.acceptShortfall === true };
      else if (section === "payments" && action === "reverse")
        command = {
          action: "reverse",
          paymentId: target,
          reason: body.reason,
          date: body.date,
          ...(body.amount !== undefined ? { amount: body.amount } : {}),
          ...(body.kind ? { kind: body.kind } : {}),
          ...(body.method ? { method: body.method } : {}),
          invoiceOnly: body.invoiceOnly === true,
        };
      else if (section === "take-deposit") command = { action: "take-deposit", payment: body.payment };
      else if (section === "invoice-payments") command = { action: "invoice-payment", payment: body.payment };
      else if (section === "issue-invoice") command = { action: "issue-invoice", kind: body.kind, acknowledge: body.acknowledge };
      else if (section === "finish-invoice-sale") command = { action: "finish-invoice-sale", acknowledge: body.acknowledge, acknowledgeOutstanding: body.acknowledgeOutstanding };
      else if (section === "fulfilment") command = { action: "fulfilment", fulfilment: body.fulfilment };
      else if (section === "complete-sale") command = { action: "complete-sale", acknowledge: body.acknowledge };
      else if (section === "documents")
        command = { action: "document", type: body.type };
      else if (section === "handover")
        command = {
          action: "handover",
          recipient: body.recipient,
          ...(body.acknowledgeOutstanding
            ? { acknowledgeOutstanding: true }
            : {}),
        };
      else
        return route.fulfill({
          status: 400,
          json: { error: "Unknown fixture request." },
        });
      const result = changeSaleWorkspace(
        current,
        command,
        { expectedRevision: body.expectedRevision, requestId: body.requestId },
        this.context(),
      );
      this.sales.set(id, result.sale);
      this.archive(result.sale);
      if ((section === "payments" || section === "take-deposit" || section === "invoice-payments") && !target && this.loseNextPaymentResponse) {
        this.loseNextPaymentResponse = false;
        return route.fulfill({
          status: 503,
          json: {
            error:
              "The fixture committed the payment, then lost its response. Retry safely.",
          },
        });
      }
      return route.fulfill({
        json: {
          ...result,
          sale: publicSaleWorkspace(result.sale),
          preview: true,
        },
      });
    } catch (error) {
      return route.fulfill({
        status: error instanceof SaleWorkspaceError ? error.status : 500,
        json: { error: error instanceof Error ? error.message : String(error) },
      });
    }
  }
}

const customerName = "Customer’s full name";

async function openSale(page: Page, customer = "Alex Lifecycle") {
  await page.goto("/portal?section=sales");
  await page.getByRole("button", { name: new RegExp(customer) }).click();
  await expect(page.getByRole("heading", { name: "What would you like to do?" })).toBeVisible();
  await expect(page.locator(".sales-flow-context")).toContainText(customer);
}

async function menu(page: Page) {
  if (await page.getByRole("heading", { name: "What would you like to do?" }).isVisible()) return;
  await page.getByRole("navigation", { name: "Sale steps" }).getByRole("button", { name: "Choose what to do" }).click();
}

async function action(page: Page, label: string) {
  await menu(page);
  await page.getByLabel("Choose what to do").getByRole("button", { name: new RegExp(`^${label}`) }).click();
}

async function history(page: Page) {
  await menu(page);
  await page.getByRole("button", { name: "Payments and documents", exact: true }).click();
}

async function startSale(page: Page) {
  await page.goto("/portal?section=sales");
  await page.getByRole("button", { name: "New sale", exact: true }).click();
  const search = page.getByRole("searchbox", { name: "Search stock vehicles" });
  await search.fill("AB18 XYZ");
  await expect(page.getByLabel("Vehicle selection")).toContainText("Touring");
  await search.press("Enter");
  await page.getByRole("button", { name: "Choose customer", exact: true }).click();
}

async function preparePayment(page: Page, amount: string, kind: "deposit" | "part-payment" | "final-payment", method: string) {
  await action(page, kind === "deposit" ? "Take a deposit" : "Take a payment");
  const form = page.locator(".invoice-payment-form");
  await form.getByRole("textbox", { name: /^Payment amount/ }).fill(amount);
  await form.getByRole("combobox", { name: "Payment method", exact: true }).selectOption(method);
  await form.getByLabel("Date received", { exact: true }).fill("2026-10-04");
  const type = form.getByRole("combobox", { name: "Payment type", exact: true });
  if (kind !== "deposit" && await type.isVisible()) await type.selectOption(kind);
  await form.getByLabel("Payment reference (optional)", { exact: true }).fill(`FIXTURE-${kind}`);
  await form.getByRole("checkbox", { name: /checked that this money has been received/ }).check();
  await form.getByRole("button", { name: /^Save £/ }).click();
}

async function recordPayment(page: Page, api: FixtureSalesApi, amount: string, kind: "deposit" | "part-payment" | "final-payment", method = "Bank transfer") {
  const count = api.current().payments.length;
  await preparePayment(page, amount, kind, method);
  if (kind === "deposit") await page.getByRole("dialog").getByRole("button", { name: /Record deposit.*reserve|Confirm.*reserve/i }).click();
  await expect.poll(() => api.current().payments.length).toBe(count + 1);
  await expect(page.getByRole("button", { name: /^Save £/ })).toHaveCount(0);
}

async function issueInvoice(page: Page) {
  await action(page, "Create an invoice");
  await page.getByRole("checkbox", { name: /checked the customer, vehicle/ }).check();
  await page.getByRole("button", { name: "Create & save invoice" }).click();
  await expect(page.getByRole("heading", { name: "Sales invoice", exact: true })).toBeVisible();
}

async function documentBytes(page: Page, documentNumber: string) {
  await history(page);
  await page.locator(".sale-desk-document-list > div").filter({ hasText: documentNumber })
    .getByRole("button", { name: "View & share" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  return readFile((await (await download).path())!);
}

async function deliveryForm(page: Page) {
  await action(page, "Arrange collection or delivery");
  await page.getByRole("button", { name: "Edit arrangements", exact: true }).click();
  await page.getByRole("button", { name: "Deliver to customer", exact: true }).click();
}

const seededPayment = (kind: "deposit" | "part-payment", status: "confirmed" | "pending") => ({
  action: "payment" as const,
  payment: { amount: "500", method: "Cash", date: "2026-10-04", reference: "FIXTURE-PAYMENT", kind, status },
});

test("deposit receipt stays printable while all later payments appear in the full invoice", async ({ page, context }) => {
  const api = new FixtureSalesApi(); api.seed(); await api.attach(context); await openSale(page);
  await recordPayment(page, api, "500", "deposit", "Debit card");
  const original = structuredClone(api.current().documents.find(doc => doc.type === "receipt")!);
  expect(original.balanceAtIssue).toBe(1_150_000);
  expect(await documentBytes(page, original.number)).toEqual(api.archives.get(original.id));
  await recordPayment(page, api, "2000", "part-payment", "Cash");
  await recordPayment(page, api, "9500", "final-payment");
  expect(api.current().payments.map(row => row.method)).toEqual(["Debit card", "Cash", "Bank transfer"]);
  expect(saleWorkspaceTotals(api.current().draft, api.current().payments).balance).toBe(0);
  await issueInvoice(page);
  expect(api.current().documents.at(-1)?.snapshot.payments).toHaveLength(3);
  expect(api.current().documents[0]).toEqual(original);
  expect(await documentBytes(page, original.number)).toEqual(api.archives.get(original.id));
  expect(api.blockedWrites).toEqual([]);
});

test("a saved pending payment leaves the balance unchanged until confirmed", async ({ page, context }) => {
  const api = new FixtureSalesApi(); const sale = api.seed();
  api.change(sale.id, seededPayment("deposit", "pending"));
  await api.attach(context); await openSale(page); await history(page);
  expect(api.current().documents).toHaveLength(0);
  expect(saleWorkspaceTotals(api.current().draft, api.current().payments).balance).toBe(1_200_000);
  await page.getByRole("button", { name: "Confirm received", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox", { name: /has arrived/ }).check();
  await dialog.getByRole("button", { name: "Confirm deposit & reserve car" }).click();
  await expect(dialog).toBeHidden();
  expect(api.current().payments[0].status).toBe("confirmed");
  expect(api.current().documents.find(doc => doc.type === "receipt")?.balanceAtIssue).toBe(1_150_000);
  expect(api.blockedWrites).toEqual([]);
});

test("a new sale reopens on a second device and rejects a stale edit", async ({ page, context, browser, baseURL }) => {
  const api = new FixtureSalesApi(); await api.attach(context);
  const disableUuid = () => Object.defineProperty(crypto, "randomUUID", { configurable: true, value: undefined });
  await context.addInitScript(disableUuid);
  await startSale(page);
  await page.getByLabel(customerName, { exact: true }).fill("Shared Buyer");
  await page.getByLabel("Telephone", { exact: true }).fill("07000 000999");
  await page.getByRole("button", { name: "Choose what to do", exact: true }).last().click();
  await expect.poll(() => api.sales.size).toBe(1);
  const secondContext = await browser.newContext({ baseURL });
  try {
    await api.attach(secondContext);
    await secondContext.addInitScript(disableUuid);
    const secondPage = await secondContext.newPage();
    await openSale(secondPage, "Shared Buyer");
    await recordPayment(secondPage, api, "500", "deposit", "Cash");
    await page.getByRole("navigation", { name: "Sale steps" }).getByRole("button", { name: "Customer", exact: true }).click();
    await page.getByLabel(customerName, { exact: true }).fill("Stale edit");
    await page.getByRole("button", { name: "Save details", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: /another device|reload/i })).toBeVisible();
    expect(api.current().draft.customer).toBe("Shared Buyer");
    expect(api.current().payments).toHaveLength(1);
    expect(api.calls.filter(call => call.method !== "GET").every(call => typeof call.body.requestId === "string" && call.body.requestId.length >= 8)).toBe(true);
    await expect(page.getByLabel(customerName, { exact: true })).toHaveValue("Stale edit");
    expect(api.blockedWrites).toEqual([]);
  } finally { await secondContext.close(); }
});

test("a saved simulated reservation keeps the contact details without crediting its deposit", async ({ page, context }) => {
  const api = new FixtureSalesApi();
  api.seed(draft({
    customer: "Reservation Buyer", email: "reservation@example.test", phone: "07000 000456",
    sourceReservationId: "reservation-fixture", customerSource: "Simulated reservation", deposit: "500",
  }));
  await api.attach(context); await openSale(page, "Reservation Buyer");
  await expect(page.getByLabel("Payment breakdown")).toContainText("£12,000.00");
  expect(api.current().draft.sourceReservationId).toBe("reservation-fixture");
  expect(api.current().payments).toEqual([]);
  expect(api.current().documents).toEqual([]);
  expect(saleWorkspaceTotals(api.current().draft, api.current().payments).confirmedPaid).toBe(0);
  expect(api.blockedWrites).toEqual([]);
});

for (const viewed of [false, true]) {
  test(`delivery can be arranged and recorded when the customer ${viewed ? "has" : "has not"} viewed the car`, async ({ page, context }) => {
    const api = new FixtureSalesApi();
    const initial = draft();
    initial.fulfilment!.viewed = viewed ? "viewed" : "not-yet-viewed";
    api.seed(initial); await api.attach(context); await openSale(page);
    await deliveryForm(page);
    await page.getByRole("textbox", { name: "Delivery address", exact: true }).fill("17 Delivery Road\nHarrow\nHA3 3CC");
    await page.getByLabel("Planned date", { exact: true }).fill("2026-10-12");
    await page.getByLabel("Arrival window", { exact: true }).fill("10:00–12:00");
    await page.getByRole("textbox", { name: "Staff delivery notes", exact: true }).fill("Call on arrival.");
    await page.getByRole("button", { name: "Save arrangements", exact: true }).click();
    await expect.poll(() => api.current().draft.fulfilment?.method).toBe("delivery");
    expect(api.current().draft.fulfilment?.viewed).toBe(initial.fulfilment!.viewed);
    expect(api.current().draft.handover).toBe(false);
    expect(saleWorkspaceTotals(api.current().draft, api.current().payments).balance).toBe(1_200_000);
    await recordPayment(page, api, "12000", "final-payment");
    await issueInvoice(page);
    await page.getByRole("button", { name: /mark sold & remove/i }).click();
    await expect.poll(() => api.current().completedAt).toBeTruthy();
    await action(page, "Arrange collection or delivery");
    await page.getByRole("button", { name: "Mark delivered", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm handover", exact: true }).click();
    await expect.poll(() => api.current().draft.handover).toBe(true);
    expect(api.current().draft.fulfilment?.completedRecipient).toBe("Alex Lifecycle");
    expect(api.current().documents.at(-1)?.title).toBe("Delivery confirmation");
    expect(api.blockedWrites).toEqual([]);
  });
}

test("a partial refund and correction preserve the original receipt and adjust only the ledger", async ({ page, context }) => {
  const api = new FixtureSalesApi(); const sale = api.seed();
  const original = api.change(sale.id, seededPayment("deposit", "confirmed"));
  const originalReceipt = structuredClone(original.document!);
  await api.attach(context); await openSale(page); await history(page);
  const originalRow = page.locator(".invoice-payment-list > div").filter({ hasText: "FIXTURE-PAYMENT" }).first();
  await originalRow.getByRole("button", { name: "Correct a payment", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Refund / correction amount (£)").fill("100");
  await dialog.getByLabel("Reason", { exact: true }).fill("Agreed partial refund recorded by staff.");
  await dialog.getByRole("checkbox", { name: /money has already been refunded/ }).check();
  await dialog.getByRole("button", { name: "Save adjustment" }).click();
  await expect(dialog).toBeHidden();
  expect(api.current().payments[1].signedAmountPence).toBe(-10000);
  expect(api.current().payments[1].reversesPaymentId).toBe(original.sale.payments[0].id);
  expect(api.current().documents[0]).toEqual(originalReceipt);
  expect(saleWorkspaceTotals(api.current().draft, api.current().payments).balance).toBe(1_160_000);
  await originalRow.getByRole("button", { name: "Correct a payment", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Action", exact: true }).selectOption("reversal");
  await dialog.getByLabel("Reason", { exact: true }).fill("Original cash entry was incorrect; remaining amount reversed.");
  await dialog.getByRole("button", { name: "Save adjustment" }).click();
  await expect(dialog).toBeHidden();
  expect(api.current().payments[2].signedAmountPence).toBe(-40000);
  expect(saleWorkspaceTotals(api.current().draft, api.current().payments).confirmedPaid).toBe(0);
  expect(api.current().documents).toEqual([originalReceipt]);
  expect(api.current().events.some(event => event.type === "payment-corrected")).toBe(true);
  expect(await documentBytes(page, originalReceipt.number)).toEqual(api.archives.get(originalReceipt.id));
  expect(api.blockedWrites).toEqual([]);
});

test("retrying a deposit after a lost response creates one payment and one receipt", async ({ page, context }) => {
  const api = new FixtureSalesApi(); api.seed(); api.loseNextPaymentResponse = true;
  await api.attach(context); await openSale(page);
  await preparePayment(page, "500", "deposit", "Bank transfer");
  const dialog = page.getByRole("dialog");
  const confirm = dialog.getByRole("button", { name: /Record deposit.*reserve|Confirm.*reserve/i });
  await confirm.click();
  await expect(page.getByRole("alert").filter({ hasText: /lost its response|retry/i }).first()).toBeVisible();
  expect(api.current().payments).toHaveLength(1);
  await confirm.click();
  await expect(dialog).toBeHidden();
  expect(api.current().payments).toHaveLength(1);
  expect(api.current().documents.filter(document => document.type === "receipt")).toHaveLength(1);
  const calls = api.calls.filter(call => call.path.endsWith("/invoice-payments"));
  expect(calls).toHaveLength(2);
  expect(calls[0].body.requestId).toBe(calls[1].body.requestId);
  expect(api.blockedWrites).toEqual([]);
});

test("an amended invoice and balance statement preserve the original issued copy", async ({ page, context }) => {
  const api = new FixtureSalesApi(); const sale = api.seed();
  const original = api.change(sale.id, { action: "issue-invoice", kind: "full", acknowledge: true }).document!;
  await api.attach(context); await openSale(page);
  await page.getByRole("navigation", { name: "Sale steps" }).getByRole("button", { name: "Car", exact: true }).click();
  await page.getByLabel("Agreed vehicle price (£)", { exact: true }).fill("12100");
  await page.getByRole("button", { name: "Save details", exact: true }).click();
  await expect.poll(() => api.current().draft.price).toBe("12100");
  await openSale(page);
  await issueInvoice(page);
  expect(api.current().documents[1].version).toBe(2);
  expect(api.current().documents[1].snapshot.totals.totalDue).toBe(1_210_000);
  await recordPayment(page, api, "500", "deposit", "Cash");
  const statement = api.change(sale.id, { action: "document", type: "statement" }).document!;
  expect(statement.balanceAtIssue).toBe(1_160_000);
  await openSale(page);
  expect(await documentBytes(page, statement.number)).toEqual(api.archives.get(statement.id));
  expect(await documentBytes(page, original.number)).toEqual(api.archives.get(original.id));
  expect(api.current().documents[0].snapshot.totals.totalDue).toBe(1_200_000);
  expect(api.blockedWrites).toEqual([]);
});

test("cancelling a saved pending payment keeps its history without a receipt or balance credit", async ({ page, context }) => {
  const api = new FixtureSalesApi(); const sale = api.seed();
  api.change(sale.id, seededPayment("deposit", "pending"));
  await api.attach(context); await openSale(page); await history(page);
  await page.getByRole("button", { name: "Cancel pending payment", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Reason", { exact: true }).fill("Customer will pay by card instead.");
  await dialog.getByRole("button", { name: "Cancel payment entry", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".invoice-payment-list [data-status=cancelled]")).toBeVisible();
  expect(api.current().payments).toHaveLength(1);
  expect(api.current().payments[0].status).toBe("cancelled");
  expect(api.current().documents).toEqual([]);
  expect(saleWorkspaceTotals(api.current().draft, api.current().payments).balance).toBe(1_200_000);
  expect(api.blockedWrites).toEqual([]);
});

test("collection arrangements cannot bypass sale completion or credit unpaid funds", async ({ page, context }) => {
  const api = new FixtureSalesApi(); api.seed(); await api.attach(context); await openSale(page);
  await action(page, "Arrange collection or delivery");
  await expect(page.getByText(/Record handover after the sale is completed/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Mark collected", exact: true })).toHaveCount(0);
  expect(api.current().draft.handover).toBe(false);
  expect(api.current().completedAt).toBeUndefined();
  expect(api.current().documents).toEqual([]);
  expect(saleWorkspaceTotals(api.current().draft, api.current().payments).balance).toBe(1_200_000);
  expect(api.blockedWrites).toEqual([]);
});

for (const width of [390, 820]) {
  test(`payment and delivery controls fit at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 1000 });
    const api = new FixtureSalesApi(); api.seed(); await api.attach(context); await openSale(page);
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    await action(page, "Take a payment");
    await expect(page.getByRole("textbox", { name: /^Payment amount/ })).toBeVisible();
    expect(await fits()).toBe(true);
    await deliveryForm(page);
    await expect(page.getByRole("textbox", { name: "Delivery address", exact: true })).toBeVisible();
    expect(await fits()).toBe(true);
    expect(api.blockedWrites).toEqual([]);
  });
}
