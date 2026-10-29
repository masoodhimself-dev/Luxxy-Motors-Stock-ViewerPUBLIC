import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Car, StockData } from "../src/lib/stock-context";
import { defaultBookingSettings } from "../src/lib/test-drive-dates";

const fixtureFolder = process.env.MOT_AUDIT_FIXTURES;
const output = process.env.PORTAL_CARS_OUTPUT;
test.skip(
  !fixtureFolder || process.env.LUXXY_LOCAL_PREVIEW !== "1",
  "Local read-only preview with public dealer snapshots only.",
);

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(page.viewportSize()!.width);
}
async function contained(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width + 1,
  );
  expect(box!.y + box!.height).toBeLessThanOrEqual(
    page.viewportSize()!.height + 1,
  );
}
async function capture(page: Page, name: string) {
  if (!output) return;
  await mkdir(output, { recursive: true });
  await page.screenshot({
    path: path.join(output, `${name}.png`),
    animations: "disabled",
  });
}
function actor(info: TestInfo) {
  return (locator: Locator) =>
    info.project.use.hasTouch ? locator.tap() : locator.click();
}

async function setup(
  page: Page,
  source: "shore" | "multi",
  options: { booking?: boolean; feature?: boolean } = {},
) {
  const load = async (suffix: string) =>
    JSON.parse(
      await readFile(
        path.join(fixtureFolder!, `${source}-public-${suffix}.json`),
        "utf8",
      ),
    );
  const stock = (await load("stock")) as StockData;
  const settings = await load("settings");
  settings.testDriveBooking = {
    ...defaultBookingSettings,
    enabled: options.booking !== false,
  };
  // Public stock fields remain genuine. Only photos/status of a second fixture car are deterministic.
  stock.cars = stock.cars.map((car, index) => ({
    ...car,
    inventoryStatus: index === 1 ? "reserved" : "available",
    heroImage: "/src/assets/demo-car-hero.jpg?photo=1",
    images: [1, 2, 3].map((n) => `/src/assets/demo-car-hero.jpg?photo=${n}`),
    imageCount: 3,
  }));
  stock.count = stock.cars.length;
  const first = stock.cars[0],
    now = Date.now();
  const entry = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    reference: `CARS-EXAMPLE-${id}`,
    dealerId: "synthetic-cars-browser",
    customerName: `Example customer ${id}`,
    email: `${id}@example.test`,
    phone: "07700900123",
    vehicleId: first.id,
    vehicleTitle: first.title,
    vehicleRegistration: first.plate,
    vehiclePrice: first.price,
    vehicleUrl: `/vehicle/${first.id}`,
    status: "new",
    type: "general",
    source: "phone",
    preferredContact: "phone",
    message: "Synthetic read-only browser fixture. This record is never saved.",
    staffNote: "",
    assignedToId: null,
    assignedToName: null,
    callOutcome: null,
    attendance: "scheduled",
    workspaceRevision: 1,
    appointmentRevision: 1,
    followUpRevision: 1,
    appointmentAt: null,
    appointmentStatus: null,
    appointmentCancelledAt: null,
    followUpAt: null,
    followUpNote: null,
    followUpCompletedAt: null,
    createdAt: new Date(now - 86_400_000).toISOString(),
    updatedAt: new Date(now).toISOString(),
    events: [],
    ...extra,
  });
  const enquiries = [
    entry("case-a"),
    entry("merged-b", {
      mergedIntoId: "case-a",
      mergedAt: new Date(now).toISOString(),
    }),
    entry("booking-c", {
      type: "viewing",
      appointmentAt: new Date(now + 86_400_000).toISOString(),
      appointmentStatus: "confirmed",
    }),
  ];
  const writes: string[] = [],
    motReads: string[] = [],
    errors: string[] = [],
    apiReads: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => void dialog.accept());
  await page.route("**/*", (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (!["GET", "HEAD"].includes(request.method())) {
      writes.push(`${request.method()} ${url.pathname}`);
      return route.abort();
    }
    if (url.origin !== "http://127.0.0.1:4285") return route.abort();
    const pathname = url.pathname;
    if (!pathname.startsWith("/api/")) return route.continue();
    apiReads.push(pathname);
    if (pathname.endsWith("/mot-history")) {
      motReads.push(pathname);
      return route.fulfill({
        json: {
          status: "registration_missing",
          message:
            "Registration not supplied. Ask the customer for the registration before checking MOT history.",
        },
      });
    }
    if (pathname === "/api/stock") return route.fulfill({ json: stock });
    if (pathname === "/api/dealer-settings")
      return route.fulfill({ json: settings });
    if (pathname === "/api/features")
      return route.fulfill({
        json: {
          evaluatedAt: new Date().toISOString(),
          features: {
            testDriveBookings: options.feature !== false,
            testDriveDeclarations: true,
            customerEmails: true,
            publicEnquiries: true,
            partExchange: true,
          },
        },
      });
    if (pathname === "/api/portal/session")
      return route.fulfill({
        json: {
          state: "allowed",
          name: "Browser reviewer",
          email: "reviewer@example.test",
        },
      });
    if (pathname === "/api/staff/access")
      return route.fulfill({
        json: {
          role: "owner",
          permissions: ["sales.manage", "settings.publish"],
          user: {
            authUserId: "cars-reviewer",
            name: "Browser reviewer",
            email: "reviewer@example.test",
          },
        },
      });
    if (pathname === "/api/staff/directory")
      return route.fulfill({
        json: {
          currentUserId: "cars-reviewer",
          members: [{ id: "cars-reviewer", name: "Browser reviewer" }],
        },
      });
    if (pathname === "/api/enquiries")
      return route.fulfill({ json: enquiries });
    if (pathname === "/api/staff/email/reply-attention")
      return route.fulfill({ json: { enquiries: [] } });
    if (pathname === "/api/test-drive-bookings")
      return route.fulfill({
        json: enquiries.filter((e) => e.type === "viewing"),
      });
    if (pathname === "/api/sale-workspace")
      return route.fulfill({
        json: { sales: [], hasMore: false, nextOffset: null, preview: true },
      });
    if (pathname === "/api/sale-workspace/paperwork")
      return route.fulfill({
        json: {
          correctionSettings: {
            handling: "accountant",
            instructions: "Contact your accountant.",
          },
        },
      });
    if (pathname === "/api/sales") return route.fulfill({ json: [] });
    if (pathname === "/api/enquiries/availability") {
      const date = url.searchParams.get("date");
      return route.fulfill({
        json: {
          date,
          timezone: "Europe/London",
          slots: ["10:00", "11:00", "13:00"].map((label) => ({
            label,
            startAt: `${date}T${label}:00.000Z`,
            available: true,
          })),
        },
      });
    }
    if (pathname === "/api/recent-handovers")
      return route.fulfill({ json: { schemaVersion: 1, handovers: [] } });
    if (pathname === "/api/chat/config")
      return route.fulfill({
        json: {
          settings: { enabled: false },
          availability: { staffOnline: false },
          dealerName: settings.identity.name,
        },
      });
    // No API request is forwarded to a service or production environment.
    return route.fulfill({
      status: 404,
      json: { error: `No read-only browser fixture for ${pathname}` },
    });
  });
  return { stock, first, settings, writes, motReads, errors, apiReads };
}

