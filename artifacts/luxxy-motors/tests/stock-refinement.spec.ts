import { test, expect } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const fixtures = process.env.MOT_AUDIT_FIXTURES,
  output = process.env.STOCK_REFINEMENT_OUTPUT;
test.skip(!fixtures, "Set MOT_AUDIT_FIXTURES to public dealer snapshots.");
for (const source of ["shore", "multi"])
  test(`${source}: refined cards retain search, filters, saving and photo controls`, async ({
    page,
  }, info) => {
    const load = async (suffix: string) =>
      JSON.parse(
        await readFile(
          path.join(fixtures!, `${source}-public-${suffix}.json`),
          "utf8",
        ),
      );
    const stock = await load("stock"),
      settings = await load("settings");
    const writes: string[] = [],
      errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/api/**", (route) => {
      const req = route.request(),
        url = new URL(req.url());
      if (!["GET", "HEAD"].includes(req.method())) {
        writes.push(url.pathname);
        return route.abort();
      }
      if (url.pathname === "/api/dealer-settings")
        return route.fulfill({ json: settings });
      if (url.pathname === "/api/stock") return route.fulfill({ json: stock });
      return route.continue();
    });
    await page.goto("/stock");
    const cards = page.locator(".stock-details-card");
    await expect(cards.first()).toBeVisible();
    const first = cards.first(),
      id = await first.getAttribute("data-testid"),
      car = stock.cars.find((c: any) => id === `card-vehicle-${c.id}`)!;
    await expect(
      first.getByText(
        new Intl.NumberFormat("en-GB").format(car.mileage) + " miles",
        { exact: true },
      ),
    ).toBeVisible();
    if (car.engineSize)
      await expect(
        first.getByText(car.engineSize, { exact: true }),
      ).toBeVisible();
    expect(
      await first.locator(".stock-card-equipment li").count(),
    ).toBeLessThanOrEqual(2);
    await expect(
      first.getByRole("link", { name: "View car", exact: true }),
    ).toHaveAttribute("href", `/vehicle/${car.id}`);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const toolbar = await page.locator(".stock-toolbar").boundingBox();
    expect(toolbar!.height).toBeLessThan(165);
    if (info.project.name === "Desktop" || info.project.name === "iPad") {
      const n = info.project.name === "Desktop" ? 3 : 2;
      const ys = [];
      for (let i = 0; i < n; i++)
        ys.push(
          (await cards.nth(i).locator(".vehicle-card-price").boundingBox())!.y,
        );
      expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(3);
    }
    await first.getByTestId(`button-save-${car.id}`).click();
    await expect(first.getByTestId(`button-save-${car.id}`)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    if ((car.images?.length ?? 0) > 1) {
      if (info.project.name === "Desktop")
        await first.getByRole("button", { name: /Next photo/ }).click();
      else
        await first
          .getByRole("link", { name: /View full details for/ })
          .press("ArrowRight");
      await expect(first.locator(".stock-photo-count")).toContainText("2 /");
    }
    await expect
      .poll(async () =>
        first
          .locator(".vehicle-card-photo img")
          .evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth > 0),
      )
      .toBe(true);
    if (output) {
      await mkdir(output, { recursive: true });
      await first.screenshot({
        path: path.join(output, `${source}-${info.project.name}-card.png`),
      });
      await page.screenshot({
        path: path.join(output, `${source}-${info.project.name}-page.png`),
      });
    }
    const search = page.getByRole("textbox", {
      name: "Search the showroom",
      exact: true,
    });
    await search.fill(car.make);
    await search.press("Enter");
    await expect(cards.first()).toContainText(car.make);
    await page
      .getByRole("combobox", { name: "Sort results", exact: true })
      .selectOption("price-asc");
    await page
      .getByRole("button", { name: "Advanced search", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("combobox", { name: "Make", exact: true })
      .selectOption(car.make);
    await dialog.getByRole("button", { name: /Show \d+ cars?/ }).click();
    await expect(dialog).not.toBeVisible();
    await expect(cards.first()).toContainText(car.make);
    await cards
      .first()
      .getByRole("link", { name: "View car", exact: true })
      .click();
    await expect(page).toHaveURL(/\/vehicle\//);
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
    if (output)
      await writeFile(
        path.join(output, `${source}-${info.project.name}.json`),
        JSON.stringify(
          { toolbar, viewport: page.viewportSize(), writes, errors },
          null,
          2,
        ),
      );
  });
