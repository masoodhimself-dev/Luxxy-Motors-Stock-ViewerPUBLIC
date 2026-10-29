import { test, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
const fixtures = process.env.MOT_AUDIT_FIXTURES;
test.skip(!fixtures, "Public fixture snapshots required");
test("contrasting dealer colours, long copy and stock recovery states", async ({
  page,
}, info) => {
  test.skip(
    !["phone-320", "iPad-820", "desktop-1440"].includes(info.project.name),
    "Representative device for state/colour checks",
  );
  const settings = JSON.parse(
    await readFile(`${fixtures}/multi-public-settings.json`, "utf8"),
  );
  const stock = JSON.parse(
    await readFile(`${fixtures}/multi-public-stock.json`, "utf8"),
  );
  const introduction =
    "Our carefully selected cars are available to view by appointment. " +
    "Please ask us about any equipment or history you would like to check. ".repeat(
      8,
    );
  settings.presentation = {
    ...settings.presentation,
    pageColour: "#ffffff",
    panelColour: "#111827",
    headingColour: "#f8fafc",
    linkColour: "#fbbf24",
    websiteCopy: {
      ...settings.presentation?.websiteCopy,
      stockTitle: "Our carefully selected exceptional vehicles",
      stockIntroduction: introduction,
    },
  };
  stock.cars = stock.cars.slice(0, 2).map((car: any) => ({
    ...car,
    heroImage: "/src/assets/demo-car-hero.jpg",
    images: ["/src/assets/demo-car-hero.jpg"],
    imageCount: 1,
  }));
  let mode = "ready";
  let releaseStock: (() => Promise<void>) | undefined;
  const writes: string[] = [];
  await page.route("**/*", (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (!["GET", "HEAD"].includes(req.method())) {
      writes.push(req.method() + " " + url.pathname);
      return route.abort();
    }
    if (url.origin !== "http://127.0.0.1:4285") return route.abort();
    if (url.pathname === "/api/dealer-settings")
      return route.fulfill({ json: settings });
    if (url.pathname === "/api/stock") {
      if (mode === "loading")
        return new Promise<void>((resolve) => {
          releaseStock = async () => {
            await route.fulfill({ json: stock });
            resolve();
          };
        });
      if (mode === "empty")
        return route.fulfill({ json: { ...stock, cars: [] } });
      if (mode === "error")
        return route.fulfill({
          status: 503,
          json: { error: "Unavailable fixture" },
        });
      return route.fulfill({ json: stock });
    }
    return route.continue();
  });
  await page.goto("/stock");
  await expect(page.locator(".stock-details-card").first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(page.locator(".stock-end-information")).toHaveText(
    introduction.trim(),
  );
  const titleBox = (await page.locator("h1").boundingBox())!,
    optionBox = (await page
      .getByRole("button", { name: "View options", exact: true })
      .boundingBox())!;
  expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(optionBox.x + 1);
  let container = page.getByRole("complementary", { name: "Filter cars" });
  if (page.viewportSize()!.width < 1024) {
    const button = page.getByRole("button", {
      name: "Advanced search",
      exact: true,
    });
    await button.tap();
    container = page.getByRole("dialog");
  }
  const make = container.getByRole("combobox", { name: "Make", exact: true });
  await expect(make).toBeVisible();
  expect(
    await make.evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe("rgb(17, 24, 39)");
  const contrast = await make.evaluate((el) => {
    const s = getComputedStyle(el);
    const luminance = (c: string) => {
      const values = c
        .match(/[\d.]+/g)!
        .slice(0, 3)
        .map(Number)
        .map((v) => {
          const x = v / 255;
          return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        });
      return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
    };
    const a = luminance(s.color),
      b = luminance(s.backgroundColor);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
  if (process.env.STOCK_SIDEBAR_OUTPUT) {
    await mkdir(process.env.STOCK_SIDEBAR_OUTPUT, { recursive: true });
    await page.screenshot({
      path: `${process.env.STOCK_SIDEBAR_OUTPUT}/dark-${info.project.name}.png`,
    });
  }
  if (page.viewportSize()!.width < 1024)
    await page.getByRole("button", { name: "Close", exact: true }).tap();
  settings.presentation.websiteCopy.stockTitle = "Browse stock";
  mode = "empty";
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "No cars to show right now" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  mode = "error";
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Stock is temporarily unavailable" }),
  ).toBeVisible();
  mode = "ready";
  const retry = page.getByRole("button", { name: "Try again", exact: true });
  if (info.project.use.hasTouch) await retry.tap();
  else await retry.click();
  await expect(page.locator(".stock-details-card").first()).toBeVisible();
  mode = "loading";
  await page.reload();
  await expect(page.locator('[aria-label="Loading stock"]')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  if (page.viewportSize()!.width >= 1024)
    await expect(page.locator(".stock-loading-sidebar")).toBeVisible();
  await expect.poll(() => Boolean(releaseStock)).toBe(true);
  await releaseStock!();
  mode = "ready";
  await expect(page.locator(".stock-details-card").first()).toBeVisible();
  expect(writes).toEqual([]);
});
