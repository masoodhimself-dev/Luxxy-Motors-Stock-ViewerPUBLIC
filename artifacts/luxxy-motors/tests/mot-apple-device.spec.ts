import { test, expect } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
// Public read-only snapshots: supply the audit folder explicitly, never credentials.
const fixtures = process.env.MOT_AUDIT_FIXTURES;
test.skip(
  !fixtures,
  "Set MOT_AUDIT_FIXTURES to the public dealership snapshots for this audit.",
);
for (const slug of ["shore", "multi", "luxxy"])
  test(`${slug}: customer history and invoice part exchange`, async ({
    page,
  }, testInfo) => {
    const load = async (suffix: string) =>
      JSON.parse(
        await readFile(
          path.join(fixtures!, `${slug}-public-${suffix}.json`),
          "utf8",
        ),
      );
    const settings = await load("settings"),
      stock = await load("stock"),
      reply = await load("history");
    const car = stock.cars.find(
      (c: any) =>
        (c.plate || c.vrm || "").replace(/\s/g, "") ===
        reply.history.registration,
    );
    expect(car).toBeTruthy();
    const errors: string[] = [],
      writes: string[] = [];
    let motCalls = 0,
      mode = "available";
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", (dialog) => dialog.accept());
    await page.route("**/*", async (route) => {
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
      if (url.pathname === "/api/dealer-settings")
        return route.fulfill({ json: settings });
      if (url.pathname === "/api/stock") return route.fulfill({ json: stock });
      if (url.pathname.endsWith("/mot-history")) {
        if (url.searchParams.get("cacheOnly") === "true")
          return route.fulfill({ json: { status: "uncached" } });
        motCalls++;
        if (mode === "missing")
          return route.fulfill({
            json: {
              status: "registration_missing",
              message:
                "Ask the dealership for the registration to check MOT history.",
            },
          });
        if (mode === "not-found")
          return route.fulfill({ status: 404, json: { code: "not_found" } });
        if (mode === "unavailable")
          return route.fulfill({ status: 503, json: { code: "unavailable" } });
        return route.fulfill({ json: reply });
      }
      if (/^\/api\/vehicles\/[^/]+$/.test(url.pathname))
        return route.fulfill({
          json:
            stock.cars.find(
              (c: any) => c.id === url.pathname.split("/").at(-1),
            ) ?? car,
        });
      return route.continue();
    });
    await page.goto(`/vehicle/${car.id}`);
    const view = page.getByRole("button", {
      name: "MOT history",
      exact: true,
    });
    await expect(view).toBeVisible();
    expect(motCalls).toBe(0);
    await view.tap();
    const panel = page.locator('section[aria-label="MOT history"]');
    await expect(panel.getByText(/Latest test:/)).toBeVisible();
    await expect(
      panel.getByText(new RegExp(reply.history.registration)),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const expectedWidth = testInfo.project.name.includes("iPhone") ? 390 : 834;
    expect(await page.evaluate(() => innerWidth)).toBe(expectedWidth);
    mode = "missing";
    await page.reload();
    await view.tap();
    await expect(
      panel.getByText(/Ask the dealership for the registration/),
    ).toBeVisible();
    await expect(panel.getByText(/Latest test:/)).toHaveCount(0);
    mode = "available";
    await page.goto("/portal?section=sales");
    await page.getByRole("button", { name: "New invoice", exact: true }).tap();
    await page
      .getByRole("combobox", { name: "Vehicle", exact: true })
      .selectOption(car.id);
    await page.getByRole("button", { name: "Continue", exact: true }).tap();
    await page
      .getByLabel("Customer’s full name", { exact: true })
      .fill("Unsaved local MOT audit");
    await page.getByRole("button", { name: "Continue", exact: true }).tap();
    await page
      .getByText("Fees, discounts or part exchange", { exact: true })
      .tap();
    await page
      .getByRole("button", { name: "Add part exchange", exact: true })
      .tap();
    const registration = page.getByLabel("Part-exchange registration", {
        exact: true,
      }),
      allowance = page.getByLabel("Allowance (£)", { exact: true });
    await registration.fill(reply.history.registration);
    await allowance.fill("1500");
    const opener = page.getByRole("button", {
      name: "Check part-exchange MOT",
      exact: true,
    });
    await opener.tap();
    const dialog = page.getByRole("dialog"),
      field = dialog.getByRole("textbox", {
        name: "Registration number",
        exact: true,
      });
    await expect(field).toHaveValue(reply.history.registration);
    if (expectedWidth === 390)
      expect(
        await field.evaluate((e) => parseFloat(getComputedStyle(e).fontSize)),
      ).toBeGreaterThanOrEqual(16);
    await dialog.getByRole("button", { name: "Check MOT", exact: true }).tap();
    await expect(dialog.getByText(/Latest test:/)).toBeVisible();
    const metrics = await dialog.evaluate((e) => ({
      scrollWidth: e.scrollWidth,
      clientWidth: e.clientWidth,
      height: e.getBoundingClientRect().height,
      viewportHeight: innerHeight,
      overflowY: getComputedStyle(e).overflowY,
    }));
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
    expect(metrics.height).toBeLessThanOrEqual(metrics.viewportHeight);
    expect(metrics.overflowY).toBe("auto");
    const details = dialog.locator("details");
    expect(await details.count()).toBe(reply.history.tests.length);
    await details.last().locator("summary").tap();
    await expect(details.last()).toHaveAttribute("open", "");
    await field.scrollIntoViewIfNeeded();
    const out = path.join(fixtures!, "webkit");
    await mkdir(out, { recursive: true });
    await page.screenshot({
      path: path.join(
        out,
        `${slug}-${testInfo.project.name.replace(/ /g, "-")}.png`,
      ),
    });
    const portrait = page.viewportSize()!;
    await page.setViewportSize({
      width: portrait.height,
      height: portrait.width,
    });
    await expect
      .poll(async () =>
        dialog.evaluate((e) => ({
          horizontalOverflow: e.scrollWidth > e.clientWidth + 1,
          tooTall: e.getBoundingClientRect().height > innerHeight,
        })),
      )
      .toEqual({ horizontalOverflow: false, tooTall: false });
    await field.scrollIntoViewIfNeeded();
    await expect(field).toBeVisible();
    await page.screenshot({
      path: path.join(
        out,
        `${slug}-${testInfo.project.name.replace(/ /g, "-")}-landscape.png`,
      ),
    });
    await page.setViewportSize(portrait);
    await dialog.getByRole("button", { name: "Close", exact: true }).tap();
    await expect(allowance).toHaveValue("1500");
    await expect(registration).toHaveValue(reply.history.registration);
    await expect(opener).toBeFocused();
    await opener.tap();
    mode = "not-found";
    await dialog.getByRole("button", { name: "Check MOT", exact: true }).tap();
    await expect(dialog.getByRole("alert")).toContainText(
      "No MOT history was found",
    );
    await expect(dialog.getByText(/Latest test:/)).toHaveCount(0);
    mode = "unavailable";
    await dialog.getByRole("button", { name: "Check MOT", exact: true }).tap();
    await expect(dialog.getByRole("alert")).toContainText(
      "temporarily unavailable",
    );
    await expect(
      dialog.getByRole("button", { name: "Check MOT", exact: true }),
    ).toBeEnabled();
    await dialog.getByRole("button", { name: "Close", exact: true }).tap();
    // Discard the in-memory form, exercising the unsaved guard without a backend write.
    await page
      .getByRole("button", { name: "Back to sales", exact: true })
      .tap();
    await expect(
      page.getByRole("button", { name: "New invoice", exact: true }),
    ).toBeVisible();
    mode = "available";
    const quickActions = page.getByRole("button", {
      name: "Quick actions",
      exact: true,
    });
    await quickActions.tap();
    await page.getByRole("menuitem", { name: "Check MOT", exact: true }).tap();
    await dialog
      .getByRole("textbox", { name: "Registration number", exact: true })
      .fill(reply.history.registration);
    await dialog.getByRole("button", { name: "Check MOT", exact: true }).tap();
    await expect(dialog.getByText(/Latest test:/)).toBeVisible();
    await dialog.getByRole("button", { name: "Close", exact: true }).tap();
    await expect(quickActions).toBeFocused();
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
    await writeFile(
      path.join(
        out,
        `${slug}-${testInfo.project.name.replace(/ /g, "-")}.json`,
      ),
      JSON.stringify(
        {
          dealer: settings.identity.name,
          device: testInfo.project.name,
          viewport: page.viewportSize(),
          engine: "webkit",
          metrics,
          motCalls,
          writes,
          errors,
          invoiceSaved: false,
        },
        null,
        2,
      ),
    );
  });
