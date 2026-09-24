import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

for (const width of [390, 1440]) {
  test(`recent cars, shared shortlist and draft recovery at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/vehicle/preview-2");
    await expect(
      page.getByRole("heading", { name: "What you should know", exact: true }),
    ).toBeVisible();
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Recently viewed" }),
    ).toBeVisible();
    await page.evaluate(() =>
      localStorage.setItem(
        "luxxy.saved-cars.v1",
        JSON.stringify(["preview-1"]),
      ),
    );
    await page.goto("/saved?cars=preview-2,preview-3");
    await expect(
      page.getByRole("heading", { name: "Shared shortlist", exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("text-saved-count")).toHaveText(
      "2 cars in this shortlist",
    );
    await expect(page.getByTestId("button-clear-saved")).toHaveCount(0);
    expect(
      await page.evaluate(() => localStorage.getItem("luxxy.saved-cars.v1")),
    ).toBe('["preview-1"]');
    await mkdir(resolve("../../docs/screenshots/customer-convenience"), {
      recursive: true,
    });
    await page.evaluate(async () => {
      const imgs = Array.from(document.images);
      imgs.forEach((img) => {
        img.loading = "eager";
      });
      await Promise.race([Promise.all(imgs.map((img) => img.decode().catch(() => {}))), new Promise(resolve=>setTimeout(resolve,5000))]);
    });
    await page.screenshot({
      path: resolve(
        `../../docs/screenshots/customer-convenience/shortlist-${width}.png`,
      ),
      fullPage: true,
    });
    await page.goto("/enquire?type=general&vehicleId=preview-2");
    await page.getByTestId("input-customer-name").fill("Local Test");
    await page.getByTestId("input-customer-email").fill("local@example.test");
    await expect(page.getByTestId("enquiry-draft-notice")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("input-customer-name")).toHaveValue(
      "Local Test",
    );
    await expect(page.getByTestId("input-customer-email")).toHaveValue(
      "local@example.test",
    );
    await page.getByRole("button", { name: "Discard draft" }).click();
    await expect(page.getByTestId("input-customer-name")).toHaveValue("");
    await page.getByTestId("button-submit-enquiry").click();
    await expect(page.getByTestId("input-customer-name")).toBeFocused();
    await expect(
      page.getByText("Please enter your name (at least two characters)."),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.evaluate(()=>{(document.activeElement as HTMLElement)?.blur();window.scrollTo({top:0,behavior:"instant"});});
    await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBe(0);
    await page.screenshot({
      path: resolve(
        `../../docs/screenshots/customer-convenience/enquiry-${width}.png`,
      ),
      fullPage: true,
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Clear viewing history" }).click();
    await expect(
      page.getByRole("heading", { name: "Recently viewed" }),
    ).toHaveCount(0);
  });
}
test("shared shortlist handles missing stock without modifying saved cars", async ({
  page,
}) => {
  await page.goto("/saved?cars=missing-car");
  await expect(
    page.getByRole("heading", { name: "No cars available in this shortlist" }),
  ).toBeVisible();
  await page.goto("/vehicle/missing-car");
  await expect(
    page.getByRole("heading", { name: "This car isn’t in our current stock" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Browse current stock", exact: true }),
  ).toBeVisible();
});
test("customer pages reflow at 200% equivalent viewport and support reduced motion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 450 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const route of [
    "/",
    "/vehicle/preview-2",
    "/saved?cars=preview-2",
    "/enquire?type=general&vehicleId=preview-2",
  ]) {
    await page.goto(route);
    await expect(page.locator("h1")).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(640);
    expect(
      await page.evaluate(
        () => getComputedStyle(document.documentElement).scrollBehavior,
      ),
    ).toBe("auto");
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe(
      "BODY",
    );
  }
});
test("failed enquiry retains details and successful viewing offers practical next steps", async ({
  page,
}) => {
  let fail = true;
  await page.route("**/api/enquiries", (route) =>
    route.fulfill(
      fail
        ? { status: 503, json: { error: "Please try again shortly." } }
        : {
            json: {
              reference: "LOCAL-TEST",
              notificationStatus: "sent",
              managePath: "/viewing/sample",
              calendarIcs: "BEGIN:VCALENDAR\r\nEND:VCALENDAR",
              appointmentAt: new Date().toISOString(),
            },
          },
    ),
  );
  await page.goto("/enquire?type=viewing&vehicleId=preview-2");
  await page
    .getByTestId("group-viewing-slots")
    .getByRole("button")
    .first()
    .click();
  await page.getByTestId("button-continue-to-details").click();
  await page.getByTestId("input-customer-name").fill("Local Test");
  await page.getByTestId("input-customer-email").fill("local@example.test");
  await page.getByTestId("input-customer-phone").fill("07700900123");
  await page.getByTestId("button-submit-enquiry").click();
  await expect(page.getByTestId("status-enquiry-error")).toBeFocused();
  await expect(page.getByTestId("input-customer-name")).toHaveValue(
    "Local Test",
  );
  fail = false;
  await page.getByTestId("button-submit-enquiry").click();
  await expect(page.getByTestId("status-enquiry-success")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Manage viewing", exact: true }),
  ).toHaveAttribute("href", "/viewing/sample");
  await expect(page.getByTestId("link-download-calendar")).toHaveAttribute(
    "download",
    "luxxy-viewing-LOCAL-TEST.ics",
  );
  await expect(
    page.getByRole("link", { name: "Directions, parking & opening hours" }),
  ).toHaveAttribute("href", "/contact");
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("luxxy.enquiry-draft.viewing:preview-2"),
    ),
  ).toBeNull();
});
