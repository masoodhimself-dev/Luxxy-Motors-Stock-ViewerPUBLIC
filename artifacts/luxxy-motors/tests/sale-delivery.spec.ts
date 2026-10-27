import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import {
  createSaleWorkspace,
  changeSaleWorkspace,
  saleWorkspaceBranding,
  type SaleWorkspaceCommand,
  type SaleWorkspaceContext,
} from "@workspace/vehicle-meta";
test.skip(
  process.env.LUXXY_LOCAL_PREVIEW !== "1",
  "Fictional local deliveries only.",
);
for (const width of [390, 834, 1440]) {
  test(`saved-sale delivery arrangements, manual confirmations and handover at ${width}`, async ({
    page,
    request,
  }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 1000 });
    const settings = await (await request.get("/api/dealer-settings")).json();
    const stock = await (await request.get("/api/stock")).json();
    const car = stock.cars.find((c: any) => c.inventoryStatus === "available");
    let n = 0;
    const enquiryId = "88888888-8888-4888-8888-888888888888";
    const context: SaleWorkspaceContext = {
      now: new Date().toISOString(),
      actor: "Fictional staff",
      branding: saleWorkspaceBranding(settings),
      nextId: () => crypto.randomUUID(),
      nextNumber: (type) => `TEST-${type}-${++n}`,
    };
    let sale = createSaleWorkspace(
      {
        requestId: "fictional-create",
        draft: {
          customer: "Fictional Delivery Buyer",
          phone: "07700900123",
          email: "delivery@example.test",
          address: "Invoice address",
          vehicleId: car.id,
          vehicle: "Toyota Yaris",
          price: "10000",
          sourceEnquiryId: enquiryId,
        },
      },
      context,
      "TEST-SALE",
    ).sale;
    function change(command: SaleWorkspaceCommand) {
      sale = changeSaleWorkspace(
        sale,
        command,
        { requestId: crypto.randomUUID(), expectedRevision: sale.revision },
        context,
      ).sale;
    }
    change({
      action: "payment",
      payment: {
        amount: "10000",
        method: "Bank transfer",
        date: new Date().toISOString().slice(0, 10),
        kind: "final-payment",
        status: "confirmed",
        reference: "Fictional",
      },
    });
    change({ action: "issue-invoice", kind: "full", acknowledge: true });
    change({ action: "finish-invoice-sale", acknowledge: true });
    const payments = JSON.stringify(sale.payments),
      documents = JSON.stringify(sale.documents);
    let emailPrepared = 0;
    const unhandled: string[] = [];
    const buyer = {
      id: enquiryId,
      customerName: sale.draft.customer,
      phone: sale.draft.phone,
      email: sale.draft.email,
      vehicleTitle: sale.draft.vehicle,
    };
    await page.route("**/api/**", async (route) => {
      const req = route.request(),
        path = new URL(req.url()).pathname;
      if (path === "/api/sale-workspace")
        return route.fulfill({ json: { sales: [sale], preview: true } });
      if (path === `/api/sale-workspace/${sale.id}`)
        return route.fulfill({ json: { sale, preview: true } });
      if (
        path === `/api/sale-workspace/${sale.id}/fulfilment` ||
        path === `/api/sale-workspace/${sale.id}/handover`
      ) {
        const body = req.postDataJSON();
        const command: SaleWorkspaceCommand = path.endsWith("/handover")
          ? {
              action: "handover",
              recipient: body.recipient,
              acknowledgeOutstanding: body.acknowledgeOutstanding,
            }
          : { action: "fulfilment", fulfilment: body.fulfilment };
        try {
          const result = changeSaleWorkspace(sale, command, body, context);
          sale = result.sale;
          return route.fulfill({ json: { ...result, preview: true } });
        } catch {
          return route.fulfill({
            status: 409,
            json: { error: "Fictional conflict" },
          });
        }
      }
      if (path === "/api/staff/whatsapp/enquiries")
        return route.fulfill({
          json: {
            enquiries: [buyer],
            saleCustomer: { ...buyer, saleId: sale.id },
            canCreate: true,
          },
        });
      if (path === "/api/staff/whatsapp/email-enquiry") {
        emailPrepared++;
        return route.fulfill({
          json: {
            enquiry: { ...buyer, reference: "HIDDEN" },
            customerEmail: buyer.email,
          },
        });
      }
      if (path === `/api/staff/enquiries/${enquiryId}/email-context`)
        return route.fulfill({
          json: {
            version: 0,
            savedDraft: null,
            email: buyer.email,
            customerName: buyer.customerName,
            vehicleTitle: sale.draft.vehicle,
            reference: "HIDDEN",
            revision: 0,
            vehicleAvailable: true,
            appointmentAvailable: false,
            defaults: { subject: "Fictional", message: "Fictional" },
            ready: false,
            templates: [],
            invoices: [],
            photos: [],
            deliveries: [],
          },
        });
      if (["GET", "HEAD"].includes(req.method())) return route.continue();
      unhandled.push(path);
      return route.abort();
    });
    await page.goto(`/portal?section=sales&saleId=${sale.id}`);
    const panel = page.getByRole("region", { name: "Collection and delivery" });
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "Edit arrangements" }).click();
    await panel
      .getByRole("button", { name: "Deliver to customer", exact: true })
      .click();
    await panel
      .getByRole("textbox", { name: "Delivery address", exact: true })
      .fill("25 Confirmed Road\nLondon\nHA2 8LY");
    await panel.getByLabel("Planned date", { exact: true }).fill("2026-10-24");
    await panel
      .getByLabel("Arrival window (UK time)", { exact: true })
      .fill("14:00–16:00");
    await panel
      .getByLabel("Staff delivery notes")
      .fill("Internal gate instructions");
    await panel
      .getByRole("button", { name: "Save arrangements", exact: true })
      .click();
    await expect(panel.getByRole("status")).toContainText("Arrangements saved");
    expect(JSON.stringify(sale.payments)).toBe(payments);
    expect(JSON.stringify(sale.documents)).toBe(documents);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await mkdir("/tmp/luxxy-delivery-review", { recursive: true });
    await panel.screenshot({
      path: `/tmp/luxxy-delivery-review/saved-${width}.png`,
    });
    await panel
      .getByRole("button", { name: "Email confirmation", exact: true })
      .click();
    const prepare = page.getByRole("dialog", {
      name: "Prepare customer email",
    });
    await expect(
      prepare.getByLabel("Customer email", { exact: true }),
    ).toHaveValue(buyer.email);
    await prepare
      .getByRole("button", { name: "Continue to email", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Message", exact: true }),
    ).toHaveValue(/25 Confirmed Road/);
    await expect(
      page.getByRole("textbox", { name: "Message", exact: true }),
    ).not.toHaveValue(/Internal gate/);
    expect(emailPrepared).toBe(1);
    await page.keyboard.press("Escape");
    await panel
      .getByRole("button", { name: "WhatsApp confirmation", exact: true })
      .click();
    const share = page.getByRole("dialog", { name: "Send on WhatsApp" });
    await expect(
      share.getByLabel("Customer number", { exact: true }),
    ).toHaveValue("07700900123");
    const handoff = share.getByRole("link", {
      name: "Open WhatsApp",
      exact: true,
    });
    await expect(handoff).toHaveAttribute("href", /447700900123/);
    const message = new URL(
      (await handoff.getAttribute("href"))!,
    ).searchParams.get("text")!;
    expect(message).toContain("25 Confirmed Road");
    expect(message).not.toMatch(/Internal gate|phone-share/);
    await page.keyboard.press("Escape");
    await panel
      .getByRole("button", { name: "Mark delivered", exact: true })
      .click();
    const handover = page.getByRole("dialog", { name: "Confirm delivery" });
    await handover
      .getByRole("button", { name: "Confirm handover", exact: true })
      .click();
    await expect(panel).toContainText("Delivered");
    expect(JSON.stringify(sale.payments)).toBe(payments);
    expect(JSON.stringify(sale.documents.slice(0, -1))).toBe(documents);
    expect(unhandled).toEqual([]);
    await page.reload();
    await expect(
      page.getByRole("region", { name: "Collection and delivery" }),
    ).toContainText("Delivered");
    expect(emailPrepared).toBe(1);
  });
}

