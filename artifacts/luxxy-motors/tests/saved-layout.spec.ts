import { test, expect } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const fixtures = process.env.MOT_AUDIT_FIXTURES;
const output = process.env.SAVED_LAYOUT_OUTPUT;
test.skip(
  !fixtures,
  "Set MOT_AUDIT_FIXTURES to the public dealership snapshots.",
);
for (const source of ["shore", "multi"])
  test(`${source}: useful saved details without oversized photos`, async ({
    page,
  }, info) => {
    const settings = JSON.parse(
      await readFile(
        path.join(fixtures!, `${source}-public-settings.json`),
        "utf8",
      ),
    );
    const stock = JSON.parse(
      await readFile(
        path.join(fixtures!, `${source}-public-stock.json`),
        "utf8",
      ),
    );
    const car = stock.cars.find(
      (c: any) =>
        (c.features?.length ||
          c.specifications?.features?.length ||
          c.sourceExtras?.features?.length) &&
        c.bodyType &&
        c.colour &&
        c.engineSize &&
        c.mileage,
    );
    expect(car).toBeTruthy();
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
      if (url.pathname === `/api/vehicles/${car.id}`)
        return route.fulfill({ json: car });
      return route.continue();
    });
    await page.goto(`/vehicle/${car.id}`);
    await page.getByTestId(`button-save-${car.id}`).click();
    await page.goto("/saved");
    const card = page.locator(".vehicle-card-saved-details");
    await expect(card).toHaveCount(1);
    const specs = card.locator('[aria-label="Vehicle specifications"]');
    await expect(specs).toContainText(
      new Intl.NumberFormat("en-GB").format(car.mileage) + " miles",
    );
    await expect(specs).toContainText(car.engineSize);
    await expect(specs).toContainText(car.bodyType);
    await expect(specs).toContainText(car.colour);
    await expect(
      card.getByRole("list", { name: "Key features" }),
    ).toBeVisible();
    expect(
      await card
        .getByRole("list", { name: "Key features" })
        .locator("li")
        .count(),
    ).toBeLessThanOrEqual(4);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const photo = await card.locator(".vehicle-card-photo").boundingBox();
    if (info.project.name === "Desktop")
      expect(photo!.width).toBeLessThanOrEqual(480);
    await card.scrollIntoViewIfNeeded();
    await expect
      .poll(async () =>
        card
          .locator(".vehicle-card-photo img")
          .evaluate(
            (image: HTMLImageElement) =>
              image.complete && image.naturalWidth > 0,
          ),
      )
      .toBe(true);
    if (output) {
      await mkdir(output, { recursive: true });
      await card.screenshot({
        path: path.join(output, `${source}-${info.project.name}.png`),
      });
      await writeFile(
        path.join(output, `${source}-${info.project.name}.json`),
        JSON.stringify(
          { viewport: page.viewportSize(), photo, writes, errors },
          null,
          2,
        ),
      );
    }
    await card.getByRole("link", { name: "View vehicle", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/vehicle/${car.id}$`));
    await page.goto(`/saved?cars=${car.id}`);
    await expect(
      page.getByRole("heading", { name: "Shared shortlist", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".saved-car-specs")).toContainText(car.bodyType);
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
