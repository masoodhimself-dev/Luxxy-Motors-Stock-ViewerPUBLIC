import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const history = {
  registration: "AB12CDE",
  make: "FORD",
  model: "FOCUS",
  checkedAt: "2026-10-28T10:00:00Z",
  recall: "Unknown",
  tests: [
    {
      completedDate: "2026-10-01T10:00:00Z",
      result: "PASSED",
      expiryDate: "2027-09-30",
      mileage: "42000",
      mileageUnit: "MI",
      defects: [
        {
          text: "Front tyre worn close to the legal limit",
          type: "ADVISORY",
          dangerous: false,
        },
      ],
    },
  ],
};
for (const width of [390, 820, 1440])
  test(`MOT customer, staff and invoice part-exchange pop-up at ${width}px`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const writes: string[] = [],
      errors: string[] = [];
    let calls = 0,
      unavailable = false;
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
      const req = route.request(),
        url = new URL(req.url());
      if (url.origin !== "http://127.0.0.1:4279") return route.abort();
      if (
        url.pathname.startsWith("/api/") &&
        !["GET", "HEAD"].includes(req.method())
      ) {
        writes.push(url.pathname);
        return route.abort();
      }
      return route.continue();
    });
    await page.route("**/api/**mot-history*", (route) => {
      calls++;
      return unavailable
        ? route.fulfill({ status: 503, json: { code: "unavailable" } })
        : route.fulfill({ json: { status: "available", history } });
    });
    const stock = await (await request.get("/api/stock")).json();
    await page.goto(`/vehicle/${stock.cars[0].id}`);
    const view = page.getByRole("button", {
      name: "View MOT history",
      exact: true,
    });
    await expect(view).toBeVisible();
    expect(calls).toBe(0);
    await view.click();
    await expect(
      page.getByText("Latest test: Passed", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/42,000 miles/)).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.goto("/portal?section=sales");
    await page
      .getByRole("button", { name: "New invoice", exact: true })
      .click();
    const car = page.getByRole("combobox", { name: "Vehicle", exact: true });
    await car.selectOption(stock.cars[0].id);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page
      .getByLabel("Customer’s full name", { exact: true })
      .fill("MOT preview only");
    await page
      .getByLabel("Customer address", { exact: true })
      .fill("Preview address");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await page
      .getByText("Fees, discounts or part exchange", { exact: true })
      .click();
    await page
      .getByRole("button", { name: "Add part exchange", exact: true })
      .click();
    await page
      .getByLabel("Part-exchange registration", { exact: true })
      .fill("AB12 CDE");
    await page.getByLabel("Allowance (£)", { exact: true }).fill("1500");
    await page
      .getByRole("button", { name: "Check part-exchange MOT", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.getByRole("textbox", { name: "Registration number", exact: true }),
    ).toHaveValue("AB12 CDE");
    await dialog
      .getByRole("button", { name: "Check MOT", exact: true })
      .click();
    await expect(
      dialog.getByText("Latest test: Passed", { exact: true }),
    ).toBeVisible();
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    await mkdir("/private/tmp/luxxy-mot-ui", { recursive: true });
    await page.screenshot({
      path: `/private/tmp/luxxy-mot-ui/part-exchange-${width}.png`,
    });
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByLabel("Allowance (£)", { exact: true })).toHaveValue(
      "1500",
    );
    await expect(
      page.getByLabel("Part-exchange registration", { exact: true }),
    ).toHaveValue("AB12 CDE");
    await page
      .getByRole("button", { name: "Check part-exchange MOT", exact: true })
      .click();
    unavailable = true;
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Check MOT", exact: true })
      .click();
    await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
      "temporarily unavailable",
    );
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
