import { expect, test, type Locator, type Page } from "@playwright/test";
import { optionalPanel, previewPdf, saleStep } from "./sales-pdf-fixture";

test.skip(
  process.env.LUXXY_LOCAL_PREVIEW !== "1",
  "Isolated local invoice layout checks only",
);

test.beforeEach(async ({ page }) => {
  // These checks edit an unsaved draft only. No request may change real records.
  await page.route("**/api/**", (route) =>
    ["GET", "HEAD", "OPTIONS"].includes(route.request().method())
      ? route.continue()
      : route.abort("blockedbyclient"),
  );
});

async function newInvoice(page: Page) {
  await page.goto("/portal?section=sales");
  await page
    .getByRole("button", { name: "New sale", exact: true })
    .first()
    .click();
  await expect(page.locator(".sales-focus-workspace")).toBeVisible();
  await page
    .getByLabel("Customer name", { exact: true })
    .fill("Focused Invoice Buyer");
  const vehicle = page.getByLabel("Vehicle", { exact: true });
  const first = vehicle.locator('option[value]:not([value=""])').first();
  await expect(first).toBeAttached();
  await vehicle.selectOption((await first.getAttribute("value"))!);
  await page.getByLabel("Agreed vehicle price (£)").fill("12500");
}

async function showInvoice(page: Page) {
  const toggle = page.getByRole("button", {
    name: "Invoice preview",
    exact: true,
  });
  if (await toggle.isVisible()) await toggle.click();
  await expect(
    page.locator('.sales-pdf-page[data-rendered="true"]').first(),
  ).toBeVisible();
}

async function showEditor(page: Page) {
  const toggle = page.getByRole("button", { name: "Edit sale", exact: true });
  if (await toggle.isVisible()) await toggle.click();
}

async function expectContained(inner: Locator, outer: Locator) {
  const [inside, outside] = await Promise.all([
    inner.boundingBox(),
    outer.boundingBox(),
  ]);
  expect(inside).not.toBeNull();
  expect(outside).not.toBeNull();
  expect(inside!.x).toBeGreaterThanOrEqual(outside!.x - 1);
  expect(inside!.y).toBeGreaterThanOrEqual(outside!.y - 1);
  expect(inside!.x + inside!.width).toBeLessThanOrEqual(
    outside!.x + outside!.width + 1,
  );
  expect(inside!.y + inside!.height).toBeLessThanOrEqual(
    outside!.y + outside!.height + 1,
  );
}

