import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

test.skip(
  process.env.LUXXY_LOCAL_PREVIEW !== "1",
  "Local presentation audit with isolated API fixtures.",
);
const output = "/tmp/luxxy-customer-edge-consistency";

async function fits(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(await page.evaluate(() => innerWidth));
  for (const action of await page
    .locator("#main-content button:visible, #main-content a:visible")
    .all()) {
    const bounds = await action.boundingBox();
    if (bounds) expect(bounds.height).toBeGreaterThanOrEqual(43);
  }
}
async function screenshot(page: Page, name: string) {
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: `${output}/${name}.png`, fullPage: true });
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/**", (route) =>
    ["GET", "HEAD"].includes(route.request().method())
      ? route.continue()
      : route.fulfill({
          status: 403,
          json: { error: "This audit blocks real writes." },
        }),
  );
});

for (const width of [390, 1440]) {
  test(`404, withdrawn paperwork and expired booking links have readable recovery at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/missing-customer-page");
    await expect(
      page.getByRole("heading", { name: "Let’s get you back on track." }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Browse stock", exact: true }).first(),
    ).toHaveAttribute("href", "/stock");
    await expect(page).toHaveTitle(/Page not found/);
    await fits(page);
    await screenshot(page, `not-found-${width}`);
    for (const path of [
      "/sign/unavailable-fixture",
      "/customer-details/unavailable-fixture",
    ]) {
      await page.goto(path);
      await expect(
        page.getByRole("heading", { name: "This link is no longer available" }),
      ).toBeVisible();
      await expect(
        page
          .locator("#main-content")
          .getByRole("link", { name: "Contact us", exact: true }),
      ).toHaveAttribute("href", "/contact");
      await expect(page).toHaveTitle(/Purchase link unavailable/);
      await fits(page);
    }
    await screenshot(page, `retired-purchase-${width}`);
    await page.route("**/api/viewings/unavailable-fixture", (route) =>
      route.fulfill({
        status: 410,
        json: { error: "Internal expired token debug" },
      }),
    );
    await page.goto("/viewing/unavailable-fixture");
    await expect(
      page.getByRole("heading", { name: "Cannot find booking" }),
    ).toBeVisible();
    await expect(page.getByTestId("status-viewing-error")).toContainText(
      "expired or been replaced",
    );
    await expect(page.getByText("Internal expired token debug")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Try again", exact: true }),
    ).toHaveCount(0);
    await expect(page).toHaveTitle(/Your test drive/);
    await fits(page);
    await screenshot(page, `expired-booking-${width}`);
  });
}

test("temporary booking errors can be retried without showing backend debug messages", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [api, path, heading] of [
    [
      "/api/viewings/temporary-fixture",
      "/viewing/temporary-fixture",
      "Booking temporarily unavailable",
    ],
  ]) {
    let attempts = 0;
    await page.route(`**${api}`, (route) => {
      attempts++;
      return route.fulfill({
        status: 503,
        json: { error: "Backend deployment internal debug" },
      });
    });
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Backend deployment internal debug"),
    ).toHaveCount(0);
    const before = attempts;
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect.poll(() => attempts).toBeGreaterThan(before);
    await fits(page);
  }
});

test("booking loading states have a real page heading and announce the check", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [api, path, heading] of [
    [
      "/api/viewings/slow-fixture",
      "/viewing/slow-fixture",
      "Finding your booking…",
    ],
  ]) {
    let release = () => {};
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(`**${api}`, async (route) => {
      await waiting;
      await route.fulfill({
        status: 410,
        json: { error: "Fixture unavailable" },
      });
    });
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: heading, level: 1, exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('#main-content [role="status"][aria-busy="true"]'),
    ).toBeVisible();
    await fits(page);
    release();
    await expect(page.locator('#main-content [role="alert"]')).toBeVisible();
  }
});
