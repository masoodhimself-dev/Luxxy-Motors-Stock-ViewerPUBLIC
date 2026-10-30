import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { staffMotSummary } from "@workspace/vehicle-meta";
const ids = [1, 2, 3, 4].map((i) => `10000000-0000-4000-8000-00000000000${i}`);
for (const source of ["cazoo", "autotrader"])
  test(`${source}: staff Cars workflows`, async ({ page }, info) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    const now = new Date().toISOString(),
      reads: string[] = [],
      writes: string[] = [];
    const quickExpiry = new Date(Date.now() + 30 * 86400000)
      .toISOString()
      .slice(0, 10);
    const history = {
      registration: "AB12CDE",
      make: "Toyota",
      model: "Yaris",
      checkedAt: now,
      recall: "Unknown",
      tests: [
        {
          completedDate: "2026-04-01T10:00:00Z",
          result: "PASSED",
          expiryDate: "2027-08-01",
          mileage: "42000",
          mileageUnit: "MI",
          defects: [],
        },
      ],
    };
    const base = {
      advertId: "AETV1",
      title: "Toyota Yaris",
      make: "Toyota",
      model: "Yaris",
      variant: "1.5 Hybrid Excel Automatic",
      year: 2021,
      price: 8990,
      currency: "GBP",
      mileage: 42000,
      plate: "AB12 CDE",
      vrm: "AB12CDE",
      vrmVerified: true,
      fuel: "Petrol Hybrid",
      transmission: "Automatic",
      bodyType: "Hatchback",
      colour: "Grey",
      heroImage: "/showroom-car.jpg",
      images: [{ url: "/showroom-car.jpg", caption: "Front view" }],
      sourceExtras: {
        description: "A practical family car with automatic transmission.",
      },
      specifications: null,
      inventoryStatus: "available",
    };
    const meta = {
      source,
      sourceStatus: "live",
      inventoryStatus: "available",
      published: true,
      firstSeenAt: "2026-09-01T12:00:00Z",
      lastSeenAt: now,
      archivedAt: null,
      mot: staffMotSummary(null),
      changes: [],
      sale: null,
    };
    const cars = [
      {
        ...base,
        id: ids[0],
        staff: {
          ...meta,
          mot: {
            state: "due",
            tone: "amber",
            label: "MOT due",
            date: "2027-02-01",
            checkedAt: now,
            lastMileage: "42,000 miles",
          },
          changes: [
            {
              kind: "price",
              label: "Price reduced",
              at: now,
              before: 9500,
              after: 8990,
            },
          ],
        },
      },
      {
        ...base,
        id: ids[1],
        title: "Volvo V90",
        make: "Volvo",
        model: "V90",
        plate: "CD25EFG",
        price: 14990,
        inventoryStatus: "reserved",
        staff: {
          ...meta,
          inventoryStatus: "reserved",
          mot: {
            state: "first_due",
            tone: "green",
            label: "First MOT due",
            date: "2028-03-01",
            checkedAt: now,
            lastMileage: null,
          },
        },
      },
      {
        ...base,
        id: ids[2],
        title: "Ford Focus",
        make: "Ford",
        model: "Focus",
        inventoryStatus: "sold",
        staff: {
          ...meta,
          inventoryStatus: "sold",
          published: false,
          sale: {
            id: "20000000-0000-4000-8000-000000000001",
            reference: "SALE-1",
            status: "sold",
          },
        },
      },
      {
        ...base,
        id: ids[3],
        title: "Audi A1",
        make: "Audi",
        model: "A1",
        staff: { ...meta, sourceStatus: "missing", published: false },
      },
    ];
    const entries = [
      {
        id: "30000000-0000-4000-8000-000000000001",
        reference: "ENQ-1",
        vehicleId: ids[0],
        customerName: "Amelia Buyer",
        phone: "07700900123",
        email: "buyer@example.test",
        type: "general",
        source: "website",
        status: "new",
        message: "I am interested in this Toyota.",
        createdAt: now,
        updatedAt: now,
      },
    ];
    await page.route("**/api/**", async (route) => {
      const req = route.request(),
        p = new URL(req.url()).pathname;
      if (!["GET", "HEAD"].includes(req.method())) {
        writes.push(p);
        return route.fulfill({
          status: 409,
          json: { error: "Read-only browser review" },
        });
      }
      reads.push(p);
      if (p === "/api/staff/cars")
        return route.fulfill({
          json: {
            cars,
            feed: {
              source: source === "cazoo" ? "Official Cazoo CSV" : "Auto Trader",
              receivedAt: now,
              appliedAt: now,
              state: "current",
              scheduled: source === "cazoo",
            },
          },
        });
      if (p === "/api/stock")
        return route.fulfill({
          json: {
            schemaVersion: 1,
            count: 2,
            cars: cars.slice(0, 2),
            scrapedAt: now,
            dealerName: "Review Motors",
            dealerLocation: "London",
          },
        });
      if (p === "/api/enquiries") return route.fulfill({ json: entries });
      if (p === "/api/staff/email/reply-attention")
        return route.fulfill({ json: { enquiries: [] } });
      if (p.endsWith("/mot-history"))
        return route.fulfill({
          json: {
            status: "available",
            history:
              reads.filter((p) => p.endsWith("/mot-history")).length > 1
                ? {
                    ...history,
                    tests: history.tests.map((t) => ({
                      ...t,
                      expiryDate: quickExpiry,
                    })),
                  }
                : history,
          },
        });
      return route.continue();
    });
    await page.route("**/api/demo-status", route => route.fulfill({json: {demo: true}}));
    await page.goto("/portal?section=cars");
    const list = page.getByRole("list", { name: "Current cars", exact: true });
    await expect(list.locator(":scope > li")).toHaveCount(2);
    await expect(page.getByText(/^MOT due ·/)).toBeVisible();
    await expect(page.getByText(/First MOT due ·/)).toBeVisible();
    expect(reads.filter((p) => p.endsWith("/mot-history"))).toHaveLength(0);
    const overflow = async () => {
      // Dynamic route styles can settle after the first React paint.
      // Persistent overflow must fail; do not hide it with clipping.
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth), {
          timeout: 5000,
          message: "Cars fits the viewport after styles settle",
        })
        .toBeLessThanOrEqual(page.viewportSize()!.width);
    };
    await overflow();
    await expect(page.getByText("Preview website", {exact: true})).toHaveCount(0);
    await expect(page.locator(".cars-feed-line")).toHaveCount(0);
    const firstActions = list.locator(":scope > li").first().locator(".portal-car-actions");
    await expect(firstActions.getByRole("button", {name: "New enquiry", exact: true})).toBeVisible();
    await expect(firstActions.getByRole("button", {name: "Start sale", exact: true})).toBeVisible();
    const output = process.env.CARS_REDESIGN_OUTPUT;
    if (output) {
      await mkdir(output, { recursive: true });
      await page.screenshot({
        path: path.join(output, `${source}-${info.project.name}-list.png`),
      });
    }
    const options = page.getByRole("button", {
      name: "Filter & sort",
      exact: true,
    });
    if (await options.isVisible()) await options.click();
    await page
      .getByRole("combobox", { name: "Focus cars" })
      .selectOption("changed");
    await expect(list.locator(":scope > li")).toHaveCount(1);
    const search = page.getByRole("searchbox", { name: "Search current cars" });
    await search.fill("AB12CDE");
    await expect(list.locator(":scope > li")).toHaveCount(1);
    await page
      .getByRole("link", { name: "Open vehicle file for Toyota Yaris" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Toyota Yaris", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Advert description")).toBeVisible();
    await overflow();
    const mot = page.getByRole("region", { name: "MOT history", exact: true });
    await expect(
      mot.getByRole("button", { name: "View MOT history" }),
    ).toBeVisible();
    expect(reads.filter((p) => p.endsWith("/mot-history"))).toHaveLength(0);
    await mot.getByRole("button", { name: "View MOT history" }).click();
    await expect(mot.getByText("Latest test: Passed")).toBeVisible();
    expect(reads.filter((p) => p.endsWith("/mot-history"))).toHaveLength(1);
    await expect(
      page.locator(".cars-file-status .staff-mot-badge"),
    ).toHaveAttribute("data-tone", "green");
    if (output)
      await page.screenshot({
        path: path.join(output, `${source}-${info.project.name}-file.png`),
      });
    await page.getByRole("link", { name: "Back to Cars", exact: true }).click();
    await expect(search).toHaveValue("AB12CDE");
    await expect(list.locator(":scope > li")).toHaveCount(1);
    await page
      .getByRole("button", { name: "Clear search and filters" })
      .click();
    await page
      .getByRole("button", { name: "More options for Toyota Yaris" })
      .click();
    await page
      .getByRole("menuitem", { name: "Quick view", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Toyota Yaris", exact: true }),
    ).toBeVisible();
    const quickView = page.getByRole("dialog", {
      name: "Toyota Yaris",
      exact: true,
    });
    await quickView
      .locator("summary")
      .filter({ hasText: /^MOT history$/ })
      .click();
    await quickView
      .getByRole("button", { name: "View MOT history", exact: true })
      .click();
    await expect(quickView.getByText("Latest test: Passed")).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Next car in quick view" })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Volvo V90", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await expect(list).toBeVisible();
    await expect(
      page.getByTestId("portal-car-" + ids[0]).locator(".staff-mot-badge"),
    ).toContainText(
      new Date(quickExpiry + "T12:00:00Z").toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "Europe/London",
      }),
    );
    await expect(
      page.getByRole("button", {
        name: "More options for Toyota Yaris",
        exact: true,
      }),
    ).toBeFocused();
    await page.getByRole("button", { name: "Sold 1", exact: true }).click();
    await expect(list.locator(":scope > li")).toHaveCount(1);
    await expect(
      list.getByRole("link", { name: "View sale", exact: true }),
    ).toHaveAttribute("href", /saleId=20000000/);
    await page
      .getByRole("button", { name: "Missing from feed 1", exact: true })
      .click();
    await page
      .getByRole("link", { name: "Open vehicle file for Audi A1" })
      .click();
    await expect(
      page.getByText(
        "Not included in the latest feed. This does not confirm a sale.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "View customer advert", exact: false }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Start sale", exact: true }),
    ).toHaveCount(0);
    await overflow();
    await page.goto("/portal?section=cars&carId=" + ids[1]);
    await expect(
      page.getByRole("heading", { name: "Volvo V90", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Start sale", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Book test drive", exact: true }),
    ).toHaveCount(0);
    await page.goto("/portal?section=cars&carId=" + ids[0]);
    await page
      .getByRole("button", { name: "Book test drive", exact: true })
      .click();
    const enquiry = page.getByRole("dialog", {
      name: "Quick enquiry",
      exact: true,
    });
    await expect(enquiry).toBeVisible();
    await expect(
      enquiry.getByRole("article", { name: "Selected car" }),
    ).toContainText("Toyota");
    await expect(
      enquiry.getByRole("checkbox", { name: "Book a Test Drive", exact: true }),
    ).toBeChecked();
    page.once("dialog", (dialog) => dialog.accept());
    await enquiry.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(enquiry).toHaveCount(0);
    await page.getByRole("button", { name: "Start sale", exact: true }).click();
    await expect(
      page.getByRole("heading", {
        name: "Vehicle & agreed price",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "Vehicle selection", exact: true }),
    ).toContainText("Toyota");
    expect(writes).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