for (const source of ["shore", "multi"] as const) {
  test(`${source}: Cars finder, details, booking handoff and unsaved sale work without writes`, async ({
    page,
  }, info) => {
    const activate = actor(info),
      audit = await setup(page, source);
    await page.goto("/portal?section=cars");
    const list = page.getByRole("list", { name: "Current cars", exact: true });
    await expect(list).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    const nav = page.getByRole("navigation", { name: "Portal sections" });
    expect(await nav.getByRole("button").allTextContents()).toEqual([
      "Inbox",
      "Cars",
      "Sales",
      "Settings",
    ]);
    const navBox = (await nav.boundingBox())!;
    for (const button of await nav.getByRole("button").all()) {
      const box = (await button.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
      expect(box.y).toBeLessThanOrEqual(navBox.y + navBox.height);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await noOverflow(page);
    const row = page.getByTestId(`portal-car-${audit.first.id}`);
    await expect(row).toContainText(audit.first.make!);
    await expect(row).toContainText(String(audit.first.year));
    await expect(row).toContainText(audit.first.fuel!);
    await expect(row).toContainText(audit.first.transmission!);
    await expect(row.getByText("2 enquiries", { exact: true })).toBeVisible();
    const customers = row.getByRole("list", { name: "Customer enquiries" });
    await expect(customers.getByRole("link")).toHaveCount(2);
    await expect(
      customers.getByRole("link", { name: /Example customer case-a/ }),
    ).toHaveAttribute(
      "href",
      "/portal?section=notifications&workView=customers&enquiryId=case-a",
    );
    await expect(
      customers.getByRole("link", { name: /Example customer booking-c/ }),
    ).toHaveAttribute(
      "href",
      "/portal?section=notifications&workView=customers&enquiryId=booking-c",
    );
    await expect(
      customers.getByRole("link", { name: /Example customer merged-b/ }),
    ).toHaveCount(0);
    await expect(row).toContainText("Next test drive");
    await expect(row).not.toContainText("Loading customer activity");
    expect(audit.motReads).toEqual([]);
    await capture(page, `${source}-${info.project.name}-cars`);

    const search = page.getByRole("searchbox", { name: "Search current cars" });
    for (const control of [
      search,
      page.getByRole("combobox", { name: "Sort cars" }),
    ]) {
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(
        await control.evaluate((el) => getComputedStyle(el).fontSize),
      ).toBe("16px");
    }
    expect(
      await search.evaluate((el) =>
        parseFloat(getComputedStyle(el).paddingLeft),
      ),
    ).toBeGreaterThanOrEqual(40);
    await search.fill("no such vehicle zxqv");
    await expect(
      page.getByText("No matching cars", { exact: true }),
    ).toBeVisible();
    await activate(
      page.getByRole("button", {
        name: "Clear search and filters",
        exact: true,
      }),
    );
    await expect(search).toHaveValue("");
    await activate(
      page
        .getByRole("group", { name: "Availability" })
        .getByRole("button", { name: /^Reserved/ }),
    );
    await expect(list.locator(".portal-car-row")).toHaveCount(1);
    await expect(list).toContainText("Reserved");
    await activate(
      page
        .getByRole("group", { name: "Availability" })
        .getByRole("button", { name: /^All current/ }),
    );
    await page
      .getByRole("combobox", { name: "Sort cars" })
      .selectOption("price-desc");
    const expensive = [...audit.stock.cars]
      .filter((c) => c.price != null)
      .sort((a, b) => b.price! - a.price!)[0];
    await expect(list.locator(".portal-car-row").first()).toHaveAttribute(
      "data-testid",
      `portal-car-${expensive.id}`,
    );
    await page
      .getByRole("combobox", { name: "Sort cars" })
      .selectOption("stock");
    await search.fill(audit.first.make!);
    const detailsOpener = row.locator(".portal-car-identity");
    await detailsOpener.scrollIntoViewIfNeeded();
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await activate(detailsOpener);
    const panel = page.locator(".staff-vehicle-panel");
    await expect(panel).toBeVisible();
    await contained(page, panel);
    await expect(
      panel.getByRole("heading", { name: "At a glance", exact: true }),
    ).toBeVisible();
    await expect(panel).toContainText(audit.first.make!);
    await expect(panel).toContainText("History & condition");
    expect(audit.motReads).toEqual([]);
    await activate(
      panel.locator("summary").filter({ hasText: /^MOT history$/ }),
    );
    await activate(
      panel.getByRole("button", { name: "View MOT history", exact: true }),
    );
    await expect(
      panel.getByText(/Registration not supplied\. Ask/),
    ).toBeVisible();
    expect(audit.motReads).toHaveLength(1);
    await capture(page, `${source}-${info.project.name}-details`);
    await activate(panel.getByRole("button", { name: "Close", exact: true }));
    await expect(panel).toHaveCount(0);
    await expect(detailsOpener).toBeFocused();
    await expect(search).toHaveValue(audit.first.make!);
    expect(
      Math.abs((await page.evaluate(() => window.scrollY)) - scrollBefore),
    ).toBeLessThanOrEqual(2);

    await activate(row.getByRole("button", { name: /^More options for / }));
    await activate(
      page.getByRole("menuitem", { name: "Book test drive", exact: true }),
    );
    const enquiry = page.getByRole("dialog", {
      name: "Quick enquiry",
      exact: true,
    });
    await expect(enquiry).toBeVisible();
    await contained(page, enquiry);
    await expect(
      enquiry.getByRole("article", { name: "Selected car" }),
    ).toContainText(audit.first.make!);
    await expect(
      enquiry.getByRole("checkbox", { name: "Book a Test Drive", exact: true }),
    ).toBeChecked();
    await capture(page, `${source}-${info.project.name}-booking-handoff`);
    await activate(
      enquiry.getByRole("button", { name: "Cancel", exact: true }),
    );
    await expect(enquiry).toHaveCount(0);
    await expect(row).toBeVisible();
    await activate(row.getByRole("button", { name: /^More options for / }));
    await activate(
      page.getByRole("menuitem", { name: "Start sale", exact: true }),
    );
    await expect(
      page.getByRole("heading", {
        name: "Vehicle & agreed price",
        exact: true,
      }),
    ).toBeVisible();
    const chooser = page.getByRole("region", {
      name: "Vehicle selection",
      exact: true,
    });
    await expect(chooser).toContainText(audit.first.make!);
    await expect(
      page.getByRole("textbox", {
        name: "Agreed vehicle price (£)",
        exact: true,
      }),
    ).toHaveValue(String(audit.first.price));
    await noOverflow(page);
    const other = audit.stock.cars.find(
      (car, index) =>
        index > 1 && car.id !== audit.first.id && car.price != null,
    )!;
    await chooser
      .getByRole("searchbox", { name: "Search stock vehicles", exact: true })
      .fill(other.model!);
    await activate(chooser.locator(`button[data-vehicle-id="${other.id}"]`));
    await expect(
      page.getByRole("textbox", {
        name: "Agreed vehicle price (£)",
        exact: true,
      }),
    ).toHaveValue(String(other.price));
    await capture(page, `${source}-${info.project.name}-unsaved-sale`);
    expect(audit.writes).toEqual([]);
    expect(audit.errors).toEqual([]);
    if (output)
      await writeFile(
        path.join(output, `${source}-${info.project.name}-checks.json`),
        JSON.stringify(
          {
            viewport: page.viewportSize(),
            source,
            cars: audit.stock.cars.length,
            mergedCaseCount: 2,
            motReads: audit.motReads,
            writes: audit.writes,
            errors: audit.errors,
            apiReads: [...new Set(audit.apiReads)],
          },
          null,
          2,
        ),
      );
  });
}

test("Reserved cars and booking settings keep unsafe shortcuts out of the menu", async ({
  page,
}, info) => {
  const activate = actor(info),
    audit = await setup(page, "multi", { booking: false });
  await page.goto("/portal?section=cars");
  const first = page.getByTestId(`portal-car-${audit.first.id}`);
  await expect(first).toBeVisible();
  await activate(first.getByRole("button", { name: /^More options for / }));
  await expect(
    page.getByRole("menuitem", { name: "Book test drive", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: "Start sale", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  const reserved = page.getByTestId(`portal-car-${audit.stock.cars[1].id}`);
  await activate(reserved.getByRole("button", { name: /^More options for / }));
  await expect(
    page.getByRole("menuitem", { name: "Book test drive", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: "Start sale", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: "Vehicle details", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await activate(
    first.getByRole("button", { name: "New enquiry", exact: true }),
  );
  const enquiry = page.getByRole("dialog", {
    name: "Quick enquiry",
    exact: true,
  });
  await expect(
    enquiry.getByRole("checkbox", { name: "Book a Test Drive", exact: true }),
  ).toBeDisabled();
  await expect(enquiry).toContainText(
    "Test-drive bookings are switched off in Settings",
  );
  await noOverflow(page);
  expect(audit.writes).toEqual([]);
  expect(audit.errors).toEqual([]);
});
