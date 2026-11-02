import { expect, test } from "@playwright/test";
import { previewSettings } from "../preview/settings";

// All writes in this file are intercepted; no signing or publishing reaches a server.
test.skip(
  process.env.LUXXY_LOCAL_PREVIEW !== "1",
  "Uses local preview fixtures.",
);

test("private settings require deliberate discard and are never restored from browser storage", async ({
  page,
}) => {
  let writes = 0;
  await page.route("**/api/dealer-settings", async (route) => {
    if (route.request().method() !== "GET") writes++;
    await route.fulfill({
      json: previewSettings,
      headers: { "x-settings-revision": "0" },
    });
  });
  await page.goto("/portal?section=settings&settingsTab=dealership");
  const name = page.getByLabel("Dealership name", { exact: true });
  await name.fill("Private unpublished draft");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Sales", exact: true }).click();
  await expect(name).toHaveValue("Private unpublished draft");
  expect(
    await page.evaluate(() =>
      [...Object.values(localStorage), ...Object.values(sessionStorage)].some(
        (value) => value.includes("Private unpublished draft"),
      ),
    ),
  ).toBe(false);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Sales", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(name).toHaveValue(previewSettings.identity.name);
  await page.reload();
  await expect(name).toHaveValue(previewSettings.identity.name);
  expect(writes).toBe(0);
});

test("website branding preserves fixed colours while dealers publish their photograph", async ({ page }) => {
  let settings = structuredClone(previewSettings), revision = 0, updates = 0;
  await page.route("**/api/dealer-settings", async route => {
    if (route.request().method() === "PATCH") {
      expect(route.request().headers()["if-match"]).toBe(String(revision));
      settings = route.request().postDataJSON();
      revision++;
      updates++;
    }
    await route.fulfill({ json: settings, headers: { "x-settings-revision": String(revision) } });
  });
  await page.goto("/portal?section=settings&settingsTab=website");
  await expect(page.getByLabel("Main colour hex code")).toHaveCount(0);
  await expect(page.getByLabel("Accent colour hex code")).toHaveCount(0);
  await page.getByLabel("Photograph description", { exact: true }).fill("Our dealership");
  await page.getByRole("button", { name: "Review brand", exact: true }).click();
  expect(updates).toBe(0);
  await page.getByRole("button", { name: "Publish brand", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Website brand published.");
  expect(settings.identity.brandColors).toEqual(previewSettings.identity.brandColors);
  expect(updates).toBe(1);
  await page.reload();
  await expect(page.getByLabel("Photograph description", { exact: true })).toHaveValue("Our dealership");
  await expect(page.getByLabel("Main colour hex code")).toHaveCount(0);
});

test("budget ranges stay valid and applied filters can be removed when collapsed", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Advanced search" }).click();
  await page
    .getByRole("combobox", { name: "Min budget", exact: true })
    .selectOption("20000");
  await page
    .getByRole("combobox", { name: "Max budget", exact: true })
    .selectOption("5000");
  await expect(
    page.getByRole("combobox", { name: "Min budget", exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("status").filter({ hasText: "Minimum budget cleared" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Advanced search" }).click();
  await page
    .getByRole("button", { name: "Remove Up to £5,000 filter" })
    .click();
  await page.getByRole("button", { name: "Advanced search" }).click();
  await expect(
    page.getByRole("combobox", { name: "Max budget", exact: true }),
  ).toHaveValue("");
});

test("empty stock has an actionable inventory message instead of filter advice", async ({
  page,
}) => {
  await page.route("**/api/stock", (route) =>
    route.fulfill({
      json: {
        schemaVersion: 1,
        count: 0,
        cars: [],
        scrapedAt: null,
        dealerName: "Luxxy Motors",
        dealerLocation: "Harrow",
      },
    }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "No cars to show right now" }),
  ).toBeVisible();
  await expect(page.getByTestId("button-clear-filters")).toHaveCount(0);
  await page.getByRole("link", { name: "Ask about upcoming stock" }).click();
  await expect(page.getByTestId("input-customer-name")).toBeVisible();
});
