import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Car, StockData } from "../src/lib/stock-context";

const fixtures = process.env.MOT_AUDIT_FIXTURES;
const output = process.env.STOCK_SIDEBAR_OUTPUT;
test.skip(!fixtures, "Set MOT_AUDIT_FIXTURES to public dealer snapshots.");

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(page.viewportSize()!.width);
}
async function targetSize(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);
}
function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: typeof a,
) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

for (const source of ["shore", "multi"]) {
  test(`${source}: sidebar and compact filters preserve the complete stock journey`, async ({
    page,
  }, info) => {
    const load = async (suffix: string) =>
      JSON.parse(
        await readFile(
          path.join(fixtures!, `${source}-public-${suffix}.json`),
          "utf8",
        ),
      );
    const stock = (await load("stock")) as StockData;
    const settings = await load("settings");
    // Keep the actual source's stock fields, but make galleries deterministic and local.
    stock.cars = stock.cars.map((car) => ({
      ...car,
      heroImage: "/src/assets/demo-car-hero.jpg?photo=1",
      imageCount: 3,
      images: [1, 2, 3].map(
        (index) => `/src/assets/demo-car-hero.jpg?photo=${index}`,
      ),
    }));
    const publicCars = stock.cars.filter(
      (car) =>
        !["sold", "archived", "hidden"].includes(
          String(car.inventoryStatus).toLowerCase(),
        ),
    );
    const mutations: string[] = [],
      errors: string[] = [];
    const touch = info.project.use.hasTouch === true;
    const activate = async (locator: Locator) =>
      touch ? locator.tap() : locator.click();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (!["GET", "HEAD"].includes(request.method())) {
        mutations.push(`${request.method()} ${url.pathname}`);
        return route.abort();
      }
      if (url.origin !== "http://127.0.0.1:4285") return route.abort();
      if (url.pathname === "/api/dealer-settings")
        return route.fulfill({ json: settings });
      if (url.pathname === "/api/stock") return route.fulfill({ json: stock });
      return route.continue();
    });
    await page.goto("/stock");
    const cards = page.locator("#vehicle-results .stock-details-card");
    await expect(cards.first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect
      .poll(() =>
        cards
          .first()
          .locator(".vehicle-card-photo img")
          .evaluate(
            (image: HTMLImageElement) =>
              image.complete && image.naturalWidth > 0,
          ),
      )
      .toBe(true);
    const width = page.viewportSize()!.width;
    const desktop = width >= 1024;
    const firstTop = (await cards.first().boundingBox())!.y;
    expect(firstTop).toBeLessThan(desktop ? 320 : 400);
    await noOverflow(page);
    const title = await page.locator("#vehicle-results-heading").boundingBox();
    const header = await page
      .locator("[data-site-header]")
      .first()
      .boundingBox();
    const options = page.getByRole("button", {
      name: "View options",
      exact: true,
    });
    expect(title).not.toBeNull();
    expect(header).not.toBeNull();
    expect(title!.y).toBeGreaterThanOrEqual(header!.y + header!.height - 1);
    expect(overlaps(title!, (await options.boundingBox())!)).toBe(false);
    await targetSize(options);
    await targetSize(
      page.getByRole("combobox", { name: "Sort results", exact: true }),
    );
    if (desktop) {
      const aside = page.getByRole("complementary", { name: "Filter cars" });
      await expect(aside).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Advanced search", exact: true }),
      ).toHaveCount(0);
      const asideBox = (await aside.boundingBox())!,
        cardBox = (await cards.first().boundingBox())!;
      expect(asideBox.x + asideBox.width).toBeLessThan(cardBox.x);
      await targetSize(
        aside.getByRole("combobox", { name: "Make", exact: true }),
      );
    } else {
      await expect(page.getByRole("complementary")).toHaveCount(0);
      await targetSize(
        page.getByRole("button", { name: "Advanced search", exact: true }),
      );
    }
    const capture = async (suffix: string) => {
      if (!output) return;
      await mkdir(output, { recursive: true });
      await page.screenshot({
        path: path.join(output, `${source}-${info.project.name}-${suffix}.png`),
        animations: "disabled",
      });
    };
    await capture("page");

    const initialId = (await cards
      .first()
      .getAttribute("data-testid"))!.replace(/^card-vehicle-/, "");
    const car = publicCars.find((value) => value.id === initialId)!;
    expect(car.make).toBeTruthy();
    expect(car.model).toBeTruthy();
    expect(car.fuel).toBeTruthy();
    const openFilters = async () => {
      if (page.viewportSize()!.width >= 1024)
        return page.getByRole("complementary", { name: "Filter cars" });
      await activate(
        page.getByRole("button", { name: "Advanced search", exact: true }),
      );
      const dialog = page.getByRole("dialog", { name: "Filter used cars" });
      await expect(dialog).toBeVisible();
      const dialogBox = (await dialog.boundingBox())!,
        viewport = page.viewportSize()!;
      expect(dialogBox.x).toBeGreaterThanOrEqual(-1);
      expect(dialogBox.y).toBeGreaterThanOrEqual(-1);
      expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(
        viewport.width + 1,
      );
      expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(
        viewport.height + 1,
      );
      return dialog;
    };
    const closeFilters = async (container: Locator) => {
      if (page.viewportSize()!.width >= 1024) return;
      await activate(
        container.getByRole("button", { name: /^Show \d+ cars?$/ }),
      );
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.locator("#vehicle-results")).toBeFocused();
    };
    let filterContainer = await openFilters();
    if (!desktop) {
      // Quick preferences must not move focus to results behind the open modal.
      for (const name of ["Show automatic cars", "Show cars under £10k"]) {
        const preference = filterContainer.getByRole("button", {
          name,
          exact: true,
        });
        if (await preference.count()) {
          await activate(preference);
          await expect(filterContainer).toBeVisible();
          expect(
            await filterContainer.evaluate((el) =>
              el.contains(document.activeElement),
            ),
          ).toBe(true);
          await activate(preference);
        }
      }
    }
    if (!desktop) {
      const close = filterContainer.getByRole("button", {
        name: "Close",
        exact: true,
      });
      const heading = filterContainer.getByRole("heading", {
        name: "Filter used cars",
        exact: true,
      });
      expect(
        overlaps((await close.boundingBox())!, (await heading.boundingBox())!),
      ).toBe(false);
      await targetSize(close);
      await targetSize(
        filterContainer.getByRole("button", { name: /^Show \d+ cars?$/ }),
      );
      await capture("filters");
    }
    await filterContainer
      .getByRole("combobox", { name: "Make", exact: true })
      .selectOption(car.make!);
    await filterContainer
      .getByRole("combobox", { name: "Model", exact: true })
      .selectOption(car.model!);
    const maxBudget = filterContainer.getByRole("combobox", {
      name: "Max budget",
      exact: true,
    });
    const budget = await maxBudget.locator("option").evaluateAll(
      (options, price) =>
        options
          .map((option) => Number((option as HTMLOptionElement).value))
          .filter((value) => value > 0 && value >= Number(price))
          .sort((a, b) => a - b)[0],
      car.price,
    );
    expect(budget).toBeGreaterThan(0);
    await maxBudget.selectOption(String(budget));
    await activate(
      filterContainer.locator("summary").filter({ hasText: "More filters" }),
    );
    await filterContainer
      .getByRole("combobox", { name: "Fuel", exact: true })
      .selectOption(car.fuel!);
    await expect(cards.first()).toContainText(car.make!);
    let query = new URL(page.url()).searchParams;
    expect(query.get("make")).toBe(car.make);
    expect(query.get("model")).toBe(car.model);
    expect(query.get("maxPrice")).toBe(String(budget));
    expect(query.get("fuel")).toBe(car.fuel);
    await closeFilters(filterContainer);
    await page.reload();
    await expect(cards.first()).toBeVisible();
    filterContainer = await openFilters();
    await expect(
      filterContainer.getByRole("combobox", { name: "Make", exact: true }),
    ).toHaveValue(car.make!);
    await expect(
      filterContainer.getByRole("combobox", { name: "Model", exact: true }),
    ).toHaveValue(car.model!);
    await expect(
      filterContainer.getByRole("combobox", {
        name: "Max budget",
        exact: true,
      }),
    ).toHaveValue(String(budget));
    await activate(
      filterContainer.getByRole("button", {
        name: "Reset filters",
        exact: true,
      }),
    );
    await closeFilters(filterContainer);
    expect(new URL(page.url()).search).toBe("");
    await expect(cards).toHaveCount(Math.min(12, publicCars.length));

    const search = page.getByRole("textbox", {
      name: "Search the showroom",
      exact: true,
    });
    await search.fill(car.make!);
    await search.press("Enter");
    await page
      .getByRole("combobox", { name: "Sort results", exact: true })
      .selectOption("price-asc");
    query = new URL(page.url()).searchParams;
    expect(query.get("search")).toBe(car.make);
    expect(query.get("sort")).toBe("price-asc");
    const matching = publicCars
      .filter((value) => value.make === car.make)
      .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
    await expect(cards.first()).toHaveAttribute(
      "data-testid",
      `card-vehicle-${matching[0].id}`,
    );
    await page.reload();
    await expect(
      page.getByRole("textbox", { name: "Search the showroom", exact: true }),
    ).toHaveValue(car.make!);
    await expect(
      page.getByRole("combobox", { name: "Sort results", exact: true }),
    ).toHaveValue("price-asc");
    await activate(
      page.getByRole("button", {
        name: `Remove ${car.make} filter`,
        exact: true,
      }),
    );
    expect(new URL(page.url()).searchParams.has("search")).toBe(false);
    expect(new URL(page.url()).searchParams.get("sort")).toBe("price-asc");
    await activate(
      page.getByRole("button", { name: "Reset all", exact: true }),
    );

    // A phone rotation must not leave an invisible modal or the body locked.
    if (width === 390) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await openFilters();
      await page.setViewportSize({ width: 1194, height: 834 });
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(
        page.getByRole("complementary", { name: "Filter cars" }),
      ).toBeVisible();
      await expect(
        page.getByRole("combobox", { name: "Make", exact: true }),
      ).toHaveCount(1);
      await expect
        .poll(() =>
          page.evaluate(() => getComputedStyle(document.body).overflow),
        )
        .not.toBe("hidden");
      await expect
        .poll(() =>
          page.evaluate(() => getComputedStyle(document.body).pointerEvents),
        )
        .not.toBe("none");
      await noOverflow(page);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(
        page.getByRole("button", { name: "Advanced search", exact: true }),
      ).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }

    const first = cards.first();
    const id = (await first.getAttribute("data-testid"))!.replace(
      /^card-vehicle-/,
      "",
    );
    const save = first.getByTestId(`button-save-${id}`);
    await targetSize(save);
    await activate(save);
    await expect(save).toHaveAttribute("aria-pressed", "true");
    const photo = first.locator("[data-stock-link]");
    const originalPhoto = await photo.locator("img").getAttribute("src");
    if (touch) {
      // Exercise the touch-pointer handler; physical swipe behaviour is covered separately.
      await photo.scrollIntoViewIfNeeded();
      const box = (await photo.boundingBox())!;
      const start = {
        pointerId: 1,
        pointerType: "touch",
        isPrimary: true,
        clientX: box.x + box.width * 0.8,
        clientY: box.y + box.height * 0.5,
      };
      const end = { ...start, clientX: box.x + box.width * 0.2 };
      await photo.dispatchEvent("pointerdown", start);
      await photo.dispatchEvent("pointermove", end);
      await photo.dispatchEvent("pointerup", end);
    } else {
      await first.hover();
      await activate(first.getByRole("button", { name: /^Next photo of/ }));
    }
    await expect(photo.locator("img")).not.toHaveAttribute(
      "src",
      originalPhoto!,
    );
    await expect(first.locator(".stock-photo-count")).toHaveText("2 / 3");
    await expect(page).toHaveURL(/\/stock$/);
    const vehicleLink = first.getByRole("link", {
      name: "View car",
      exact: true,
    });
    await targetSize(vehicleLink);
    await noOverflow(page);
    await activate(vehicleLink);
    await expect(page).toHaveURL(new RegExp(`/vehicle/${id}$`));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(mutations).toEqual([]);
    expect(errors).toEqual([]);
    if (output)
      await writeFile(
        path.join(output, `${source}-${info.project.name}.json`),
        JSON.stringify(
          {
            source,
            viewport: { width, height: info.project.use.viewport?.height },
            firstTop,
            publicCars: publicCars.length,
            mutations,
            errors,
          },
          null,
          2,
        ),
      );
  });
}
