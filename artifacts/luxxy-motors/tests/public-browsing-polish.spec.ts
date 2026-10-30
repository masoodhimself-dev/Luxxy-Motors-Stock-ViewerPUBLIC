import { test, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";

const fixtures = process.env.MOT_AUDIT_FIXTURES;
test.skip(!fixtures || process.env.LUXXY_LOCAL_PREVIEW !== "1", "Archived public fixtures; no live writes.");
for (const dealer of ["shore", "multi"]) {
  test(`${dealer}: homepage, stock and vehicle browsing remain lightweight and contextual`, async ({ page }, info) => {
    const load = async (name: string) => JSON.parse(await readFile(path.join(fixtures!, `${dealer}-public-${name}.json`), "utf8"));
    const stock = await load("stock"), settings = await load("settings");
    settings.presentation = { ...settings.presentation, featuredEnabled: true };
    settings.delivery = { ...settings.delivery, enabled: dealer === "multi" };
    settings.partExchange = { ...settings.partExchange, enabled: dealer === "multi" };
    const car = stock.cars.find((car: any) => !car.inventoryStatus || car.inventoryStatus === "available");
    car.listedAt = new Date(Date.now() - 86400000).toISOString();
    car.features = ["Panoramic roof", "Heated Front Seats", "Reversing Camera", "Apple CarPlay", "Adaptive Cruise Control", "Bluetooth Audio", "Alarm", "17in Alloy Wheels", "Factory specification ABC"];
    car.description = "A spacious car with useful equipment for everyday journeys. ".repeat(8) + "\n\nFull original description retained for customers to read.";
    for (const item of stock.cars) { item.images = ["/src/assets/demo-car-hero.jpg"]; item.heroImage = item.images[0]; }
    const writes: string[] = [], errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== "http://127.0.0.1:4285") return route.abort();
      if (url.pathname.startsWith("/api/") && !["GET", "HEAD"].includes(request.method())) { writes.push(url.pathname); return route.abort(); }
      if (url.pathname === "/api/features") return route.fulfill({ json: { features: { publicEnquiries: true, partExchange: true, testDriveBookings: true } } });
      if (url.pathname === "/api/dealer-settings") return route.fulfill({ json: settings });
      if (url.pathname === "/api/stock") return route.fulfill({ json: stock });
      if (url.pathname === `/api/vehicles/${car.id}`) return route.fulfill({ json: car });
      if (url.pathname.endsWith("/mot-history")) return route.fulfill({ json: { status: "registration_missing", message: "MOT check not needed for this layout test." } });
      return route.continue();
    });
    const noOverflow = async () => await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.goto("/");
    await expect(page.locator(".home-stock-context")).toContainText("cars in stock");
    await expect(page.locator('.header-phone-row')).toHaveCount(0);
    if (info.project.use.viewport!.width < 1024) expect((await page.locator('[data-site-header]').boundingBox())!.height).toBeLessThanOrEqual(72);
    const shortcuts = page.getByRole("navigation", { name: "Browse stock categories" });
    await expect(shortcuts).toHaveCount(1);
    expect(await shortcuts.getByRole("link").count()).toBeLessThanOrEqual(5);
    expect(await page.evaluate(() => Boolean(document.querySelector(".rolling-stock-window")!.compareDocumentPosition(document.querySelector(".home-shopping-shortcuts")!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
    if(info.project.use.viewport!.width < 640) {
      const firstPhoto = page.locator(".rolling-stock-window .vehicle-card-photo").first();
      expect((await firstPhoto.boundingBox())!.y).toBeLessThan(info.project.use.viewport!.height);
    }
    await noOverflow();
    if(process.env.PUBLIC_BROWSING_OUTPUT) {
      await mkdir(process.env.PUBLIC_BROWSING_OUTPUT, { recursive: true });
      await page.screenshot({ path: path.join(process.env.PUBLIC_BROWSING_OUTPUT, `${dealer}-${info.project.name}-home.png`) });
    }
    await page.locator(".hero-search-submit").click();
    await expect(page).toHaveURL(/\/stock/);
    const card = page.getByTestId(`card-vehicle-${car.id}`);
    await expect(card.getByText("Just arrived", { exact: true })).toBeVisible();
    await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); scrollTo(0, 700); });
    const toolbar = page.getByTestId("stock-search-toolbar");
    if(info.project.use.viewport!.width < 1024) {
      await expect.poll(async () => (await toolbar.boundingBox())!.y).toBeLessThan(160);
      await toolbar.getByRole("button", { name: "Advanced search", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Filter used cars" });
      await dialog.getByLabel("Make", { exact: true }).selectOption(car.make);
      await dialog.getByRole("button", { name: /^Show \d+ cars?$/ }).click();
      await expect(dialog).toHaveCount(0);
    } else await page.locator(".stock-filter-sidebar").getByLabel("Make", { exact: true }).selectOption(car.make);
    await toolbar.getByLabel("Sort results").selectOption("price-asc");
    await expect(page).toHaveURL(/sort=price-asc/);
    await noOverflow();
    if(process.env.PUBLIC_BROWSING_OUTPUT) await toolbar.screenshot({ path: path.join(process.env.PUBLIC_BROWSING_OUTPUT, `${dealer}-${info.project.name}-toolbar.png`) });
    const savedResultsUrl = page.url();
    await page.locator(`a[href^="/vehicle/${car.id}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`/vehicle/${car.id}`));
    await page.getByRole("link", {name: "Back to your results", exact: true}).click();
    await expect(page).toHaveURL(savedResultsUrl);
    await expect(toolbar.getByLabel("Sort results")).toHaveValue("price-asc");
    await page.locator(`a[href^="/vehicle/${car.id}"]`).first().click();
    await expect(page.getByRole("list", {name: "Equipment highlights"})).toBeVisible();
    await expect(page.locator('.gallery-photo-counter')).toContainText('1 /');
    await expect.poll(() => page.locator('.gallery-photo-loading').count()).toBe(0);
    if(process.env.PUBLIC_BROWSING_OUTPUT) {
      await mkdir(process.env.PUBLIC_BROWSING_OUTPUT, {recursive: true});
      await page.screenshot({path: path.join(process.env.PUBLIC_BROWSING_OUTPUT, `${dealer}-${info.project.name}-vehicle.png`)});
    }
    if (info.project.use.viewport!.width < 640) {
      const contact = page.getByRole("navigation", {name: "Contact about this vehicle"});
      await expect(contact.getByRole("link", {name: /Call for/})).toBeVisible();
      await expect(contact.getByRole("link", {name: "Enquire", exact: true})).toBeVisible();
      await expect(contact.getByRole("link")).toHaveCount(2);
    }
    const equipment = page.locator(".vehicle-equipment-groups");
    await expect(equipment.getByRole("list", { name: "Feature highlights" })).toBeVisible();
    await equipment.getByText("View all equipment", { exact: true }).click();
    await expect(equipment.getByRole("list", { name: "Safety & driver assistance" })).toContainText("Alarm");
    await expect(equipment.getByRole("list", { name: "Other equipment" })).toContainText("Factory specification ABC");
    const fullDescription = page.getByText("Full original description retained for customers to read.", { exact: true });
    if(info.project.use.viewport!.width < 640) {
      await expect(fullDescription).toBeHidden();
      await page.getByRole("button", { name: "Read full description", exact: true }).click();
      await expect(fullDescription).toBeVisible();
      await page.getByRole("button", { name: "Show less", exact: true }).click();
      await expect(fullDescription).toBeHidden();
    } else await expect(fullDescription).toBeVisible();
    const form = page.getByTestId("form-enquiry");
    const question = form.getByRole("textbox", { name: "Your question" });
    await question.fill("I would like to visit on Saturday.");
    await form.getByRole("button", { name: "Availability", exact: true }).click();
    await expect(question).toHaveValue("I would like to visit on Saturday.\n\nIs this car still available?");
    await expect(question).toBeFocused();
    if(dealer === "multi") await expect(form.getByRole("button", { name: "Delivery", exact: true })).toBeVisible();
    else await expect(form.getByRole("button", { name: "Delivery", exact: true })).toHaveCount(0);
    await noOverflow();
    const footer = page.locator('.dealership-footer');
    await footer.scrollIntoViewIfNeeded();
    await expect(footer.getByRole('heading', {name: 'Talk to us'})).toBeVisible();
    await noOverflow();
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
    if(process.env.PUBLIC_BROWSING_OUTPUT) {
      await mkdir(process.env.PUBLIC_BROWSING_OUTPUT, { recursive: true });
      await equipment.screenshot({ path: path.join(process.env.PUBLIC_BROWSING_OUTPUT, `${dealer}-${info.project.name}-equipment.png`) });
    }
  });
}
