import { test, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";

const fixtures = process.env.MOT_AUDIT_FIXTURES;
test.skip(!fixtures || process.env.LUXXY_LOCAL_PREVIEW !== "1", "Local public fixtures only.");

for (const dealer of ["shore", "multi"]) {
  test(`${dealer}: MOT and delivery stay in context, outside the price header`, async ({ page }, info) => {
    const load = async (name: string) => JSON.parse(await readFile(path.join(fixtures!, `${dealer}-public-${name}.json`), "utf8"));
    const stock = await load("stock"), settings = await load("settings"), mot = await load("history");
    const passedTest = mot.history.tests.find((test: any) => test.result === 'PASSED');
    if (passedTest) {
      passedTest.defects = [{ text: 'Preview advisory note', type: 'ADVISORY', dangerous: false }];
      mot.history.tests.push({ ...passedTest, completedDate: '2000-01-01', result: 'FAILED', expiryDate: null, defects: [{ text: 'Historic preview failure', type: 'MAJOR', dangerous: false }] });
    }
    settings.delivery = { ...settings.delivery, enabled: true };
    settings.testDriveBooking = { ...settings.testDriveBooking, enabled: dealer === "multi" };
    settings.contact = { ...settings.contact, phone: "0204 6286488" };
    settings.deliveryPricing = { enabled: true, basePrice: "50", pricePerMile: "1.50" };
    stock.cars = stock.cars.map((car: any) => ({ ...car, heroImage: "/src/assets/demo-car-hero.jpg", images: ["/src/assets/demo-car-hero.jpg"] }));
    const car = stock.cars.find((car: any) => (car.plate || car.vrm || "").replace(/\s/g, "") === mot.history.registration);
    expect(car).toBeTruthy();
    car.engineCC = 999;
    const cachedHistory = { ...mot.history, checkedAt: new Date().toISOString(), tests: dealer === "shore" ? [] : [{
      completedDate: new Date().toISOString(), result: "PASSED",
      expiryDate: new Date(Date.now() + 330 * 86400000).toISOString().slice(0, 10), defects: [],
    }], firstMotDueDate: dealer === "shore" ? "2028-05-20" : undefined };
    let fullMotCalls = 0;
    const writes: string[] = [], errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== "http://127.0.0.1:4285") return route.abort();
      if (url.pathname.startsWith("/api/") && !["GET", "HEAD"].includes(req.method())) {
        writes.push(url.pathname); return route.abort();
      }
      if (url.pathname === "/api/features") return route.fulfill({ json: { features: { testDriveBookings: true, publicEnquiries: true, partExchange: true, customerEmails: false, testDriveDeclarations: false } } });
      if (url.pathname === "/api/dealer-settings") return route.fulfill({ json: settings });
      if (url.pathname === "/api/stock") return route.fulfill({ json: stock });
      if (url.pathname === "/api/postcodes") return route.fulfill({ json: {
        location: { postcode: "SW1A 1AA", latitude: 51.5, longitude: -0.1, region: "London", administrativeArea: "Westminster" },
        postcodes: [],
      } });
      if (url.pathname.endsWith("/mot-history")) {
        if (url.searchParams.get("cacheOnly") === "true") return route.fulfill({ json: { status: "available", history: cachedHistory } });
        fullMotCalls++; return route.fulfill({ json: mot });
      }
      if (url.pathname === "/api/postcodes/delivery-estimate") return route.fulfill({ json: {
        postcode: "SW1A 1AA", roadMiles: 23.4, basePricePence: 5000,
        pricePerMilePence: 150, mileageChargePence: 3510, totalPence: 8510,
        distanceBasis: "driving", estimated: true,
      } });
      if (url.pathname === `/api/vehicles/${car.id}`) return route.fulfill({ json: car });
      return route.continue();
    });
    await page.goto(`/vehicle/${car.id}`);
    const header = page.getByTestId("vehicle-identity");
    await expect(header).toBeVisible();
    await expect(header.getByRole("button", { name: "MOT history", exact: true })).toHaveCount(0);
    await expect(header.getByRole("button", { name: /Delivery/ })).toHaveCount(0);
    const highlights = page.locator(".vehicle-summary").getByRole("list", { name: "Vehicle highlights" });
    await expect(highlights.getByRole("button", { name: dealer === "shore" ? "MOT not required until 05/2028" : /Long MOT/ })).toBeVisible();
    await expect(highlights.getByRole("button", { name: "999cc engine", exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth }))).toEqual({ width: info.project.use.viewport!.width, viewport: info.project.use.viewport!.width });
    if (process.env.VEHICLE_CHECK_PLACEMENT_OUTPUT) {
      await mkdir(process.env.VEHICLE_CHECK_PLACEMENT_OUTPUT, { recursive: true });
      await highlights.screenshot({ path: `${process.env.VEHICLE_CHECK_PLACEMENT_OUTPUT}/${dealer}-${info.project.name}-badges.png` });
    }
    if (info.project.use.viewport!.width < 640) {
      const headerBar = page.locator('[data-site-header]');
      await expect(headerBar.getByRole('link', { name: /^Call / })).toBeVisible();
      await expect(headerBar.getByRole('link', { name: /^Call / })).toHaveAttribute('href', 'tel:02046286488');
      await expect(headerBar.locator('.header-phone-row')).toBeHidden();
      expect((await headerBar.boundingBox())!.height).toBeLessThanOrEqual(66);
      await expect(page.locator('.vehicle-mobile-availability')).toBeVisible();
      const gallery = page.locator('.vehicle-detail-gallery');
      await page.evaluate(() => scrollTo(0,0));
      await expect.poll(async () => (await gallery.boundingBox())!.y).toBeLessThan(270);
      const actions = page.getByRole('navigation', { name: 'Contact about this vehicle' });
      await expect(actions).toBeVisible();
      await headerBar.getByRole('button', { name: 'Open navigation menu' }).click();
      await expect(actions).toBeHidden();
      await page.keyboard.press('Escape');
      await expect(actions).toBeVisible();
      await expect(actions.getByRole('link', { name: 'Enquire', exact: true })).toBeVisible();
      if(dealer === 'multi') await expect(actions.getByRole('link', { name: 'Book test drive', exact: true })).toBeVisible();
      else await expect(actions.getByRole('link', { name: 'Book test drive', exact: true })).toHaveCount(0);
      await actions.getByRole('link', { name: 'Enquire', exact: true }).click();
      await expect(page.locator('#vehicle-enquiry-heading')).toBeFocused();
      await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); scrollTo(0,0); });
      if(process.env.VEHICLE_CHECK_PLACEMENT_OUTPUT) await page.screenshot({ path: `${process.env.VEHICLE_CHECK_PLACEMENT_OUTPUT}/${dealer}-${info.project.name}-first-screen.png` });
    } else {
      await expect(page.locator('.vehicle-mobile-actions')).toBeHidden();
      await expect(page.locator('.vehicle-mobile-availability')).toBeHidden();
    }
    if(info.project.use.viewport!.width < 640) {
      car.title = 'Mercedes-Benz GLE Coupe AMG Line Premium Plus';
      await page.reload();
      const title = page.getByTestId('vehicle-identity').getByRole('heading', { level: 1 });
      await expect(title).toHaveText(car.title);
      const titleBox = (await title.boundingBox())!;
      const priceBox = (await page.locator('.vehicle-compact-identity .vehicle-price-block').boundingBox())!;
      expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(priceBox.x);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.getByRole('button', { name: 'View gallery fullscreen', exact: true }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.locator('.vehicle-mobile-actions')).toBeHidden();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
    const history = page.locator('section[aria-labelledby="vehicle-records-heading"]');
    const motAction = history.getByRole("button", { name: "MOT history", exact: true });
    await motAction.scrollIntoViewIfNeeded();
    expect(fullMotCalls).toBe(0);
    await motAction.click();
    await expect(page.getByRole("dialog").getByText(/Latest test:/)).toBeVisible();
    await expect(page.getByRole('dialog').locator('li').filter({ hasText: 'Historic preview failure' })).toHaveCount(0);
    if(passedTest) {
      const advisory = page.getByRole('dialog').locator('li').filter({ hasText: 'Preview advisory note' });
      await expect(advisory).toBeHidden();
      const toggle = page.getByRole('dialog').locator('summary').filter({ hasText: 'Advisories & notes' }).first();
      await toggle.click();
      await expect(advisory).toBeVisible();
      await toggle.click();
      await expect(advisory).toBeHidden();
    }
    await expect(page.getByRole('dialog').getByRole('link', { name: 'View full MOT history on GOV.UK' })).toBeVisible();
    await expect(page.locator('.vehicle-mobile-actions')).toBeHidden();
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
    await expect(motAction).toBeFocused();
    const delivery = page.locator('section[aria-labelledby="vehicle-delivery-heading"]');
    await delivery.getByRole("button", { name: "Delivery estimate", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Delivery postcode", { exact: true }).fill("SW1A 1AA");
    await dialog.getByRole("button", { name: "Calculate delivery", exact: true }).click();
    await expect(dialog.getByText("£85.10 estimated delivery", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(delivery.getByRole("button", { name: "Delivery · est. £85.10", exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(fullMotCalls).toBe(1);
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
    const output = process.env.VEHICLE_CHECK_PLACEMENT_OUTPUT;
    if (output) {
      await mkdir(output, { recursive: true });
      await delivery.screenshot({ path: `${output}/${dealer}-${info.project.name}-delivery.png` });
      await history.screenshot({ path: `${output}/${dealer}-${info.project.name}-history.png` });
    }
  });
}
