import { test, expect } from "@playwright/test";
import {
  defaultEmailAppearance,
  defaultEmailTemplates,
  renderEmailTemplate,
} from "@workspace/vehicle-meta";
import {
  previewEmailTemplate,
  sampleEmailVariables,
} from "../../api-server/src/lib/email-template-preview";

for (const width of [320, 390, 820, 1440]) {
  test(`all 22 email layouts fit ${width}px in light/dark mode with unchanged copy`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 1100 });
    // Every email is fictional; never contact providers or remote assets during QA.
    await page.route("**/*", (route) => route.abort());
    for (const colorScheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme });
      for (const template of defaultEmailTemplates) {
        const result = previewEmailTemplate(template.id, template);
        await page.setContent(result.html);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1,
          ),
          `${template.id} ${colorScheme}: horizontal overflow`,
        ).toBe(true);
        await expect(page.locator("h1")).toBeVisible();
        expect(await page.locator("body").innerText()).not.toContain("{{");
        expect(await page.locator("body").innerText()).not.toContain(
          "SAMPLE-001",
        );
        if (template.id === "customer_access_link") {
          const action = page.getByRole("link", {
            name: "Open your private page",
          });
          await expect(action).toHaveAttribute(
            "href",
            sampleEmailVariables.portal_url!,
          );
          const bounds = await action.boundingBox();
          expect(bounds!.height).toBeGreaterThanOrEqual(44);
          expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width + 1);
        }
        if (
          colorScheme === "light" &&
          ["invoice", "booking_confirmation", "service_history"].includes(
            template.id,
          )
        ) {
          await page.screenshot({
            path: info.outputPath(`${template.id}-${width}.png`),
            fullPage: true,
          });
        }
      }
    }
  });

  test(`long copy, bright accent and blocked logo remain usable at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 1100 });
    await page.route("**/*", (route) => route.abort());
    const long = "LONG".repeat(120);
    const result = renderEmailTemplate(
      {
        subject: "Your requested documents",
        body: "Dear {{customer_name}},\n\nYour wording stays here. Read https://example.test/vehicle/123.\n\nRegards,\n{{dealer_name}}",
      },
      {
        ...sampleEmailVariables,
        customer_name: "José O’Neill",
        dealer_name: "Example Motors Ltd",
      },
      [
        { label: "Vehicle", value: long },
        { label: "Cash price", value: "£12,400.00" },
        { label: "Amount received", value: 0 },
        { label: "Payment status", value: "Pending" },
        { label: "Invoice number", value: "INV-2026-0042" },
      ],
      {
        ...defaultEmailAppearance,
        brandColour: "#F4DB9C",
        logoUrl: "https://example.test/logo.png",
        footer: long,
      },
      {
        templateId: "invoice",
        attachments: [long + ".pdf"],
      },
    );
    await page.setContent(result.html);
    await page
      .locator("img")
      .evaluateAll((images) => images.forEach((image) => image.remove()));
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await expect(
      page.getByText("Example Motors Ltd", { exact: true }).last(),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "https://example.test/vehicle/123" }),
    ).toHaveAttribute("href", "https://example.test/vehicle/123");
    expect(await page.locator("body").innerText()).toContain("£12,400.00");
    expect(await page.locator("body").innerText()).toContain("INV-2026-0042");
    await page.screenshot({
      path: info.outputPath(`long-copy-${width}.png`),
      fullPage: true,
    });
  });
}
