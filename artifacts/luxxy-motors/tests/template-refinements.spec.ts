import { expect, test } from "@playwright/test";
import { previewSettings } from "../preview/settings";

test.skip(
  process.env.LUXXY_LOCAL_PREVIEW !== "1",
  "Uses the read-only local preview.",
);

test("mobile opening shows vehicle photography and cards avoid downloading hidden previews", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const staffRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/pages\/portal\.tsx/.test(request.url()))
      staffRequests.push(request.url());
  });
  await page.goto("/");
  const hero = page.getByTestId("showroom-hero-photo");
  await expect(hero).toBeVisible();
  const box = await hero.boundingBox();
  expect(box!.y).toBeLessThan(300);
  expect(box!.y + box!.height).toBeLessThan(650);
  await expect(
    page.getByTestId("card-vehicle-preview-1").locator("img"),
  ).toHaveCount(1);
  expect(staffRequests).toEqual([]);
  await page.goto("/portal");
  await expect(page.getByTestId("work-queue")).toBeVisible();
  expect(staffRequests.length).toBeGreaterThan(0);
});

test("returning to stock keeps search, sort and browsing position", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("textbox", { name: "Search the showroom" }).fill("MG");
  await page
    .getByRole("combobox", { name: "Sort results" })
    .selectOption("price-desc");
  await page.getByRole("button", { name: "View matching cars" }).click();
  const vehicle = page
    .getByTestId("card-vehicle-preview-2")
    .getByRole("link", { name: "View full details for MG HS" });
  await vehicle.click();
  await expect(
    page.getByRole("heading", { name: "MG HS", exact: true }),
  ).toBeVisible();
  const position = await page.evaluate(
    () => JSON.parse(sessionStorage.getItem("luxxy.browse.v1") || "{}").scrollY,
  );
  await page
    .getByRole("link", { name: "Back to showroom", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Search the showroom" }),
  ).toHaveValue("MG");
  await expect(
    page.getByRole("combobox", { name: "Sort results" }),
  ).toHaveValue("price-desc");
  await expect(
    page.getByRole("heading", { name: "All stock", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => scrollY))
    .toBeCloseTo(position, -1);
  await expect(vehicle).toBeFocused();
});

test("gallery section controls and buyer information retain real selection and missing-data states", async ({
  page,
}) => {
  await page.goto("/vehicle/preview-1");
  await page.getByRole("button", { name: "Interior", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Interior", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("heading", { name: "What to know about this car" }),
  ).toBeVisible();
  await expect(page.getByText("2 keys", { exact: true })).toBeVisible();
  await page.goto("/vehicle/preview-2");
  await expect(
    page.getByText("Not supplied — please ask our team", { exact: true }),
  ).toHaveCount(6);
});

test("worklist focus uses the existing server queues and lead context stays visible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/portal");
  await page.getByRole("combobox", { name: "Focus worklist" }).selectOption("overdueFollowUps");
  await expect(
    page.getByRole("heading", { name: "Overdue follow-ups", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Viewings today", exact: true }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByTestId("queue-filter-all").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByTestId("lead-card-sample-lead-1").first().click();
  await expect(page.getByTestId("lead-context-bar")).toContainText(
    "Amelia Clarke",
  );
  await page.evaluate(() => window.scrollTo({ top: 700, behavior: "instant" }));
  await expect
    .poll(
      async () => (await page.getByTestId("lead-context-bar").boundingBox())!.y,
    )
    .toBeGreaterThanOrEqual(75);
  expect(
    (await page.getByTestId("lead-context-bar").boundingBox())!.y,
  ).toBeLessThan(180);
});

test("onboarding saves optional content through the existing settings client and updates the showroom", async ({
  page,
}) => {
  let settings = structuredClone(previewSettings);
  let submitted: any;
  await page.route("**/api/dealer-settings", async (route) => {
    if (route.request().method() === "PATCH") {
      submitted = route.request().postDataJSON();
      settings = submitted;
    }
    await route.fulfill({ json: settings });
  });
  await page.goto("/portal");
  await page.getByTestId("tab-settings").click();
  await page.getByTestId("input-identity-name").fill("Example Motor Company");
  await page
    .getByTestId("input-identity-logo-text")
    .fill("Example Motor Company");
  await page.getByTestId("button-settings-nav-presentation").click();
  await page
    .getByTestId("input-parkingInstructions")
    .fill("Park beside reception.");
  await page
    .getByTestId("input-teamIntroduction")
    .fill("Meet our independent dealership team.");
  await page
    .getByTestId("input-reviews-url")
    .fill("https://example.com/reviews");
  await page.getByTestId("button-save-settings").click();
  await expect(page.getByTestId("status-settings-success")).toBeVisible();
  expect(submitted.presentation.parkingInstructions).toBe(
    "Park beside reception.",
  );
  expect(submitted.presentation.reviewsUrl).toBe("https://example.com/reviews");
  await page.getByRole("button", { name: "View showroom" }).click();
  await expect(
    page.getByRole("button", { name: "Example Motor Company", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Park beside reception.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Read customer reviews" }),
  ).toHaveAttribute("href", "https://example.com/reviews");
});

test("onboarding keeps invalid links and undescribed photographs out of a settings save", async ({ page }) => {
  let updates = 0;
  await page.route("**/api/dealer-settings", async (route) => {
    if (route.request().method() === "PATCH") updates += 1;
    await route.fulfill({ json: previewSettings });
  });
  await page.goto("/portal");
  await page.getByTestId("tab-settings").click();
  await page.getByTestId("button-settings-nav-presentation").click();
  await page.getByTestId("input-hero-image-url").fill("https://example.com/showroom.jpg");
  await page.getByTestId("input-reviews-url").fill("http://example.com/reviews");
  await page.getByTestId("button-save-settings").click();
  await expect(page.getByText("Use a full HTTPS address, or leave this empty.")).toBeVisible();
  await expect(page.getByText("Describe the photograph for customers using a screen reader.")).toBeVisible();
  expect(updates).toBe(0);
});