async function expectFocusChrome(page: Page) {
  const workspace = page.locator(".sales-focus-workspace");
  await expect(workspace).toBeInViewport({ ratio: 1 });
  await expect(
    workspace
      .locator(".sales-titlebar-actions")
      .getByRole("button", { name: "Save draft", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await expect(
    workspace.getByRole("navigation", { name: "Sale sections" }),
  ).toBeInViewport({ ratio: 1 });
  await expect(
    workspace
      .locator(".sales-workspace-footer")
      .getByRole("button", { name: "Continue to payments", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await expect(
    workspace.getByRole("button", { name: "Return to portal", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  expect(
    await page.evaluate(() => ({
      horizontal: document.documentElement.scrollWidth > innerWidth + 1,
      vertical: document.scrollingElement!.scrollHeight > innerHeight + 1,
      scrolled: Math.abs(scrollY) > 1,
    })),
  ).toEqual({ horizontal: false, vertical: false, scrolled: false });
}

async function expectFittedPage(page: Page) {
  const canvas = page.locator('.sales-pdf-page[data-rendered="true"]').first();
  await expect(canvas).toBeInViewport({ ratio: 1 });
  await expectContained(canvas, page.locator(".sales-pdf-document-frame"));
  await expectContained(
    page.locator(".sales-pdf-document-frame"),
    page.locator(".sales-deal-overview"),
  );
  const bounds = await canvas.boundingBox();
  expect(bounds!.height).toBeGreaterThan(180);
  expect(bounds!.height / bounds!.width).toBeCloseTo(842 / 595, 1);
  await expect(
    page.getByRole("button", { name: "Fit page", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expectFocusChrome(page);
}

for (const size of [
  { width: 390, height: 700 },
  { width: 820, height: 900 },
  { width: 1194, height: 700 },
  { width: 1366, height: 650 },
  { width: 1440, height: 900 },
]) {
  test(`invoice stays fully visible without page scrolling at ${size.width}×${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    const errors: string[] = [];
    const writes: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (
        request.url().includes("/api/") &&
        !["GET", "HEAD", "OPTIONS"].includes(request.method())
      )
        writes.push(request.url());
    });
    await newInvoice(page);
    await expectFocusChrome(page);
    await showInvoice(page);
    await expectFittedPage(page);
    expect((await previewPdf(page)).toString("latin1")).toContain(
      "DRAFT - not issued",
    );

    if (size.width >= 1000) {
      const preview = page.locator(".sales-deal-overview");
      const before = await preview.boundingBox();
      const editor = page.locator(".sales-active-sheet");
      const scroll = await editor.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
        return {
          top: element.scrollTop,
          height: element.clientHeight,
          content: element.scrollHeight,
        };
      });
      expect(scroll.content).toBeGreaterThan(scroll.height);
      expect(scroll.top).toBeGreaterThan(0);
      const after = await preview.boundingBox();
      expect(after!.x).toBeCloseTo(before!.x, 0);
      expect(after!.y).toBeCloseTo(before!.y, 0);
      await expectFittedPage(page);
    } else {
      await showEditor(page);
      await page
        .getByLabel("Customer name", { exact: true })
        .scrollIntoViewIfNeeded();
      await expect(
        page.getByLabel("Customer name", { exact: true }),
      ).toHaveValue("Focused Invoice Buyer");
      await expectFocusChrome(page);
      await showInvoice(page);
      await expectFittedPage(page);
    }
    await page.screenshot({
      path: `/tmp/luxxy-invoice-focus-${size.width}x${size.height}.png`,
    });
    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
  });
}

test("returning to the portal keeps the draft and focus can resume", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await newInvoice(page);
  await showInvoice(page);
  await expectFittedPage(page);
  await page
    .getByRole("button", { name: "Return to portal", exact: true })
    .click();
  await expect(page.locator(".sales-focus-workspace")).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "Portal sections" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Focus invoice", exact: true }),
  ).toBeVisible();
  await page.getByTestId("tab-enquiries").click();
  await expect(
    page.getByRole("navigation", { name: "Portal sections" }),
  ).toBeVisible();
  await page.getByTestId("tab-sales").click();
  await expect(page.getByLabel("Customer name", { exact: true })).toHaveValue(
    "Focused Invoice Buyer",
  );
  await expect(page.getByLabel("Agreed vehicle price (£)")).toHaveValue(
    "12500",
  );
  await page
    .getByRole("button", { name: "Focus invoice", exact: true })
    .click();
  await showInvoice(page);
  await expectFittedPage(page);
});

test("fit-page preview responds to resizing and larger view is reversible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await newInvoice(page);
  await showInvoice(page);
  await expectFittedPage(page);
  await page.getByRole("button", { name: "Larger view", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Larger view", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Fit page", exact: true }).click();
  await expectFittedPage(page);
  for (const size of [
    { width: 1366, height: 650 },
    { width: 1194, height: 700 },
    { width: 820, height: 900 },
  ]) {
    await page.setViewportSize(size);
    await showInvoice(page);
    await expect
      .poll(async () => {
        const canvas = await page
          .locator('.sales-pdf-page[data-rendered="true"]')
          .first()
          .boundingBox();
        const frame = await page
          .locator(".sales-pdf-document-frame")
          .boundingBox();
        return Boolean(
          canvas &&
          frame &&
          canvas.y >= frame.y - 1 &&
          canvas.y + canvas.height <= frame.y + frame.height + 1,
        );
      })
      .toBe(true);
    await expectFittedPage(page);
  }
  await showEditor(page);
  await saleStep(page, "Deal details");
  await optionalPanel(page, "Fees & discounts (optional)");
  await page
    .getByRole("button", { name: "Add fee or discount", exact: true })
    .click();
  await page
    .getByLabel("Description adjustment 1", { exact: true })
    .fill("Delivery");
  await page.getByLabel("Amount (£) adjustment 1", { exact: true }).fill("100");
  await showInvoice(page);
  await expectFittedPage(page);
  await expect(page.locator(".sales-live-paper")).toContainText("£12,600.00");
});

for (const width of [390, 1366]) {
  test(`invalid print brings the error into view without page scrolling at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 700 });
    await newInvoice(page);
    await page.getByLabel("Agreed vehicle price (£)").fill("0");
    const editor = page.locator(".sales-active-sheet");
    await editor.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await showInvoice(page);
    await page
      .getByRole("button", { name: "Print draft", exact: true })
      .click();
    const alert = editor.getByRole("alert");
    await expect(alert).toContainText(
      "Enter a valid vehicle price greater than zero.",
    );
    await expect(alert).toBeInViewport({ ratio: 1 });
    await expectFocusChrome(page);
  });
}