for (const width of [390, 834, 1440]) {
  test(`choose collection or delivery on the final invoice step at ${width}`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const writes: string[] = [];
    await page.route("**/api/**", (route) =>
      ["GET", "HEAD"].includes(route.request().method())
        ? route.continue()
        : (writes.push(route.request().url()), route.abort()),
    );
    const stock = await (await request.get("/api/stock")).json();
    const car = stock.cars.find(
      (car: any) => car.inventoryStatus === "available",
    );
    await page.goto("/portal?section=sales");
    await page
      .getByRole("button", { name: "New invoice", exact: true })
      .click();
    await page.getByLabel("Vehicle", { exact: true }).selectOption(car.id);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page
      .getByRole("combobox", { name: "Customer’s full name", exact: true })
      .fill("Fictional Delivery Buyer");
    await page
      .getByRole("combobox", { name: "Telephone", exact: true })
      .fill("07700900123");
    for (let i = 0; i < 3; i++)
      await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(
      page.getByRole("heading", {
        name: "Are these details correct?",
        exact: true,
      }),
    ).toBeVisible();
    const fields = page.getByRole("group", {
      name: "How will the customer receive the car?",
      exact: true,
    });
    await expect(
      fields.getByRole("button", { name: "Customer collecting", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await fields
      .getByRole("button", { name: "Deliver to customer", exact: true })
      .click();
    await expect(
      fields.getByRole("textbox", { name: "Recipient", exact: true }),
    ).toHaveValue("Fictional Delivery Buyer");
    await expect(
      fields.getByRole("textbox", { name: "Contact number", exact: true }),
    ).toHaveValue("07700900123");
    await expect(
      fields.getByRole("textbox", { name: "Delivery address", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create full invoice", exact: true }),
    ).toBeDisabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(writes).toEqual([]);
    await fields.screenshot({
      path: `/tmp/luxxy-delivery-review/final-step-${width}.png`,
    });
  });
}
