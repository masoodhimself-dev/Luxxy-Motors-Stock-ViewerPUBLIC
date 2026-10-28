import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
for (const form of ["enquiry", "valuation", "booking"])
  test(`${form}: identifies car, fills estimate and keeps customer edits`, async ({
    page,
    request,
  }, info) => {
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
      if (url.pathname === "/api/mot-mileage-estimate")
        return route.fulfill({
          json: {
            status: "estimated",
            registration: "AB12CDE",
            vehicle: { make: "FORD", model: "FOCUS" },
            estimate: { mileage: 65000 },
          },
        });
      if (url.pathname === "/api/enquiries/availability") {
        const date = url.searchParams.get("date");
        return route.fulfill({
          json: {
            date,
            timezone: "Europe/London",
            slots: [
              {
                startAt: `${date}T12:00:00Z`,
                label: "12:00 pm",
                available: true,
              },
            ],
          },
        });
      }
      return route.continue();
    });
    const stock = await (await request.get("/api/stock")).json(),
      car = stock.cars[0];
    const target =
      form === "vehicle"
        ? `/vehicle/${car.id}`
        : `/enquire?type=${form === "valuation" ? "part_exchange" : form === "booking" ? "viewing" : "general"}&vehicleId=${car.id}`;
    await page.goto(target);
    if (form === "booking") {
      await page
        .getByTestId("group-viewing-slots")
        .getByRole("button")
        .first()
        .click();
      await page.getByTestId("button-continue-to-details").click();
    }
    if (form === "enquiry" || form === "booking")
      await page
        .getByRole("button", {
          name: "Add a part exchange (optional)",
          exact: true,
        })
        .click();
    const reg =
      form === "vehicle"
        ? page.locator("#vehicle-exchange-registration")
        : form === "valuation"
          ? page.getByTestId("input-part-exchange-registration")
          : page.getByTestId("enquiry-part-exchange-plate-input");
    const mileage =
      form === "vehicle"
        ? page.locator("#vehicle-exchange-mileage")
        : form === "valuation"
          ? page.getByTestId("input-part-exchange-mileage")
          : page.getByRole("spinbutton", {
              name:
                form === "booking"
                  ? "Approximate mileage"
                  : "Current mileage (miles)",
              exact: true,
            });
    await reg.fill("AB12 CDE");
    await expect(mileage).toHaveValue("65000");
    await expect(
      page.getByRole("status").filter({ hasText: "FORD FOCUS" }),
    ).toContainText("Estimated 65,000");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (process.env.MOT_MILEAGE_OUTPUT) {
      await mkdir(process.env.MOT_MILEAGE_OUTPUT, { recursive: true });
      await mileage.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(
          process.env.MOT_MILEAGE_OUTPUT,
          `${form}-${info.project.name}.png`,
        ),
      });
    }
    await mileage.fill("65432");
    await expect(mileage).toHaveValue("65432");
    await expect(
      page.getByRole("status").filter({ hasText: "Estimated 65,000" }),
    ).toHaveCount(0);
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
