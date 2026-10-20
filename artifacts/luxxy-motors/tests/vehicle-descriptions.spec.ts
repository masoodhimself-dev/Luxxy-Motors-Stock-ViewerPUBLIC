import { test, expect } from "@playwright/test";
import path from "node:path";
for (const [device, width, height] of [
  ["phone", 390, 844],
  ["tablet", 820, 1180],
  ["tablet-landscape", 1024, 768],
  ["desktop", 1440, 1000],
] as const) {
  test(`${device}: draft, protected information, review, publish and restore`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", (dialog) => dialog.accept());
    await page.goto("/portal?section=inventory");
    await page.getByRole("button", { name: /^Open Ford Focus,/ }).click();
    await page
      .getByRole("button", { name: "Write description", exact: true })
      .click();
    const editor = page.locator(".vehicle-copy-editor");
    await expect(editor.getByRole("note")).toContainText("Local example only");
    // Restore any memory-only state left by the preceding viewport walkthrough.
    if (
      await editor
        .getByRole("button", { name: "Restore original advert" })
        .count()
    )
      await editor
        .getByRole("button", { name: "Restore original advert" })
        .click();
    await editor
      .getByText("Description options & verified tax", { exact: true })
      .click();
    await editor
      .getByLabel("History disclosure layout")
      .selectOption("separate");
    await editor
      .getByLabel("Confirmed full annual vehicle tax (£) · optional")
      .fill("195");
    await editor
      .getByRole("checkbox", {
        name: "I checked today’s full annual rate for this car, including any applicable supplement.",
        exact: true,
      })
      .check();
    await editor
      .getByRole("button", { name: "Save description options", exact: true })
      .click();
    await expect(editor.getByRole("status")).toContainText("Options saved");
    await expect(
      editor.getByRole("complementary", { name: "Verified tax preview" }),
    ).toContainText("£17.06");
    await editor
      .getByText("Description options & verified tax", { exact: true })
      .click();
    await editor
      .getByRole("button", {
        name: /Generate (?:another AI draft|AI description)/,
      })
      .click();
    const field = editor.getByRole("textbox", { name: "Website description" });
    await expect(field).toHaveValue(/This red 2015 Ford Focus Zetec/);
    await expect(
      editor.getByRole("button", { name: "Publish description" }),
    ).toBeDisabled();
    await editor
      .getByText("Preview the published description", { exact: true })
      .click();
    await expect(editor.locator(".vehicle-copy-preview")).toContainText(
      "Bluetooth",
    );
    await expect(editor).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      )
      .toBe(true);
    await editor.screenshot({
      path: path.resolve(
        `../../output/vehicle-description-context-2026-10-20/${device}-editor.png`,
      ),
    });
    await field.fill(
      `${await field.inputValue()}\n\nViewings can be discussed with us.`,
    );
    await editor
      .getByRole("button", { name: "Save draft", exact: true })
      .click();
    await expect(editor.getByRole("status")).toContainText(
      "Draft saved. Your website has not changed.",
    );
    await editor
      .getByRole("checkbox", {
        name: "I’ve checked the facts, equipment and important information.",
        exact: true,
      })
      .check();
    await editor.getByRole("button", { name: "Publish description" }).click();
    await expect(editor.getByRole("status")).toContainText(
      "Description published",
    );
    await editor
      .getByRole("button", { name: "Restore original advert" })
      .click();
    await expect(editor.getByRole("status")).toContainText(
      "using the original advert",
    );
    expect(errors).toEqual([]);
    const targets = await editor
      .locator("button:visible")
      .evaluateAll((buttons) =>
        buttons.map((button) => ({
          text: button.textContent,
          height: button.getBoundingClientRect().height,
        })),
      );
    for (const target of targets)
      expect(target.height, `${target.text} tap target`).toBeGreaterThanOrEqual(
        44,
      );
  });
}
