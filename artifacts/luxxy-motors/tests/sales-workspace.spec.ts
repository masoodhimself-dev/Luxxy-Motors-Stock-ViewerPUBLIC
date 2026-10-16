import { test, expect } from "@playwright/test";
import {
  editView,
  optionalPanel,
  previewPdf,
  previewView,
  saleStep,
} from "./sales-pdf-fixture";

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== "1", "Isolated local UI checks");
test.beforeEach(async ({ page }) => {
  // Draft-only checks must never mutate real dealership records.
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
    await previewView(page);
    expect((await previewPdf(page)).toString("latin1")).toContain(
      "DRAFT - not issued",
    );
    const popups: string[] = [];
    page.on("popup", (popup) => popups.push(popup.url()));
    await page
      .getByRole("button", { name: "Print draft", exact: true })
      .click();
    await editView(page);
    await expect(page.getByRole("alert")).toContainText("Select a vehicle.");
    expect(popups).toEqual([]);
    await expect(page.locator("body > .sales-print-copy")).toHaveCount(0);
    const vehicle = page.getByLabel("Vehicle", { exact: true });
    const choice = vehicle.locator('option[value]:not([value=""])').first();
    await expect(choice).toBeAttached();
    await vehicle.selectOption((await choice.getAttribute("value"))!);
    await page.getByLabel("Agreed vehicle price (£)").fill("15000");
    await optionalPanel(page, "Part exchange (optional)");
    await page.getByRole("button", { name: "Add part-exchange car" }).click();
    await page.getByLabel("Registration 1").fill("AB12 CDE");
    await page.getByLabel("Allowance (£) 1").fill("3000");
    await optionalPanel(page, "Fees & discounts (optional)");
    await page.getByRole("button", { name: "Add fee or discount" }).click();
    await page.getByLabel("Description adjustment 1").fill("Delivery");
    await page.getByLabel("Amount (£) adjustment 1").fill("100");
    await previewView(page);
    await expect(page.locator(".sales-live-paper")).toContainText("£12,100.00");
    const pdf = await previewPdf(page);
    expect(pdf.toString("latin1")).toContain("DRAFT - not issued");
    expect(pdf.toString("latin1")).toContain("12,100.00");
    await expect(
      page
        .locator(".sales-pdf-document")
        .locator("input,textarea,select,button"),
    ).toHaveCount(0);
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
  await optionalPanel(page, "Use a recent enquiry or reservation");
  await page.getByRole("button", { name: /Enquiry Customer/ }).click();
  await expect(page.getByLabel("Customer name", { exact: true })).toHaveValue(
    "Enquiry Customer",
  );
  await page.getByLabel("Search recent customers").fill("RES-1");
  await page.getByRole("button", { name: /Reservation Customer/ }).click();
  await expect(page.getByLabel("Email", { exact: true })).toHaveValue(
    "reservation@example.test",
  );
  await optionalPanel(page, "Part exchange (optional)");
  const add = page.getByRole("button", { name: "Add part-exchange car" });
  for (let i = 0; i < 3; i++) await add.click();
  await expect(add).toBeDisabled();
  await page.getByRole("button", { name: "Remove part exchange 2" }).click();
  await expect(add).toBeEnabled();
  await expect(page.getByLabel("Registration 3", { exact: true })).toHaveCount(
    0,
  );
  await saleStep(page, "Payments");
  await expect(
    page.getByLabel("Amount (£) payment 1", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "View receipt", exact: true }),
  ).toHaveCount(0);
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
    workspace.getByRole("heading", {
      name: "Deal details",
      exact: true,
      level: 1,
    }),
  ).toBeVisible();
  expect(
    await workspace.evaluate((element) => getComputedStyle(element).position),
  ).toBe("fixed");
  await workspace
    .getByLabel("Customer name", { exact: true })
    .fill("Sample portal buyer");
  await workspace
    .getByRole("button", { name: "Return to portal", exact: true })
    .click();
  expect(
    await workspace.evaluate((element) => getComputedStyle(element).position),
  ).not.toBe("fixed");
  await page.getByTestId("tab-enquiries").click();
  await expect(workspace).toBeHidden();
  await page.getByTestId("tab-sales").click();
  await expect(
    workspace.getByLabel("Customer name", { exact: true }),
  ).toHaveValue("Sample portal buyer");
  await Promise.all([
    page.waitForEvent("dialog").then((dialog) => dialog.dismiss()),
    page.getByRole("button", { name: "New sale", exact: true }).click(),
  ]);
  await expect(
    workspace.getByLabel("Customer name", { exact: true }),
  ).toHaveValue("Sample portal buyer");
  await Promise.all([
    page.waitForEvent("dialog").then((dialog) => dialog.accept()),
    page.getByRole("button", { name: "New sale", exact: true }).click(),
  ]);
  await expect(
    workspace.getByLabel("Customer name", { exact: true }),
  ).toHaveValue("");
  await workspace
    .getByRole("button", { name: "Return to portal", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "New sale", exact: true }),
  ).toHaveCount(1);
  await workspace
    .getByRole("button", { name: "Focus invoice", exact: true })
    .click();
  await workspace
    .getByRole("button", { name: "Continue to payments", exact: true })
    .click();
  await expect(workspace.getByRole("alert")).toContainText(
    "Enter the customer name.",
  );
  await expect(
    workspace.getByRole("heading", {
      name: "Deal details",
      exact: true,
      level: 1,
    }),
  ).toBeVisible();
  // Sections can be inspected without changing records; forward progression validates the deal.
  for (const section of ["Payments", "Completion", "Deal details"] as const) {
    await saleStep(page, section);
    await expect(
      workspace.getByRole("heading", { name: section, exact: true, level: 1 }),
    ).toBeInViewport();
    await expect(
      workspace
        .getByRole("navigation", { name: "Sale sections" })
        .getByRole("button", { name: new RegExp(`^${section}`) }),
    ).toBeInViewport({ ratio: 1 });
  }
  await previewView(page);
  await workspace
    .getByRole("button", { name: "Print draft", exact: true })
    .click();
  await editView(page);
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
