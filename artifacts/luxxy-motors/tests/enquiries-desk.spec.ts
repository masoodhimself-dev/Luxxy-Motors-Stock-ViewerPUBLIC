import { expect, test, type Page } from "@playwright/test";

test.skip(
  process.env.LUXXY_LOCAL_PREVIEW !== "1",
  "Mocked local preview only.",
);
const id = "08e3fe3f-35b3-43d0-8e3e-6ca02991d046";
const car = {
  id,
  advertId: "1234567",
  title: "2019 Ford Focus",
  make: "Ford",
  model: "Focus",
  year: 2019,
  price: 10995,
  transmission: "Manual",
  plate: "AB19 XYZ",
  inventoryStatus: "available",
  heroImage: null,
  images: [],
};
const existing = {
  id: "enquiry-one",
  reference: "CALL-123",
  customerName: "Alex Caller",
  phone: "07700 900123",
  email: null,
  vehicleId: id,
  vehicleTitle: car.title,
  vehicleRegistration: car.plate,
  type: "viewing",
  appointmentAt: "2027-01-05T11:00:00Z",
  appointmentRevision: 0,
  appointmentStatus: "confirmed",
  appointmentCancelledAt: null,
  message: "Please prepare the service history.",
};
async function setup(page: Page) {
  await page.route("**/api/**", (route) =>
    ["GET", "HEAD"].includes(route.request().method())
      ? route.continue()
      : route.abort(),
  );
  await page.route("**/api/stock", (route) =>
    route.fulfill({
      json: {
        schemaVersion: 1,
        count: 2,
        cars: [
          car,
          {
            ...car,
            id: "reserved-car",
            title: "Reserved Ford Fiesta",
            model: "Fiesta",
            inventoryStatus: "reserved",
          },
        ],
      },
    }),
  );
  await page.route("**/api/enquiries", (route) =>
    route.fulfill({ json: [existing] }),
  );
  await page.route("**/api/**/availability?*", (route) =>
    route.fulfill({
      json: {
        date: "2027-01-05",
        timezone: "Europe/London",
        slots: [
          {
            startAt: `${new URL(route.request().url()).searchParams.get("date")}T12:00:00Z`,
            label: "12:00",
            available: true,
          },
        ],
      },
    }),
  );
  await page.goto("/portal");
  await page.getByTestId("tab-enquiries").click();
}
for (const width of [390, 820, 1440]) {
  test(`call desk searches stock and saves a phone-only enquiry at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await setup(page);
    let payload: any;
    await page.route("**/api/staff/enquiries", (route) => {
      payload = route.request().postDataJSON();
      return route.fulfill({
        status: 201,
        json: {
          ...existing,
          ...payload,
          appointmentStatus: null,
          reference: "CALL-NEW",
          source: "phone",
        },
      });
    });
    await page.getByLabel("Search showroom stock").fill("AB19XYZ");
    await page.getByRole("button", { name: /Ford Focus/ }).click();
    await page.getByLabel("Customer name", { exact: true }).fill("New Caller");
    await page.getByLabel("Phone number", { exact: true }).fill("07700 900456");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: `/tmp/luxxy-enquiry-desk-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Save phone enquiry", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("CALL-NEW saved");
    expect(payload).toMatchObject({
      vehicleId: id,
      customerName: "New Caller",
      email: null,
      preferredContact: "phone",
      type: "general",
      appointmentAt: null,
    });
  });
  test(`call desk moves an appointment with its reviewed revision at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await setup(page);
    let payload: any;
    await page.route(
      "**/api/staff/enquiries/enquiry-one/appointment",
      (route) => {
        payload = route.request().postDataJSON();
        return route.fulfill({
          json: {
            ...existing,
            appointmentAt: payload.appointmentAt,
            appointmentRevision: 1,
          },
        });
      },
    );
    await page
      .getByRole("button", { name: "Find enquiry or appointment", exact: true })
      .click();
    await page.getByLabel("Find a customer or car").fill("07700900123");
    await expect(page.getByTestId("enquiry-enquiry-one")).toContainText(
      "Alex Caller",
    );
    await page
      .getByRole("button", { name: "Change appointment", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "12:00", exact: true }).click();
    await page.screenshot({ path: `/tmp/luxxy-enquiry-change-${width}.png` });
    await page
      .getByRole("button", { name: "Save new appointment", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(payload).toEqual({
      action: "reschedule",
      appointmentAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T12:00:00Z$/),
      expectedRevision: 0,
    });
  });
}
test("reserved stock cannot be booked and failed requests retain caller details", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: /Reserved Ford Fiesta/ }).click();
  await page.getByLabel("Book a test drive", { exact: true }).check();
  await expect(
    page.getByRole("button", { name: "Save test-drive booking" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: /Ford Focus/ }).click();
  await page
    .getByLabel("Customer name", { exact: true })
    .fill("Conflict Caller");
  await page.getByLabel("Phone number", { exact: true }).fill("07700900123");
  await page.getByRole("button", { name: "12:00", exact: true }).click();
  await page.route("**/api/staff/enquiries", (route) =>
    route.fulfill({
      status: 409,
      json: { error: "That time has just been booked." },
    }),
  );
  await page.getByRole("button", { name: "Save test-drive booking" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "That time has just been booked.",
  );
  await expect(page.getByLabel("Customer name", { exact: true })).toHaveValue(
    "Conflict Caller",
  );
});
test("cancellation requires a second deliberate action", async ({ page }) => {
  await setup(page);
  let writes = 0;
  await page.route(
    "**/api/staff/enquiries/enquiry-one/appointment",
    (route) => {
      writes++;
      return route.fulfill({
        json: { ...existing, appointmentCancelledAt: new Date().toISOString() },
      });
    },
  );
  await page
    .getByRole("button", { name: "Find enquiry or appointment", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Change appointment", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Cancel appointment instead", exact: true })
    .click();
  expect(writes).toBe(0);
  await page
    .getByRole("button", { name: "Confirm cancellation", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("appointment cancelled");
  expect(writes).toBe(1);
});
