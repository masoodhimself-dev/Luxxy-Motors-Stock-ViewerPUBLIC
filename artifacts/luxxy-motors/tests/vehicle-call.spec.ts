import { test, expect } from "@playwright/test";
test("desktop call opens vehicle and phone panel without navigating", async ({
  page,
}) => {
  await page.goto("/vehicle/preview-2");
  await page.locator('[data-vehicle-contact="call"]').first().click();
  const panel = page.getByRole("dialog");
  await expect(
    panel.getByRole("heading", { name: "Call the showroom" }),
  ).toBeVisible();
  await expect(panel.locator('a[href^="tel:"]')).toBeVisible();
  await expect(panel).toContainText("MG HS");
  await expect(page).toHaveURL(/vehicle\/preview-2/);
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.locator('[data-vehicle-contact="call"]').first(),
  ).toBeFocused();
});
for (const enabled of [false, true])
  test(`phone follow-up with reservation ${enabled}`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
    });
    const page = await context.newPage();
    await page.route("**/api/dealer-settings", async (route) => {
      const response = await route.fetch();
      const settings = await response.json();
      settings.onlineReservation = {
        enabled,
        depositPence: 10000,
        terms: "Sample reservation terms.",
      };
      await route.fulfill({ json: settings });
    });
    await page.goto("http://127.0.0.1:4175/vehicle/preview-2");
    // Block the OS dialler in automation only; the actual link remains tel:.
    await page.evaluate(() =>
      document.addEventListener(
        "click",
        (e) => {
          if ((e.target as Element).closest('a[href^="tel:"]'))
            e.preventDefault();
        },
        true,
      ),
    );
    await page.locator('[data-vehicle-contact="call"]').last().click();
    const panel = page.getByRole("dialog");
    await expect(
      panel.getByRole("heading", { name: "Did you get through?" }),
    ).toBeVisible();
    if (enabled)
      await expect(
        panel.getByRole("button", { name: /Reserve car online/i }),
      ).toBeVisible();
    else {
      await expect(
        panel.getByRole("link", { name: "Ask about this car" }),
      ).toHaveAttribute("href", "/enquire?type=general&vehicleId=preview-2");
      await expect(
        panel.getByText("You can also reserve this car online."),
      ).toHaveCount(0);
    }
    await context.close();
  });

test('closed showroom saves a callback enquiry with car and next-opening details',async({page})=>{
 await page.clock.install({time:new Date('2026-09-28T20:00:00Z')});
 await page.route('**/api/dealer-settings',async route=>{const response=await route.fetch();const settings=await response.json();settings.hours=[{days:'Monday – Sunday',times:'09:00 – 18:00'}];await route.fulfill({json:settings});});
 let submitted:any;
 await page.route('**/api/enquiries',async route=>{submitted=route.request().postDataJSON();await route.fulfill({json:{id:'callback-test',reference:'CALLBACK-TEST'}});});
 await page.goto('/vehicle/preview-2');
 await page.locator('[data-vehicle-contact="call"]').first().click();
 const panel=page.getByRole('dialog');
 await expect(panel).toContainText('tomorrow at 09:00');
 await panel.getByLabel('Your name').fill('Sample Buyer');
 await panel.getByLabel('Telephone').fill('07700900123');
 await panel.getByLabel('Email',{exact:true}).fill('sample@example.test');
 await panel.getByRole('button',{name:'Request a callback'}).click();
 await expect(panel.getByRole('status')).toContainText('Callback request received');
 expect(submitted.vehicleId).toBe('preview-2');expect(submitted.preferredContact).toBe('phone');expect(submitted.message).toContain('next opening');
});
