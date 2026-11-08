import { test, expect } from "@playwright/test";
import { defaultInvoiceSettings } from "@workspace/vehicle-meta";

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== "1", "Isolated settings UI; all writes are intercepted.");
test.use({ reducedMotion: "reduce" });

for (const width of [390, 820, 1440]) {
  test(`dealers can update terms and payment instructions without changing issued paperwork at ${width}px`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 1000 });
    const instructions = "Use the invoice reference when making a bank transfer.";
    let settings = { revision: 1, saleTerms: "", reservationTerms: "", invoiceSettings: { ...defaultInvoiceSettings, referencePrefix: "LUX", startingSequence: 120 } };
    let writes = 0;
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/**", async route => {
      const request = route.request();
      if (new URL(request.url()).pathname === "/api/dealer-integrations/sales-paperwork") {
        if (request.method() === "PUT") {
          const body = request.postDataJSON();
          expect(body).toMatchObject({
            expectedRevision: 1,
            saleTerms: "Fictional approved sale terms.",
            reservationTerms: "Fictional approved deposit terms.",
            invoiceSettings: { referencePrefix: "LUX", startingSequence: 120, paymentInstructions: instructions },
          });
          settings = { ...body, revision: 2 };
          writes++;
        }
        return route.fulfill({ json: settings });
      }
      if (!["GET", "HEAD"].includes(request.method())) return route.abort();
      return route.continue();
    });
    await page.goto("/portal?section=settings&settingsTab=paperwork");
    await expect(page.getByRole("heading", { name: "Invoices and terms", exact: true })).toBeVisible();
    await page.getByLabel("Terms and conditions of sale", { exact: true }).fill("Fictional approved sale terms.");
    await page.getByLabel("Deposit and reservation terms", { exact: true }).fill("Fictional approved deposit terms.");
    const paymentInstructions = page.getByRole("textbox", { name: "Payment instructions", exact: true });
    await paymentInstructions.fill(instructions);
    await expect(page.getByLabel("Design style")).toHaveCount(0);
    await expect(page.getByLabel("Starting sequence (minimum)")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Check A4 preview" })).toHaveCount(0);
    await page.getByRole("button", { name: "Save document settings", exact: true }).click();
    await expect(page.getByText("Document settings saved. Existing invoices, payment records and numbering stay unchanged.")).toBeVisible();
    await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname === "/api/dealer-integrations/sales-paperwork" && response.request().method() === "GET"),
      page.reload({ waitUntil: "domcontentloaded" }),
    ]);
    await expect(paymentInstructions).toHaveValue(instructions);
    expect(writes).toBe(1);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
