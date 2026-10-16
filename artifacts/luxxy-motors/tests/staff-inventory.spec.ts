import { test, expect } from "@playwright/test";
import { serviceBookJpeg } from "../../api-server/src/lib/service-book-jpeg";
test.skip(
  process.env.LUXXY_LOCAL_PREVIEW !== "1",
  "Fictional local preview only",
);
const id = "08e3fe3f-35b3-43d0-8e3e-6ca02991d046";
const car = {
  id,
  title: "2019 Ford Focus",
  display_title: "2019 Ford Focus",
  price: 10995,
  plate: "AB19 XYZ",
  inventory_status: "available",
  source_status: "live",
  service_photo_count: 0,
  tasks: null,
};
const prep = {
  revision: 0,
  tasks: {
    cleaning: "pending",
    inspection: "pending",
    mot: "pending",
    servicing: "pending",
  },
  assigned_to_id: null,
  due_date: null,
  notes: "",
};
for (const width of [390, 820, 1440])
  test(`staff inventory opens a car, preparation and a scoped QR at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 });
    await page.route("**/api/**", (r) =>
      ["GET", "HEAD"].includes(r.request().method()) ? r.continue() : r.abort(),
    );
    await page.route("**/api/staff/access", (r) =>
      r.fulfill({
        json: {
          role: "owner",
          permissions: ["sales.manage", "settings.publish"],
          user: { name: "Test owner" },
        },
      }),
    );
    await page.route("**/api/staff/inventory", (r) =>
      r.fulfill({ json: { cars: [car] } }),
    );
    let preparation = { ...prep };
    await page.route(`**/api/staff/inventory/${id}`, (r) =>
      r.fulfill({ json: { car, preparation, photos: [] } }),
    );
    await page.route(`**/api/staff/inventory/${id}/preparation`, (r) => {
      const b = r.request().postDataJSON();
      expect(b.tasks.cleaning).toBe("done");
      preparation = {
        ...preparation,
        revision: 1,
        tasks: b.tasks,
        notes: b.notes,
      };
      return r.fulfill({ json: { saved: true } });
    });
    await page.route(`**/api/staff/inventory/${id}/upload-session`, (r) =>
      r.fulfill({
        status: 201,
        json: {
          id: "fictional-session",
          url: "http://127.0.0.1:4175/staff-upload#fictional-upload-token",
          expiresAt: "2027-01-01T12:00:00Z",
        },
      }),
    );
    await page.goto("/portal?section=inventory");
    await page.getByRole("button", { name: /2019 Ford Focus/ }).click();
    await expect(
      page.getByRole("heading", { name: "Private vehicle photos" }),
    ).toBeVisible();
    await page.getByLabel("Cleaning & presentation").selectOption("done");
    await page.getByRole("button", { name: "Save preparation" }).click();
    await expect(page.getByRole("status")).toContainText("Preparation saved");
    await page.getByRole("button", { name: "Upload from phone" }).click();
    await expect(
      page.getByRole("link", { name: "Open upload page on this device" }),
    ).toHaveAttribute("href", /staff-upload#fictional-upload-token/);
    await expect(
      page.getByRole("link", { name: "Open vehicle activity" }),
    ).toHaveAttribute(
      "href",
      `/portal?section=history&view=vehicles&vehicleId=${id}`,
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: `/tmp/staff-inventory-${width}.png`,
      fullPage: true,
    });
  });
test("phone QR upload compresses and reviews actual pixels, sends no EXIF or token URL, and stops after success", async ({
  page,
}) => {
  const token = "fictional-phone-grant";
  await page.addInitScript(() => Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true }));
  let posts = 0;
  await page.route("**/api/service-book-upload", async (r) => {
    expect(r.request().headers()["x-service-upload-token"]).toBe(token);
    expect(r.request().url()).not.toContain(token);
    if (r.request().method() === "GET")
      return r.fulfill({
        json: {
          title: "2019 Ford Focus",
          registration: "AB19 XYZ",
          remaining: 3,
          expiresAt: "2027-01-01T12:00:00Z",
          completed: false,
        },
      });
    posts++;
    const b = r.request().postDataJSON();
    expect(b.photos).toHaveLength(1);
    const p = serviceBookJpeg(b.photos[0]);
    expect(p.bytes.length).toBeLessThanOrEqual(512000);
    expect(Math.max(p.width, p.height)).toBe(1600);
    return r.fulfill({
      status: 201,
      json: { uploaded: ["photo-one"], replayed: false },
    });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/staff-upload#" + token);
  await expect(
    page.getByRole("heading", { name: "2019 Ford Focus" }),
  ).toBeVisible();
  expect(page.url()).not.toContain(token);
  const data = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 2400;
    c.height = 1800;
    const x = c.getContext("2d")!;
    x.fillStyle = "#fff";
    x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = "#222";
    x.font = "60px sans-serif";
    x.fillText("Fictional service book: 42,000 miles", 100, 200);
    return c.toDataURL("image/png").split(",")[1];
  });
  await page
    .getByLabel("Choose service-book photos")
    .setInputFiles({
      name: "fictional-service.png",
      mimeType: "image/png",
      buffer: Buffer.from(data, "base64"),
    });
  await expect(
    page.getByRole("img", { name: "Service-book page 1 for review" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Upload 1 photo" }).click();
  await expect(
    page.getByRole("heading", { name: "Photos received" }),
  ).toBeVisible();
  expect(posts).toBe(1);
  await expect(
    page.getByRole("button", { name: "Upload 1 photo" }),
  ).toHaveCount(0);
});
