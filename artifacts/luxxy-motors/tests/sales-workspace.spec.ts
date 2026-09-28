import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
test.skip(process.env.LUXXY_LOCAL_PREVIEW !== "1", "Local demo only");
for (const width of [390, 1194]) {
  test(`sales workspace draft and documents at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/portal/sales-demo");
    await page.getByRole("button", { name: "New sale", exact: true }).click();
    await page
      .getByLabel("Customer name", { exact: true })
      .fill("Sample Buyer");
    await page.getByLabel("Email", { exact: true }).fill("buyer@example.test");
    await page.getByRole("button", { name: "Vehicle", exact: true }).click();
    await page.getByLabel("Vehicle", { exact: true }).selectOption("preview-1");
    await page.getByLabel("Agreed vehicle price (£)").fill("15000");
    await page
      .getByRole("button", { name: "Part exchange", exact: true })
      .click();
    await page.getByRole("button", { name: "Add part-exchange car" }).click();
    await page.getByLabel("Registration 1").fill("AB12 CDE");
    await page.getByLabel("Make and model 1").fill("Sample Ford");
    await page.getByLabel("Allowance (£) 1").fill("3000");
    await page.getByRole("button", { name: "Payments", exact: true }).click();
    await page
      .getByRole("button", { name: "Add payment", exact: true })
      .click();
    await page.getByLabel("Amount (£) payment 1", { exact: true }).fill("250");
    await page
      .getByRole("button", { name: "Add payment", exact: true })
      .click();
    await page.getByLabel("Amount (£) payment 2", { exact: true }).fill("100");
    await page.getByLabel("Method payment 2").selectOption("Cash");
    await page.getByRole("button", { name: "Add fee or discount" }).click();
    await page.getByLabel("Description adjustment 1").fill("Delivery");
    await page.getByLabel("Amount (£) adjustment 1").fill("100");
    await expect(page.getByText("£11,750.00", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Save draft", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText(
      "Draft saved on this device.",
    );
    await page.getByRole("button", { name: "Documents", exact: true }).click();
    await expect(page.locator(".sales-document")).toContainText(
      "NO PAYMENT RECEIVED",
    );
    await expect(page.locator(".sales-document")).toContainText("£11,750.00");
    await page
      .getByLabel("Document", { exact: true })
      .selectOption("Deposit receipt");
    await expect(page.locator(".sales-document")).toContainText(
      "A real receipt will be issued only after payment is confirmed.",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await mkdir("../../docs/screenshots/sales-workspace", { recursive: true });
    await page.screenshot({
      path: `../../docs/screenshots/sales-workspace/documents-${width}.png`,
    });
    await page.evaluate(() => {
      window.print = () => {};
    });
    await page
      .getByRole("button", { name: "Print / Save PDF", exact: true })
      .click();
    await page.emulateMedia({ media: "print" });
    await expect(page.locator("body > .sales-print-copy")).toBeVisible();
    await expect(page.locator("#root")).toBeHidden();
    await expect(page.locator(".sales-print-copy")).toContainText("£11,750.00");
    await page.screenshot({
      path: `../../docs/screenshots/sales-workspace/print-${width}.png`,
      fullPage: true,
    });
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    await page.emulateMedia({ media: "screen" });
    await page.getByRole("button", { name: "All sales", exact: true }).click();
    await expect(
      page.getByRole("button", { name: /Sample Buyer/ }),
    ).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: /Sample Buyer/ }).click();
    await expect(page.getByLabel("Customer name", { exact: true })).toHaveValue(
      "Sample Buyer",
    );
    await page
      .getByLabel("Customer name", { exact: true })
      .fill("Unsaved edit");
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("button", { name: "All sales", exact: true }).click();
    await expect(page.getByLabel("Customer name", { exact: true })).toHaveValue(
      "Unsaved edit",
    );
  });
}

test("copies recent customer contact details and caps exchanges at three", async ({
  page,
}) => {
  await page.route("**/api/enquiries*", (route) =>
    route.fulfill({
      json: [
        {
          id: "e1",
          reference: "ENQ-1",
          customerName: "Enquiry Customer",
          email: "enquiry@example.test",
          phone: "07000000001",
          createdAt: "2026-09-27T10:00:00Z",
        },
      ],
    }),
  );
  await page.route("**/api/reservations", (route) =>
    route.fulfill({
      json: {
        reservations: [
          {
            id: "r1",
            reference: "RES-1",
            customerName: "Reservation Customer",
            email: "reservation@example.test",
            phone: "07000000002",
            createdAt: "2026-09-28T10:00:00Z",
            depositPence: 50000,
          },
        ],
      },
    }),
  );
  await page.goto("/portal/sales-demo");
  await page.getByRole("button", { name: "New sale", exact: true }).click();
  await page
    .getByText("Use a recent enquiry or reservation", { exact: true })
    .click();
  await page.getByRole("button", { name: /Enquiry Customer/ }).click();
  await expect(page.getByLabel("Customer name", { exact: true })).toHaveValue(
    "Enquiry Customer",
  );
  await page.getByLabel("Search recent customers").fill("RES-1");
  await page.getByRole("button", { name: /Reservation Customer/ }).click();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
    "reservation@example.test",
  );
  await page.getByRole("button", { name: "Payments", exact: true }).click();
  await expect(
    page.getByLabel("Amount (£) payment 1", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Part exchange", exact: true })
    .click();
  const add = page.getByRole("button", { name: "Add part-exchange car" });
  for (let i = 0; i < 3; i++) await add.click();
  await expect(add).toBeDisabled();
  await page.getByRole("button", { name: "Remove part exchange 2" }).click();
  await expect(add).toBeEnabled();
  await expect(page.getByLabel("Registration 3", { exact: true })).toHaveCount(
    0,
  );
});
