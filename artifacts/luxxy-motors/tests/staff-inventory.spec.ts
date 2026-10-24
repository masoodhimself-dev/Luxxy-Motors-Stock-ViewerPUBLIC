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
  year:2019,mileage:32000,fuel:'Petrol',transmission:'Manual',variant:'1.0 EcoBoost Titanium',trim:'Titanium',body_type:'Hatchback',colour:'Blue',engine_size:'1.0L',doors:5,seats:5,
  plate: "AB19 XYZ",
  inventory_status: "available",
  source_status: "live",
  service_photo_count: 0,
  tasks: null,
  enquiry_count: 3,
  upcoming_test_drive_count: 1,
  next_test_drive_at: '2026-10-26T14:30:00Z',
  stock_changes: { checkedAt:'2026-10-24T09:00:00Z', items:[
    { kind:'price',changedAt:'2026-10-24T09:00:00Z',previousPrice:11995,currentPrice:10995 },
    { kind:'photos',changedAt:'2026-10-24T09:00:00Z',previousPhotoCount:12,currentPhotoCount:15 },
    { kind:'details',changedAt:'2026-10-24T09:00:00Z',fields:['Description','Mileage'] },
  ] },
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
  test(`staff inventory opens clear car sections and a scoped QR at ${width}`, async ({
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
          user: { authUserId:'fictional-owner', name: "Test owner" },
        },
      }),
    );
    await page.route("**/api/staff/inventory", (r) =>
      r.fulfill({ json: { dealerId:'fictional-dealer', cars: [car] } }),
    );
    await page.route(`**/api/staff/inventory/${id}`, (r) =>
      r.fulfill({ json: { dealerId:'fictional-dealer', car, preparation: prep, photos: [] } }),
    );
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
    await expect(page.getByRole("combobox", { name: "Preparation" })).toHaveCount(0);
    await expect(page.getByRole("progressbar")).toHaveCount(0);
    const row=page.locator('.inventory-car').first();
    await expect(row.getByText('Blue',{exact:true})).toBeVisible();
    await expect(row.getByText('32,000 miles',{exact:true})).toBeVisible();
    await expect(row.getByText('1.0 EcoBoost Titanium',{exact:true})).toBeVisible();
    await expect(row.getByText('3 open enquiries',{exact:true})).toBeVisible();
    await expect(row.getByText('1 upcoming test drive',{exact:true})).toBeVisible();
    await expect(row.getByText('Price reduced: £11,995 → £10,995',{exact:true})).toBeVisible();
    await page.getByRole("button", { name: "Open Ford Focus, AB19 XYZ", exact: true }).click();
    await expect(page.getByRole("button", { name: "Photos & video", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Save preparation" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Private photos" })).toBeVisible();
    await page.getByRole("button", { name: "Upload from phone" }).click();
    await expect(
      page.getByRole("link", { name: "Open upload page on this device" }),
    ).toHaveAttribute("href", /staff-upload#fictional-upload-token/);
    await page.getByRole("button", { name: "Customers", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Private photos" })).toBeHidden();
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
    await page.getByRole('button',{name:'Back to cars',exact:true}).click();
    const recent=page.getByRole('navigation',{name:'Recently viewed cars'});
    await expect(recent).toBeVisible();
    await expect(recent.getByRole('button',{name:'Reopen Ford Focus, AB19 XYZ'})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({path:`/tmp/luxxy-cars-updates-${width}.png`,fullPage:true});
    await recent.getByRole('button',{name:'Clear recent cars'}).click();
    await expect(recent).toHaveCount(0);
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
