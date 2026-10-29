import { test, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
const fixtures = process.env.MOT_AUDIT_FIXTURES!;
for (const source of ["shore", "multi"])
  test(`${source}: compact checks, first MOT and delivery`, async ({
    page,
  }, info) => {
    const action = info.project.use.hasTouch ? "tap" : "click";
    const stock = JSON.parse(
      await readFile(`${fixtures}/${source}-public-stock.json`, "utf8"),
    );
    const settings = JSON.parse(
      await readFile(`${fixtures}/${source}-public-settings.json`, "utf8"),
    );
    settings.delivery = { ...settings.delivery, enabled: true };
    settings.deliveryPricing = {
      enabled: true,
      basePrice: "50.00",
      pricePerMile: "1.50",
    };
    const car = stock.cars[0];
    let lookups = 0,
      quotes = 0,
      mode = "pass";
    const writes: string[] = [],
      errors: string[] = [];
    const history = {
      registration: "AB12CDE",
      make: "FORD",
      model: "FOCUS",
      checkedAt: new Date().toISOString(),
      recall: "Unknown",
      tests: [
        {
          completedDate: new Date().toISOString(),
          result: "PASSED",
          expiryDate: new Date(Date.now() + 330 * 86400000)
            .toISOString()
            .slice(0, 10),
          mileage: "42000",
          mileageUnit: "MI",
          defects: [
            {
              type: "ADVISORY",
              text: "Tyre worn close to limit",
              dangerous: false,
            },
          ],
        },
      ],
    };
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== "http://127.0.0.1:4284") return route.abort();
      return route.continue();
    });
    await page.route("**/api/**", (route) => {
      const req = route.request(),
        url = new URL(req.url());
      if (!["GET", "HEAD"].includes(req.method())) {
        writes.push(url.pathname);
        return route.abort();
      }
      if (url.pathname === "/api/stock") return route.fulfill({ json: stock });
      if (url.pathname === "/api/dealer-settings")
        return route.fulfill({ json: settings });
      if (url.pathname.includes("/mot-history")) {
        if (url.searchParams.get("cacheOnly") !== "true") lookups++;
        if (mode === "missing")
          return route.fulfill({
            json: {
              status: "registration_missing",
              message:
                "Ask the dealership for the registration to check MOT history.",
            },
          });
        if (mode === "error")
          return route.fulfill({ status: 503, json: { code: "unavailable" } });
        return route.fulfill({
          json: {
            status: "available",
            history:
              mode === "new"
                ? { ...history, tests: [], firstMotDueDate: "2028-05-20" }
                : mode === "failed"
                  ? {
                      ...history,
                      tests: [
                        {
                          ...history.tests[0],
                          result: "FAILED",
                          expiryDate: null,
                        },
                      ],
                    }
                  : history,
          },
        });
      }
      if (url.pathname === "/api/postcodes/delivery-estimate") {
        quotes++;
        return route.fulfill({
          json: {
            postcode: "SW1A 1AA",
            roadMiles: 23.4,
            basePricePence: 5000,
            pricePerMilePence: 150,
            mileageChargePence: 3510,
            totalPence: 8510,
            distanceBasis: "driving",
            estimated: true,
          },
        });
      }
      if (url.pathname.startsWith("/api/postcodes/"))
        return route.fulfill({
          json: { suggestions: [], status: "unavailable" },
        });
      return route.continue();
    });
    await page.goto(`/vehicle/${car.id}`);
    const checks = page.getByRole("region", { name: "Useful vehicle checks" });
    await expect(
      checks.getByRole("button", { name: /Long MOT/ }),
    ).toBeVisible();
    expect(lookups).toBe(0);
    expect(quotes).toBe(0);
    const mot = checks.getByRole("button", {
        name: "MOT history",
        exact: true,
      }),
      delivery = checks.getByRole("button", {
        name: "Delivery estimate",
        exact: true,
      });
    const boxes = await checks
      .locator(".vehicle-quick-check-buttons")
      .evaluate((el) =>
        [...el.querySelectorAll("button")].map((b) => ({
          y: b.getBoundingClientRect().y,
          height: b.getBoundingClientRect().height,
        })),
      );
    expect(Math.abs(boxes[0].y - boxes[1].y)).toBeLessThan(2);
    expect(boxes.every((b) => b.height >= 44)).toBe(true);
    expect(
      await checks.evaluate((el) => {
        const price = el.parentElement!.querySelector(".vehicle-price-block")!;
        return (
          el.getBoundingClientRect().top >=
            price.getBoundingClientRect().bottom &&
          el.getBoundingClientRect().top -
            price.getBoundingClientRect().bottom <
            30
        );
      }),
    ).toBe(true);
    await mot[action]();
    await expect(page.getByText("Latest test: Passed")).toBeVisible();
    await expect(page.getByText("Tyre worn close to limit")).toBeVisible();
    expect(lookups).toBe(1);
    await page.getByRole("button", { name: "Close", exact: true })[action]();
    await expect(mot).toBeFocused();
    await delivery[action]();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(
      await page.getByRole("dialog").evaluate((el) => {
        const title = el.querySelector("h2")!;
        const close = [...el.querySelectorAll("button")].find(
          (b) => b.textContent?.trim() === "Close",
        )!;
        const range = document.createRange();
        range.selectNodeContents(title);
        const a = range.getBoundingClientRect(),
          b = close.getBoundingClientRect();
        return a.right <= b.left || a.bottom <= b.top || a.top >= b.bottom;
      }),
    ).toBe(true);
    await page.getByLabel("Delivery postcode", { exact: true }).fill("SW1A1AA");
    await page
      .getByRole("button", { name: "Calculate delivery", exact: true })
      [action]();
    await expect(
      page.getByRole("dialog").locator("strong").filter({ hasText: "£85.10" }),
    ).toBeVisible();
    await mkdir(process.env.VEHICLE_CHECKS_OUTPUT!, { recursive: true });
    await page.getByRole("dialog").screenshot({
      path: `${process.env.VEHICLE_CHECKS_OUTPUT}/${source}-${info.project.name}-delivery.png`,
    });
    await page.getByRole("button", { name: "Close", exact: true })[action]();
    const quoted = checks.getByRole("button", {
      name: "Delivery · est. £85.10",
    });
    await expect(quoted).toBeFocused();
    await quoted[action]();
    await expect(
      page.getByRole("dialog").locator("strong").filter({ hasText: "£85.10" }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Delivery postcode", { exact: true }),
    ).toHaveValue("SW1A 1AA");
    expect(quotes).toBe(1);
    await page.getByRole("button", { name: "Close", exact: true })[action]();
    await mkdir(process.env.VEHICLE_CHECKS_OUTPUT!, { recursive: true });
    await checks.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `${process.env.VEHICLE_CHECKS_OUTPUT}/${source}-${info.project.name}.png`,
    });
    for (const next of ["failed", "new", "missing", "error"]) {
      mode = next;
      const cachedResponse = page.waitForResponse((r) =>
        r.url().includes("cacheOnly=true"),
      );
      await page.reload();
      await cachedResponse;
      await expect(
        checks.getByRole("button", { name: "MOT history", exact: true }),
      ).toBeVisible();
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      if (next === "new")
        await expect(
          checks.getByRole("button", { name: "First MOT due · 20 May 2028" }),
        ).toBeVisible();
      else
        await expect(
          checks.getByRole("button", { name: /Long MOT|First MOT due/ }),
        ).toHaveCount(0);
      await checks
        .getByRole("button", { name: "MOT history", exact: true })
        [action]();
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      if (next === "new")
        await expect(
          page.getByText(/No MOT required before this date/),
        ).toBeVisible();
      if (next === "failed")
        await expect(page.getByText("Latest test: Failed")).toBeVisible();
      if (next === "missing")
        await expect(
          page.getByText(/Ask the dealership for the registration/),
        ).toBeVisible();
      if (next === "error") {
        await expect(page.getByRole("dialog")).toBeVisible();
        await expect(page.getByRole("alert")).toBeVisible();
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.getByRole("button", { name: "Close", exact: true })[action]();
    }
    settings.delivery.enabled = false;
    await page.reload();
    await expect(
      checks.getByRole("button", { name: "MOT history", exact: true }),
    ).toBeVisible();
    await expect(checks.getByRole("button", { name: /Delivery/ })).toHaveCount(
      0,
    );
    expect(errors).toEqual([]);
    expect(writes).toEqual([]);
  });
