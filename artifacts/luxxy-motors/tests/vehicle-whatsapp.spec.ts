import { test, expect } from "@playwright/test";
for (const width of [390, 1280])
  test(`WhatsApp preview ${width}`, async ({ page }) => {
    await page.clock.install({ time: new Date("2026-09-28T21:00:00Z") });
    await page.route("**/api/dealer-settings", async (route) => {
      const res = await route.fetch();
      const settings = await res.json();
      settings.hours = [{ days: "Monday – Sunday", times: "09:00 – 18:00" }];
      settings.onlineReservation.enabled = false;
      await route.fulfill({ json: settings });
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/vehicle/preview-2");
    await page
      .getByRole("button", { name: /WhatsApp about/ })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("tomorrow at 09:00");
    await expect(dialog.getByLabel("Your message")).toHaveValue(
      /Please reply when you reopen/,
    );
    await dialog
      .getByLabel("Your message")
      .fill("Hello, can I arrange a test drive?");
    const href = await dialog
      .getByRole("link", { name: "Continue to WhatsApp" })
      .getAttribute("href");
    expect(new URL(href!).searchParams.get("text")).toBe(
      "Hello, can I arrange a test drive?",
    );
    await expect(
      dialog.getByRole("link", { name: "Ask about this car" }),
    ).toBeVisible();
    await dialog.getByLabel("Your message").fill(" ");
    await expect(
      dialog.getByRole("link", { name: "Continue to WhatsApp" }),
    ).toHaveCount(0);
    await expect(page).toHaveURL(/vehicle\/preview-2/);
  });
