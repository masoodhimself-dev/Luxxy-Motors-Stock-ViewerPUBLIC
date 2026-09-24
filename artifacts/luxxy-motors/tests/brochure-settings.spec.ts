import { expect, test, request as requestAPI } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";
test.skip(
  process.env.LUXXY_LOCAL_PREVIEW !== "1",
  "Local settings/PDF preview only.",
);
test.describe.configure({ mode: "serial" });
test.use({actionTimeout:15000});
for (const width of [390, 1440])
  test(`brochure settings persist and reach the PDF at ${width}px`, async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const original = await (await request.get("/api/dealer-settings")).json();
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/portal");
      await page.getByTestId("tab-settings").click();
      await page.getByTestId("button-settings-nav-brochure").click();
      const section = page.locator("#settings-brochure");
      await section.getByText("Advanced brochure design", { exact: true }).click();
      await section
        .getByLabel("Brochure cover heading", { exact: false })
        .fill("Your chosen car");
      await section
        .getByLabel("Showroom introduction", { exact: false })
        .fill("Come and take a closer look with our team.");
      await section
        .getByLabel("Closing note", { exact: false })
        .fill("Please call before travelling.");
      await section
        .getByLabel("Brochure accent colour", { exact: false })
        .fill("#234567");
      await section.getByLabel("Maximum photos", { exact: false }).fill("5");
      await section
        .getByRole("combobox", { name: "Photo layout", exact: true })
        .selectOption("large");
      await section.getByLabel("Include features and equipment").uncheck();
      await page.getByTestId("button-save-settings").click();
      await expect(page.getByTestId("status-settings-success")).toBeVisible();
      const saved = await (await request.get("/api/dealer-settings")).json();
      expect(saved.brochure).toMatchObject({
        title: "Your chosen car",
        photoLimit: 5,
        galleryLayout: "large",
        includeFeatures: false,
        accentColour: "#234567",
      });
      await page.reload();
      await page.getByTestId("tab-settings").click();
      await page.getByTestId("button-settings-nav-brochure").click();
      await expect(
        section.getByLabel("Closing note", { exact: false }),
      ).toHaveValue("Please call before travelling.");
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await mkdir(resolve("../../docs/screenshots/brochure-redesign"), {
        recursive: true,
      });
      await section.screenshot({
        path: resolve(
          `../../docs/screenshots/brochure-redesign/settings-${width}.png`,
        ),
      });
      const response = await request.get(
        "/api/vehicles/preview-2/brochure.pdf",
      );
      expect(response.ok()).toBe(true);
      const pdf = await response.body();
      const source = pdf.toString("latin1");
      const streams = [
        ...source.matchAll(/<<((?:(?!endobj)[\s\S])*?)>>\s*stream\r?\n/g),
      ]
        .map((match) => {
          const length = Number(/\/Length\s+(\d+)\b/.exec(match[1])?.[1]);
          const start = match.index! + match[0].length;
          const bytes = pdf.subarray(start, start + length);
          return match[1].includes("/FlateDecode")
            ? inflateSync(bytes).toString("latin1")
            : "";
        })
        .join("\n");
      expect(streams).toContain("YOUR CHOSEN CAR");
      expect(streams).toContain("Please call before travelling.");
      if (width === 1440) {
        await mkdir(resolve("../../output/pdf"), { recursive: true });
        await writeFile(
          resolve("../../output/pdf/luxxy-custom-brochure.pdf"),
          pdf,
        );
      }
    } finally {
      const cleanup = await requestAPI.newContext({baseURL:"http://127.0.0.1:4175"});
      try {const restored = await cleanup.patch("/api/dealer-settings", {data:original});expect(restored.ok()).toBe(true);} finally {await cleanup.dispose();}
    }
  });
