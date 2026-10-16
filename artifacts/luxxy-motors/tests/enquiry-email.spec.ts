import { test, expect, type Page } from "@playwright/test";
test.skip(
  process.env.LUXXY_LOCAL_PREVIEW !== "1",
  "Only isolated local preview with intercepted email requests.",
);
const id = "08e3fe3f-35b3-43d0-8e3e-6ca02991d046",
  vehicleId = "3412c2d4-914b-44ea-beb5-548a7a7e5a33",
  photoId = "044aa88d-0c70-40f7-b85d-9c7ff88f211e";
const enquiry = {
  id,
  customerName: "Alex Example",
  reference: "ENQ-TEST",
  email: "alex@example.test",
  phone: "07700 900123",
  vehicleId,
  vehicleTitle: "Ford Focus",
  type: "general",
  message: "Please send the service book.",
  workspaceRevision: 0,
  status: "new",
};
const context = {
  ...enquiry,
  email: enquiry.email,
  revision: 0,
  vehicleAvailable: true,
  appointmentAvailable: false,
  defaults: {
    subject: "Your Ford Focus",
    message: "Hi Alex, here are the details we discussed.",
  },
  ready: true,
  photos: [{ id: photoId, byte_size: 100000 }],
  deliveries: [],
};
async function open(page: Page, ready = true) {
  await page.route("**/api/**", (route) =>
    /\/email(?:-preview)?$/.test(new URL(route.request().url()).pathname)
      ? route.fallback()
      : ["GET", "HEAD"].includes(route.request().method())
        ? route.continue()
        : route.abort(),
  );
  await page.route("**/api/enquiries", (route) =>
    route.fulfill({ json: [enquiry] }),
  );
  await page.route("**/api/stock", (route) =>
    route.fulfill({
      json: {
        schemaVersion: 1,
        count: 1,
        cars: [
          {
            id: vehicleId,
            advertId: "fictional",
            title: "Ford Focus",
            price: 9000,
            images: [],
            inventoryStatus: "available",
          },
        ],
      },
    }),
  );
  await page.route(`**/api/staff/enquiries/${id}/email-context`, (route) =>
    route.fulfill({ json: { ...context, ready } }),
  );
  await page.route(
    `**/api/staff/inventory/${vehicleId}/photos/${photoId}`,
    (route) =>
      route.fulfill({
        contentType: "image/jpeg",
        body: Buffer.from("ffd8ffd9", "hex"),
      }),
  );
  await page.goto("/portal?section=enquiries");
  await page.getByRole("tab", { name: "Enquiries", exact: true }).click();
  await page
    .getByRole("button", { name: /Open enquiry for Alex Example/ })
    .click();
  await page
    .getByRole("button", { name: "Email customer", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Customer email" }),
  ).toHaveValue(enquiry.email);
}
function mockPreview(page: Page) {
  return page.route(`**/api/staff/enquiries/${id}/email-preview`, (route) => {
    const input = route.request().postDataJSON();
    return route.fulfill({
      json: {
        to: input.to,
        subject: input.subject,
        text:
          input.message +
          "\n\nVehicle: Ford Focus\nCash price: £9,000\nEnquiry reference: ENQ-TEST",
        previewHash: "a".repeat(64),
        attachments: input.photoIds.map((id: string) => ({
          id,
          filename: "ENQ-TEST-service-book-1.jpg",
          byteSize: 100000,
        })),
      },
    });
  });
}
for (const width of [390, 820, 1440])
  test(`review and send selected service-book pages without overflow at ${width}`, async ({
    page,
  }) => {
    if (width === 390)
      await page.addInitScript(() =>
        Object.defineProperty(crypto, "randomUUID", {
          value: undefined,
          configurable: true,
        }),
      );
    await page.setViewportSize({ width, height: 1000 });
    let sent: any[] = [];
    await mockPreview(page);
    await page.route(`**/api/staff/enquiries/${id}/email`, (route) => {
      sent.push(route.request().postDataJSON());
      return route.fulfill({
        status: 201,
        json: {
          delivery: {
            id: "delivery",
            requestId: sent[0].requestId,
            to: enquiry.email,
            subject: sent[0].subject,
            status: "sent",
            photoCount: sent[0].photoIds.length,
            createdAt: new Date().toISOString(),
            error: null,
          },
        },
      });
    });
    await open(page);
    await page.getByRole("checkbox", { name: /Photo 1/ }).check();
    expect(sent.length).toBe(0);
    const dialog = page.getByRole("dialog");
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Review email", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Email preview" }),
    ).toBeVisible();
    await expect(
      page.getByText("ENQ-TEST-service-book-1.jpg", { exact: false }),
    ).toBeVisible();
    expect(sent.length).toBe(0);
    await page.screenshot({
      path: `/tmp/luxxy-email-review-${width}.png`,
      fullPage: false,
    });
    await page.getByRole("button", { name: "Send email", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Submitted to Resend" }),
    ).toBeVisible();
    expect(sent).toHaveLength(1);
    expect(sent[0].photoIds).toEqual([photoId]);
    expect(sent[0].includeVehicle).toBe(true);
    expect(sent[0].includeAppointment).toBe(false);
    expect(sent[0].requestId).toMatch(/^[a-f0-9-]{36}$/);
  });
