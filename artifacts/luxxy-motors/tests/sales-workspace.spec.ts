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
    await page.getByLabel("Customer has a part exchange").check();
    await page.getByLabel("Part-exchange registration").fill("AB12 CDE");
    await page.getByLabel("Make and model").fill("Sample Ford");
    await page.getByLabel("Agreed allowance (£)").fill("3000");
    await page.getByRole("button", { name: "Payments", exact: true }).click();
    await page.getByLabel("Illustrative deposit (£)").fill("250");
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
