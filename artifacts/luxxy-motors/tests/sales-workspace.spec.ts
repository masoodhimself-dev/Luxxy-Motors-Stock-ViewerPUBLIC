import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
test.skip(process.env.LUXXY_LOCAL_PREVIEW !== "1", "Local demo only");
test.beforeEach(async ({ page }) => {
  // This suite verifies unissued drafts and UI only. Ledger tests use isolated
  // in-memory API fixtures in sales-lifecycle.spec.ts. Block real writes here.
  await page.route("**/api/**", (route) =>
    ["GET", "HEAD", "OPTIONS"].includes(route.request().method())
      ? route.continue()
      : route.abort("blockedbyclient"),
  );
});
for (const width of [390, 1194]) {
  test(`sale draft is readable and cannot print invalid details at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/portal/sales-demo");
    await page.getByRole("button", { name: "New sale", exact: true }).click();
    await page
      .getByLabel("Customer name", { exact: true })
      .fill("Sample Buyer");
    await page.getByRole("button", { name: "Documents", exact: true }).click();
    await expect(page.locator(".sales-document")).toContainText("NOT ISSUED");
    await page
      .getByRole("button", { name: "Print / Save PDF", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("Select a vehicle.");
    await expect(page.locator("body > .sales-print-copy")).toHaveCount(0);
    await page.getByRole("button", { name: "Vehicle", exact: true }).click();
    const vehicle = page.getByLabel("Vehicle", { exact: true });
    await expect(
      vehicle.locator('option[value]:not([value=""])').first(),
    ).toBeAttached();
    await vehicle.selectOption(
      (await vehicle
        .locator('option[value]:not([value=""])')
        .first()
        .getAttribute("value"))!,
    );
    await page.getByLabel("Agreed vehicle price (£)").fill("15000");
    await page
      .getByRole("button", { name: "Part exchange", exact: true })
      .click();
    await page.getByRole("button", { name: "Add part-exchange car" }).click();
    await page.getByLabel("Registration 1").fill("AB12 CDE");
    await page.getByLabel("Allowance (£) 1").fill("3000");
    await page
      .getByRole("button", { name: "Payments & receipts", exact: true })
      .click();
    await page.getByRole("button", { name: "Add fee or discount" }).click();
    await page.getByLabel("Description adjustment 1").fill("Delivery");
    await page.getByLabel("Amount (£) adjustment 1").fill("100");
    await expect(page.locator(".sales-financial-summary")).toContainText(
      "£12,100.00",
    );
    await page.getByRole("button", { name: "Documents", exact: true }).click();
    await page.evaluate(() => {
      window.print = () => {};
    });
    await page
      .getByRole("button", { name: "Print / Save PDF", exact: true })
      .click();
    await page.emulateMedia({ media: "print" });
    const sheet = page.locator("body > .sales-print-copy");
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText("NOT ISSUED");
    await expect(sheet).toContainText("£12,100.00");
    await expect(sheet.locator("input,textarea,select,button")).toHaveCount(0);
    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    await page.emulateMedia({ media: "screen" });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
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
  await page
    .getByRole("button", { name: "Payments & receipts", exact: true })
    .click();
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

test("portal New sale preserves drafts across tabs and confirms before replacing edits", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/portal");
  await expect(
    page.getByRole("button", { name: "New sale", exact: true }),
  ).toHaveCount(1);
  await page.getByRole("button", { name: "New sale", exact: true }).click();
  const workspace = page.locator(".sales-embedded-workspace");
  await expect(
    workspace.getByRole("heading", { name: "Customer", exact: true }),
  ).toBeVisible();
  expect(
    await workspace.evaluate((element) => getComputedStyle(element).position),
  ).not.toBe("fixed");
  await workspace
    .getByLabel("Customer name", { exact: true })
    .fill("Sample portal buyer");
  await page.getByTestId("tab-enquiries").click();
  await expect(workspace).toBeHidden();
  await page.getByTestId("tab-sales").click();
  await expect(
    workspace.getByLabel("Customer name", { exact: true }),
  ).toHaveValue("Sample portal buyer");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "New sale", exact: true }).click();
  await expect(
    workspace.getByLabel("Customer name", { exact: true }),
  ).toHaveValue("Sample portal buyer");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "New sale", exact: true }).click();
  await expect(
    workspace.getByLabel("Customer name", { exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "New sale", exact: true }),
  ).toHaveCount(1);
  for (const section of [
    "Vehicle",
    "Part exchange",
    "Payments & receipts",
    "Documents",
  ]) {
    await workspace.getByRole("button", { name: "Next", exact: true }).click();
    await expect(
      workspace.getByRole("heading", { name: section, exact: true, level: 1 }),
    ).toBeInViewport();
    await expect(
      workspace
        .getByRole("navigation", { name: "Sale sections" })
        .getByRole("button", { name: section, exact: true }),
    ).toBeInViewport({ ratio: 1 });
  }
  await workspace
    .getByRole("button", { name: "Documents", exact: true })
    .click();
  await workspace
    .getByRole("button", { name: "Print / Save PDF", exact: true })
    .click();
  await expect(workspace.getByRole("alert")).toContainText(
    "Enter the customer name.",
  );
  await expect(page.locator("body > .sales-print-copy")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