test("lost response retries identical content with the same email request", async ({
  page,
}) => {
  await mockPreview(page);
  let attempts: any[] = [];
  await page.route(`**/api/staff/enquiries/${id}/email`, (route) => {
    const input = route.request().postDataJSON();
    attempts.push(input);
    return attempts.length === 1
      ? route.abort("failed")
      : route.fulfill({
          json: {
            delivery: {
              ...input,
              id: "test",
              status: "sent",
              photoCount: 0,
              error: null,
            },
          },
        });
  });
  await open(page);
  await page.getByRole("button", { name: "Review email", exact: true }).click();
  await page.getByRole("button", { name: "Send email", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Edit message", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Check or retry same email", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Submitted to Resend" }),
  ).toBeVisible();
  expect(attempts[1]).toEqual(attempts[0]);
});
test("disabled Resend permits preview but cannot send", async ({ page }) => {
  await mockPreview(page);
  await open(page, false);
  await expect(
    page.getByText(/Email is not enabled for this dealership/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Review email", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Send email", exact: true }),
  ).toBeDisabled();
});

test("accounts staff do not see the enquiry email action", async ({ page }) => {
  await page.route("**/api/**", (route) =>
    ["GET", "HEAD"].includes(route.request().method())
      ? route.continue()
      : route.abort(),
  );
  await page.route("**/api/enquiries", (route) =>
    route.fulfill({ json: [enquiry] }),
  );
  await page.route("**/api/staff/access", (route) =>
    route.fulfill({
      json: {
        role: "accounts",
        permissions: ["payments.record", "finance.export"],
        user: { name: "Accounts fixture" },
      },
    }),
  );
  await page.goto("/portal?section=enquiries");
  await page.getByRole("tab", { name: "Enquiries", exact: true }).click();
  await page
    .getByRole("button", { name: /Open enquiry for Alex Example/ })
    .click();
  await expect(
    page.getByRole("button", { name: "Email customer", exact: true }),
  ).toHaveCount(0);
});

test('dashboard calendar deep link opens the unified enquiry calendar', async ({ page }) => {
  await page.route('**/api/**', route => ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort());
  await page.route('**/api/enquiries', route => route.fulfill({ json: [enquiry] }));
  await page.goto('/portal?section=enquiries&deskView=calendar');
  await expect(page.getByRole('tab', { name: 'Calendar', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByLabel('Calendar month')).toBeVisible();
});
test("stale preview returns to review instead of sending changed details", async ({
  page,
}) => {
  await mockPreview(page);
  await page.route(`**/api/staff/enquiries/${id}/email`, (route) =>
    route.fulfill({
      status: 409,
      json: {
        error:
          "The details changed after your preview. Review the email again.",
      },
    }),
  );
  await open(page);
  await page.getByRole("button", { name: "Review email", exact: true }).click();
  await page.getByRole("button", { name: "Send email", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Review email", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("details changed");
});
