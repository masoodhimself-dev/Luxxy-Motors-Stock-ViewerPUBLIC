import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Route,
} from "@playwright/test";
import { mkdir } from "node:fs/promises";
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
const output = "output/ui-premium/sales-lifecycle";
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
  reservations: unknown[] = [];
  loseNextPaymentResponse = false;
  now = "2026-10-04T10:00:00.000Z";
  private ids = 0;
  private numbers: Record<string, number> = {};

  context(): SaleWorkspaceContext {
    return {
      now: this.now,
      actor: "Fixture Staff",
      branding,
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
    return result;
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
      if (path === "/api/portal/session")
        return route.fulfill({
          json: {
            state: "allowed",
            name: "Fixture Staff",
            email: "staff@example.test",
          },
        });
      if (path === "/api/enquiries") return route.fulfill({ json: [] });
      if (path === "/api/reservations")
        return route.fulfill({ json: { reservations: this.reservations } });
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
        command = { action: "confirm", paymentId: target, date: body.date };
      else if (section === "payments" && action === "reverse")
        command = {
          action: "reverse",
          paymentId: target,
          reason: body.reason,
          date: body.date,
          ...(body.amount !== undefined ? { amount: body.amount } : {}),
          ...(body.kind ? { kind: body.kind } : {}),
        };
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
      if (section === "payments" && !target && this.loseNextPaymentResponse) {
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

async function openSale(page: Page, customer = "Alex Lifecycle") {
  await page.goto("/portal?section=sales");
  await page.getByRole("button", { name: new RegExp(customer) }).click();
  await expect(page.getByLabel("Customer name", { exact: true })).toHaveValue(
    customer,
  );
}

async function resetCapturePosition(page: Page) {
  await page.evaluate(async () => {
    // Let the workspace's focus/scroll callback finish before capturing the whole document.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  });
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
}

async function payment(
  page: Page,
  amount: string,
  kind: string,
  method = "Bank transfer",
  received = true,
) {
  await page
    .locator(".sales-quick-actions")
    .getByRole("button", { name: "Record payment", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Payment amount (£)", { exact: true }).fill(amount);
  await dialog
    .getByRole("combobox", { name: "Payment method", exact: true })
    .selectOption(method);
  await dialog.getByLabel("Payment date", { exact: true }).fill("2026-10-04");
  await dialog
    .getByLabel("Payment reference", { exact: true })
    .fill(`FIXTURE-${kind}`);
  await dialog
    .getByRole("combobox", { name: "Payment type", exact: true })
    .selectOption(kind);
  await dialog
    .getByRole("checkbox", { name: /^Money received/ })
    .setChecked(received);
  await dialog
    .getByRole("button", {
      name: received ? "Save & view receipt" : "Save pending payment",
      exact: true,
    })
    .click();
  await expect(dialog).toBeHidden();
}

test("deposit, part payment and final payment each retain their own printable receipt", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const api = new FixtureSalesApi();
  const sale = api.seed();
  await api.attach(context);
  await openSale(page);
  await payment(page, "500", "deposit", "Card");
  const original = structuredClone(api.current().documents[0]);
  const document = page.locator(".sales-document");
  await expect(document).toContainText("Deposit receipt");
  await expect(document).toContainText(original.number);
  await expect(document).toContainText("£500.00");
  await expect(document).toContainText("£11,500.00");
  await mkdir(output, { recursive: true });
  await page.evaluate(() => {
    window.print = () => {};
  });
  await page
    .getByRole("button", { name: "Print / Save PDF", exact: true })
    .click();
  await page.emulateMedia({ media: "print" });
  await page
    .locator("body > .sales-print-copy")
    .screenshot({ path: `${output}/deposit-receipt-1440.png` });
  await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
  await page.emulateMedia({ media: "screen" });
  await payment(page, "2000", "part-payment", "Cash");
  await payment(page, "9500", "final-payment", "Bank transfer");
  expect(
    saleWorkspaceTotals(api.current().draft, api.current().payments).balance,
  ).toBe(0);
  expect(api.current().payments.map((row) => row.method)).toEqual([
    "Card",
    "Cash",
    "Bank transfer",
  ]);
  expect(api.current().documents).toHaveLength(3);
  expect(api.current().documents[0]).toEqual(original);
  await page
    .getByRole("button", { name: "Payments & receipts", exact: true })
    .click();
  await resetCapturePosition(page);
  await page.screenshot({
    path: `${output}/payments-1440.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Receipts & documents", exact: true })
    .click();
  await page.getByRole("button", { name: new RegExp(original.number) }).click();
  await expect(document).toContainText("£11,500.00");
  await expect(document).not.toContainText("FIXTURE-final-payment");
  await page.evaluate(() => {
    window.print = () => {};
  });
  await page
    .getByRole("button", { name: "Print / Save PDF", exact: true })
    .click();
  await page.emulateMedia({ media: "print" });
  const print = page.locator("body > .sales-print-copy");
  await expect(print).toContainText(original.number);
  await expect(print).toContainText("£11,500.00");
  await expect(print.locator("input, textarea, select, button")).toHaveCount(0);
  expect(api.sales.get(sale.id)?.documents[0]).toEqual(original);
  expect(api.blockedWrites).toEqual([]);
});

test("pending payment leaves the balance unchanged until staff confirm receipt of money", async ({
  page,
  context,
}) => {
  const api = new FixtureSalesApi();
  api.seed();
  await api.attach(context);
  await openSale(page);
  await payment(page, "500", "deposit", "Bank transfer", false);
  expect(api.current().documents).toHaveLength(0);
  expect(
    saleWorkspaceTotals(api.current().draft, api.current().payments).balance,
  ).toBe(1_200_000);
  await page
    .getByRole("button", { name: "Payments & receipts", exact: true })
    .click();
  await expect(page.getByText("Pending", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Confirm received", exact: true })
    .click();
  const confirm = page.getByRole("dialog");
  await confirm.getByRole("checkbox", { name: /^Money received/ }).check();
  await confirm
    .getByRole("button", { name: "Confirm & view receipt", exact: true })
    .click();
  await expect(confirm).toBeHidden();
  expect(api.current().payments[0].status).toBe("confirmed");
  expect(api.current().documents).toHaveLength(1);
  await expect(page.locator(".sales-document")).toContainText("£11,500.00");
  expect(api.blockedWrites).toEqual([]);
});

test("sale created by staff reopens on a second device and a stale edit cannot overwrite its payment", async ({
  page,
  context,
  browser,
}) => {
  const api = new FixtureSalesApi();
  await api.attach(context);
  // Plain HTTP on an iPad's LAN IP may expose getRandomValues but no randomUUID.
  await context.addInitScript(() =>
    Object.defineProperty(crypto, "randomUUID", {
      configurable: true,
      value: undefined,
    }),
  );
  await page.goto("/portal?section=sales");
  await page.getByRole("button", { name: "New sale", exact: true }).click();
  await page.getByLabel("Customer name", { exact: true }).fill("Shared Buyer");
  await page.getByLabel("Telephone", { exact: true }).fill("07000 000999");
  await page.getByRole("button", { name: "Vehicle", exact: true }).click();
  await page.getByLabel("Vehicle", { exact: true }).selectOption(vehicleId);
  await page
    .getByLabel("Agreed vehicle price (£)", { exact: true })
    .fill("12000");
  await page
    .locator(".sales-titlebar-actions")
    .getByRole("button", { name: "Save sale", exact: true })
    .click();
  await expect.poll(() => api.sales.size).toBe(1);
  const secondContext = await browser.newContext({
    baseURL: "http://127.0.0.1:4175",
  });
  try {
    await api.attach(secondContext);
    await secondContext.addInitScript(() =>
      Object.defineProperty(crypto, "randomUUID", {
        configurable: true,
        value: undefined,
      }),
    );
    const secondPage = await secondContext.newPage();
    await openSale(secondPage, "Shared Buyer");
    await payment(secondPage, "500", "deposit", "Cash");
    await page.getByRole("button", { name: "Customer", exact: true }).click();
    await page.getByLabel("Customer name", { exact: true }).fill("Stale edit");
    await page
      .locator(".sales-titlebar-actions")
      .getByRole("button", { name: "Save sale", exact: true })
      .click();
    await expect(page.locator(".sales-conflict-banner")).toContainText(
      /newer version|reload/i,
    );
    expect(api.current().draft.customer).toBe("Shared Buyer");
    expect(api.current().payments).toHaveLength(1);
    expect(
      api.calls
        .filter((call) => call.method !== "GET")
        .every(
          (call) =>
            typeof call.body.requestId === "string" &&
            call.body.requestId.length >= 8,
        ),
    ).toBe(true);
    await expect(page.getByLabel("Customer name", { exact: true })).toHaveValue(
      "Stale edit",
    );
    expect(api.blockedWrites).toEqual([]);
  } finally {
    await secondContext.close();
  }
});

test("simulated reservation imports customer details without crediting a deposit", async ({
  page,
  context,
}) => {
  const api = new FixtureSalesApi();
  api.reservations = [
    {
      id: "reservation-fixture",
      reference: "RES-FIXTURE",
      customerName: "Reservation Buyer",
      email: "reservation@example.test",
      phone: "07000 000456",
      createdAt: "2026-10-04T09:00:00.000Z",
      depositPence: 50000,
      amountReceivedPence: 0,
      paymentStatus: "simulated",
      vehicleId,
    },
  ];
  await api.attach(context);
  await page.goto("/portal?section=sales");
  await page.getByRole("button", { name: "New sale", exact: true }).click();
  await page
    .getByText("Use a recent enquiry or reservation", { exact: true })
    .click();
  await page.getByRole("button", { name: /Reservation Buyer/ }).click();
  await expect(page.getByLabel("Customer name", { exact: true })).toHaveValue(
    "Reservation Buyer",
  );
  await page.getByRole("button", { name: "Vehicle", exact: true }).click();
  await page.getByLabel("Vehicle", { exact: true }).selectOption(vehicleId);
  await page
    .locator(".sales-titlebar-actions")
    .getByRole("button", { name: "Save sale", exact: true })
    .click();
  await expect.poll(() => api.sales.size).toBe(1);
  expect(api.current().payments).toEqual([]);
  expect(api.current().documents).toEqual([]);
  expect(
    saleWorkspaceTotals(api.current().draft, api.current().payments)
      .confirmedPaid,
  ).toBe(0);
  expect(api.blockedWrites).toEqual([]);
});

for (const viewed of [false, true]) {
  test(`delivery remains available for a customer who ${viewed ? "has" : "has not"} viewed the car`, async ({
    page,
    context,
  }) => {
    const api = new FixtureSalesApi();
    api.seed();
    await api.attach(context);
    await openSale(page);
    await page
      .getByRole("button", { name: "Delivery & handover", exact: true })
      .click();
    await page.getByRole("button", { name: "Delivery", exact: true }).click();
    await page
      .getByRole("checkbox", { name: /^Customer has viewed the car/ })
      .setChecked(viewed);
    await page
      .getByLabel("Delivery address", { exact: true })
      .fill("17 Delivery Road\nHarrow\nHA3 3CC");
    await page.getByLabel("Planned date", { exact: true }).fill("2026-10-12");
    await page.getByLabel("Time window", { exact: true }).fill("10:00–12:00");
    await page.getByLabel("Recipient", { exact: true }).fill("Alex Lifecycle");
    await page
      .getByLabel("Handover contact", { exact: true })
      .fill("07000 000123");
    await page
      .getByLabel("Delivery instructions", { exact: true })
      .fill("Call on arrival.");
    await page
      .locator(".sales-titlebar-actions")
      .getByRole("button", { name: "Save sale", exact: true })
      .click();
    await expect
      .poll(() => api.current().draft.fulfilment?.method)
      .toBe("delivery");
    expect(api.current().draft.fulfilment?.viewed).toBe(
      viewed ? "viewed" : "not-yet-viewed",
    );
    expect(api.current().draft.handover).toBe(false);
    expect(
      saleWorkspaceTotals(api.current().draft, api.current().payments).balance,
    ).toBe(1_200_000);
    await payment(page, "12000", "final-payment", "Bank transfer");
    await page
      .getByRole("button", { name: "Delivery & handover", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Mark delivered", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm handover", exact: true })
      .click();
    await expect.poll(() => api.current().draft.handover).toBe(true);
    expect(api.current().draft.fulfilment?.completedRecipient).toBe(
      "Alex Lifecycle",
    );
    expect(api.current().documents.at(-1)?.title).toBe("Delivery confirmation");
    expect(api.blockedWrites).toEqual([]);
  });
}

test("partial refund and correction retain original receipt and explain the balance change", async ({
  page,
  context,
}) => {
  const api = new FixtureSalesApi();
  const sale = api.seed();
  const original = api.change(sale.id, {
    action: "payment",
    payment: {
      amount: "500",
      method: "Cash",
      date: "2026-10-04",
      reference: "CASH-FIXTURE",
      kind: "deposit",
      status: "confirmed",
    },
  });
  const originalReceipt = structuredClone(original.document!);
  await api.attach(context);
  await openSale(page);
  await page
    .getByRole("button", { name: "Payments & receipts", exact: true })
    .click();
  const originalRow = page.getByTestId(
    `payment-${original.sale.payments[0].id}`,
  );
  await originalRow
    .getByRole("button", { name: "Refund / correct", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Refund / correction amount (£)", { exact: true })
    .fill("100");
  await dialog
    .getByLabel("Reason", { exact: true })
    .fill("Agreed partial refund recorded by staff.");
  await dialog
    .getByRole("button", { name: "Save adjustment", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  expect(api.current().payments).toHaveLength(2);
  expect(api.current().payments[1].signedAmountPence).toBe(-10000);
  expect(api.current().payments[1].reversesPaymentId).toBe(
    original.sale.payments[0].id,
  );
  expect(api.current().documents[0]).toEqual(originalReceipt);
  await expect(page.locator(".sales-document")).toContainText("Refund receipt");
  await expect(page.locator(".sales-document")).toContainText("£11,600.00");
  await page
    .getByRole("button", { name: "Payments & receipts", exact: true })
    .click();
  await originalRow
    .getByRole("button", { name: "Refund / correct", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: "Action", exact: true })
    .selectOption("reversal");
  await dialog
    .getByLabel("Reason", { exact: true })
    .fill("Original cash entry was incorrect; remaining amount reversed.");
  await dialog
    .getByRole("button", { name: "Save adjustment", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  expect(api.current().payments[2].signedAmountPence).toBe(-40000);
  expect(
    saleWorkspaceTotals(api.current().draft, api.current().payments)
      .confirmedPaid,
  ).toBe(0);
  expect(api.current().documents[0]).toEqual(originalReceipt);
  expect(
    api.current().events.some((event) => event.type === "payment-corrected"),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Payments & receipts", exact: true })
    .click();
  await expect(
    originalRow.getByRole("button", { name: "Refund / correct", exact: true }),
  ).toHaveCount(0);
  await originalRow
    .getByRole("button", { name: "View receipt", exact: true })
    .click();
  await expect(page.locator(".sales-document")).toContainText(
    originalReceipt.number,
  );
  await expect(page.locator(".sales-document")).toContainText("£11,500.00");
  expect(api.blockedWrites).toEqual([]);
});

test("a safely retried payment with a lost response creates one payment and one receipt", async ({
  page,
  context,
}) => {
  const api = new FixtureSalesApi();
  api.seed();
  await api.attach(context);
  await openSale(page);
  api.loseNextPaymentResponse = true;
  await page
    .locator(".sales-quick-actions")
    .getByRole("button", { name: "Record payment", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Payment amount (£)", { exact: true }).fill("500");
  await dialog.getByRole("checkbox", { name: /^Money received/ }).check();
  await dialog
    .getByRole("button", { name: "Save & view receipt", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    /lost its response|retry/i,
  );
  expect(api.current().payments).toHaveLength(1);
  const original = structuredClone(api.current().documents[0]);
  await dialog
    .getByRole("button", { name: "Save & view receipt", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  expect(api.current().payments).toHaveLength(1);
  expect(api.current().documents).toHaveLength(1);
  expect(api.current().documents[0]).toEqual(original);
  const calls = api.calls.filter((call) => call.path.endsWith("/payments"));
  expect(calls).toHaveLength(2);
  expect(calls[0].body.requestId).toBe(calls[1].body.requestId);
  expect(api.blockedWrites).toEqual([]);
});

test("an amended invoice and current balance statement preserve the original issued invoice", async ({
  page,
  context,
}) => {
  const api = new FixtureSalesApi();
  const sale = api.seed();
  const issued = api.change(sale.id, {
    action: "document",
    type: "invoice",
  }).document!;
  const original = structuredClone(issued);
  await api.attach(context);
  await openSale(page);
  await page.getByRole("button", { name: "Vehicle", exact: true }).click();
  await page
    .getByLabel("Agreed vehicle price (£)", { exact: true })
    .fill("12100");
  await page.getByRole("button", { name: "Documents", exact: true }).click();
  await page
    .getByRole("button", { name: "Issue sales invoice", exact: true })
    .click();
  await expect.poll(() => api.current().documents.length).toBe(2);
  expect(api.current().documents[1].version).toBe(2);
  expect(api.current().documents[1].snapshot.totals.totalDue).toBe(1_210_000);
  expect(api.current().documents[0]).toEqual(original);
  await expect(page.locator(".sales-document")).toContainText("£12,100.00");
  await payment(page, "500", "deposit", "Cash");
  await page
    .getByRole("button", { name: "Create balance statement", exact: true })
    .click();
  await expect(page.locator(".sales-document")).toContainText(
    "Balance statement",
  );
  await expect(page.locator(".sales-document")).toContainText("£11,600.00");
  await page.getByRole("button", { name: new RegExp(original.number) }).click();
  await expect(page.locator(".sales-document")).toContainText("£12,000.00");
  await expect(page.locator(".sales-document")).not.toContainText(
    "FIXTURE-deposit",
  );
  expect(api.current().documents[0]).toEqual(original);
  expect(api.blockedWrites).toEqual([]);
});

test("cancelling a pending payment keeps its history without a receipt or balance credit", async ({
  page,
  context,
}) => {
  const api = new FixtureSalesApi();
  const sale = api.seed();
  api.change(sale.id, {
    action: "payment",
    payment: {
      amount: "500",
      method: "Bank transfer",
      date: "2026-10-04",
      reference: "PENDING-CANCEL",
      kind: "deposit",
      status: "pending",
    },
  });
  await api.attach(context);
  await openSale(page);
  await page
    .getByRole("button", { name: "Payments & receipts", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Cancel pending", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Reason", { exact: true })
    .fill("Customer will pay by card instead.");
  await dialog
    .getByRole("button", { name: "Cancel payment entry", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  expect(api.current().payments).toHaveLength(1);
  expect(api.current().payments[0].status).toBe("cancelled");
  expect(api.current().documents).toEqual([]);
  expect(
    saleWorkspaceTotals(api.current().draft, api.current().payments).balance,
  ).toBe(1_200_000);
  await page
    .getByRole("button", { name: "Payments & receipts", exact: true })
    .click();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "View receipt", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Confirm received", exact: true }),
  ).toHaveCount(0);
  expect(api.blockedWrites).toEqual([]);
});

test("collection with an outstanding balance requires explicit acknowledgement and stays unpaid", async ({
  page,
  context,
}) => {
  const api = new FixtureSalesApi();
  api.seed();
  await api.attach(context);
  await openSale(page);
  await page
    .getByRole("button", { name: "Delivery & handover", exact: true })
    .click();
  await page.getByRole("button", { name: "Collection", exact: true }).click();
  await page.getByLabel("Recipient", { exact: true }).fill("Alex Lifecycle");
  await page
    .getByRole("button", { name: "Mark collected", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Confirm handover", exact: true }),
  ).toBeDisabled();
  await expect(dialog).toContainText("£12,000.00");
  await dialog
    .getByRole("checkbox", { name: /^I acknowledge the outstanding balance/ })
    .check();
  await dialog
    .getByRole("button", { name: "Confirm handover", exact: true })
    .click();
  await expect(dialog).toBeHidden();
  expect(api.current().draft.handover).toBe(true);
  expect(api.current().documents.at(-1)?.title).toBe("Collection confirmation");
  expect(
    saleWorkspaceTotals(api.current().draft, api.current().payments).balance,
  ).toBe(1_200_000);
  await expect(page.locator(".sales-quick-actions")).toContainText(
    "Awaiting payment",
  );
  await expect(page.locator(".sales-quick-actions")).toContainText("Collected");
  expect(api.blockedWrites).toEqual([]);
});

for (const width of [390, 820]) {
  test(`payment and delivery controls remain readable without horizontal overflow at ${width}px`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const api = new FixtureSalesApi();
    const sale = api.seed();
    api.change(sale.id, {
      action: "payment",
      payment: {
        amount: "500",
        method: "Cash",
        date: "2026-10-04",
        reference: "MOBILE-DEPOSIT",
        kind: "deposit",
        status: "confirmed",
      },
    });
    await api.attach(context);
    await openSale(page);
    await page
      .locator(".sales-quick-actions")
      .getByRole("button", { name: "Record payment", exact: true })
      .click();
    await expect(
      page
        .getByRole("dialog")
        .getByLabel("Payment amount (£)", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Payments & receipts", exact: true })
      .click();
    await mkdir(output, { recursive: true });
    await resetCapturePosition(page);
    await page.screenshot({
      path: `${output}/payments-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Delivery & handover", exact: true })
      .click();
    await page.getByRole("button", { name: "Delivery", exact: true }).click();
    await expect(
      page.getByLabel("Delivery address", { exact: true }),
    ).toBeVisible();
    await resetCapturePosition(page);
    await page.screenshot({
      path: `${output}/delivery-${width}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(api.blockedWrites).toEqual([]);
  });
}
