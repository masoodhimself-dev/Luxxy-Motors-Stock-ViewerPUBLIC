import { staffMotSummary } from "@workspace/vehicle-meta";
import { test, expect, type Page } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { defaultBookingSettings } from "../src/lib/test-drive-dates";

const fixtures = process.env.MOT_AUDIT_FIXTURES;
const output = process.env.PORTAL_CONNECTED_OUTPUT;
test.skip(
  !fixtures || process.env.LUXXY_LOCAL_PREVIEW !== "1",
  "Local fixture-contained verification only.",
);

async function setup(page: Page, source: "shore" | "multi") {
  const stock = JSON.parse(
    await readFile(path.join(fixtures!, `${source}-public-stock.json`), "utf8"),
  );
  const settings = JSON.parse(
    await readFile(
      path.join(fixtures!, `${source}-public-settings.json`),
      "utf8",
    ),
  );
  stock.cars = stock.cars.map((car: any) => ({
    ...car,
    inventoryStatus: "available",
    heroImage: "/src/assets/demo-car-hero.jpg",
    images: ["/src/assets/demo-car-hero.jpg"],
  }));
  settings.testDriveBooking = { ...defaultBookingSettings, enabled: true };
  settings.delivery = { ...settings.delivery, enabled: true };
  settings.deliveryPricing = {
    ...settings.deliveryPricing,
    enabled: true,
    basePricePence: 5500,
    pricePerMilePence: 200,
  };
  settings.partExchange = { ...settings.partExchange, enabled: true };
  const car = stock.cars[0],
    now = Date.now();
  const record = (id: string, name: string, extra: object = {}) => ({
    id,
    reference: `ENQ-${id}`,
    dealerId: "browser-fixture",
    customerName: name,
    email: `${id}@example.test`,
    phone: id === "alex" ? "07700900123" : "07700900456",
    vehicleId: car.id,
    vehicleTitle: car.title,
    vehicleRegistration: car.plate || null,
    vehiclePrice: car.price,
    vehicleUrl: `/vehicle/${car.id}`,
    type: "general",
    source: "website",
    preferredContact: "email",
    status: "new",
    message:
      id === "alex"
        ? "Can you deliver this car? I have a Fiesta to part exchange."
        : "Please call me today.",
    staffNote: "",
    workspaceRevision: 1,
    followUpRevision: 1,
    appointmentRevision: 1,
    assignedToId: "staff-one",
    assignedToName: "Jamie",
    attendance: "scheduled",
    appointmentAt: null,
    appointmentStatus: null,
    appointmentCancelledAt: null,
    followUpAt: null,
    followUpCompletedAt: null,
    createdAt: new Date(now - 86400000).toISOString(),
    updatedAt: new Date(now).toISOString(),
    events: [],
    ...extra,
  });
  const records = [
    record("alex", "Alex Taylor"),
    record("sam", "Sam Morgan", {
      followUpAt: new Date(now - 3600000).toISOString(),
      followUpNote: "Call promised today.",
    }),
  ];
  let version = 0;
  const emails: any[] = [
    {
      key: "reply:11111111-1111-4111-8111-111111111111",
      kind: "reply",
      enquiry_id: "alex",
      subject: "Delivery question",
      status: "reply_needed",
      created_at: new Date(now - 10000).toISOString(),
      message: "Please send the delivery price.",
      recipient: "alex@example.test",
      sender: "alex@example.test",
    },
  ];
  const savedMessages: string[] = [],
    writes: string[] = [],
    blocked: string[] = [],
    reads: string[] = [],
    errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.context().route("**/*", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      p = url.pathname;
    if (url.origin !== "http://127.0.0.1:4285") return route.abort();
    if (!p.startsWith("/api/")) return route.continue();
    if (req.method() !== "GET" && req.method() !== "HEAD") {
      writes.push(`${req.method()} ${p}`);
      if (p === "/api/staff/enquiries/alex/email-draft")
        return route.fulfill({ json: { version: ++version } });
      if (p === "/api/staff/enquiries/alex/email-preview") {
        const body = req.postDataJSON();
        return route.fulfill({
          json: {
            to: body.to,
            subject: body.subject,
            text: body.message,
            previewHash: "a".repeat(64),
            attachments: [],
          },
        });
      }
      if (p === "/api/staff/enquiries/alex/email") {
        const body = req.postDataJSON();
        savedMessages.push(body.message);
        emails.unshift({
          key: "email:fixture-sent",
          kind: "enquiry",
          enquiry_id: "alex",
          subject: body.subject,
          status: "sent",
          created_at: new Date().toISOString(),
          message: body.message,
          recipient: body.to,
        });
        return route.fulfill({
          json: {
            delivery: {
              id: "fixture-sent",
              requestId: body.requestId,
              to: body.to,
              subject: body.subject,
              status: "sent",
              photoCount: 0,
              createdAt: new Date().toISOString(),
              error: null,
            },
          },
        });
      }
      if (p === "/api/staff/whatsapp/confirm-whatsapp") {
        const body = req.postDataJSON();
        expect(body.enquiryId).toBe("alex");
        expect(body.phone).toBe("07700900123");
        expect(body.confirmed).toBe(true);
        records[0].events.push({
          id: "wa-event" as never,
          kind: "conversation_logged" as never,
          summary: "WhatsApp sent — staff confirmed" as never,
          note: body.message as never,
          actor: "dealer" as never,
          staffName: "Jamie" as never,
          occurredAt: new Date().toISOString() as never,
        } as never);
        return route.fulfill({ json: { saved: true } });
      }
      blocked.push(`${req.method()} ${p}`);
      return route.abort();
    }
    reads.push(p);
    if (p === "/api/stock") return route.fulfill({ json: stock });
    if (p === "/api/dealer-settings") return route.fulfill({ json: settings });
    if (p === "/api/features")
      return route.fulfill({
        json: {
          features: {
            testDriveBookings: true,
            customerEmails: true,
            publicEnquiries: true,
            partExchange: true,
          },
          evaluatedAt: new Date().toISOString(),
        },
      });
    if (p === "/api/portal/session")
      return route.fulfill({
        json: { state: "allowed", name: "Jamie", email: "staff@example.test" },
      });
    if (p === "/api/staff/access")
      return route.fulfill({
        json: {
          role: "owner",
          permissions: ["sales.manage", "settings.publish"],
          user: {
            authUserId: "staff-one",
            name: "Jamie",
            email: "staff@example.test",
          },
        },
      });
    if (p === "/api/staff/directory")
      return route.fulfill({
        json: {
          currentUserId: "staff-one",
          members: [{ id: "staff-one", name: "Jamie" }],
        },
      });
    if (p === "/api/staff/cars")
      return route.fulfill({
        json: {
          feed: {
            source: source === "multi" ? "Cazoo" : "Auto Trader",
            receivedAt: new Date(now).toISOString(),
            appliedAt: new Date(now).toISOString(),
            state: "current",
            scheduled: false,
          },
          cars: stock.cars.map((car: any) => ({
            ...car,
            staff: {
              source: source === "multi" ? "cazoo" : "autotrader",
              sourceStatus: "live",
              inventoryStatus: "available",
              published: true,
              firstSeenAt: new Date(now).toISOString(),
              lastSeenAt: new Date(now).toISOString(),
              archivedAt: null,
              mot: staffMotSummary(null),
              changes: [],
              sale: null,
            },
          })),
        },
      });
    if (p === "/api/enquiries") return route.fulfill({ json: records });
    if (p === "/api/staff/email/reply-attention")
      return route.fulfill({
        json: {
          enquiries: [
            {
              enquiryId: "alex",
              pending: 1,
              review: 0,
              latestReplyText: "Please send the delivery price.",
            },
          ],
        },
      });
    if (p === "/api/staff/email")
      return route.fulfill({
        json: {
          messages: emails.filter(
            (e) => e.enquiry_id === url.searchParams.get("enquiryId"),
          ),
          hasMore: false,
        },
      });
    if (p.endsWith("/conversations"))
      return route.fulfill({
        json: {
          events: records.find((r) => p.includes(`/${r.id}/`))?.events || [],
          total:
            records.find((r) => p.includes(`/${r.id}/`))?.events.length || 0,
          nextCursor: null,
        },
      });
    if (p.endsWith("/email-context")) {
      const item = records.find((r) => p.includes(`/${r.id}/`))!;
      return route.fulfill({
        json: {
          version,
          savedDraft: null,
          email: item.email,
          customerName: item.customerName,
          vehicleId: item.vehicleId,
          vehicleTitle: item.vehicleTitle,
          reference: item.reference,
          revision: 1,
          vehicleAvailable: true,
          appointmentAvailable: false,
          defaults: {
            subject: "Your vehicle enquiry",
            message: `Hello ${item.customerName}, thank you for your enquiry.`,
          },
          ready: true,
          templates: [],
          photos: [],
          invoices: [],
          vehiclePhotos: [],
          deliveries: [],
        },
      });
    }
    if (p === "/api/staff/whatsapp/enquiries")
      return route.fulfill({
        json: {
          enquiries: [
            { id: "alex", customerName: "Alex Taylor", phone: "07700900123" },
          ],
        },
      });
    if (
      p === "/api/staff/notifications" ||
      p === "/api/staff/notifications/snapshot"
    )
      return route.fulfill({
        json: {
          enquiries: 0,
          emailReplies: 0,
          drafts: 0,
          testDriveRequests: 0,
        },
      });
    if (p === "/api/recent-handovers")
      return route.fulfill({ json: { schemaVersion: 1, handovers: [] } });
    if (p === "/api/chat/config")
      return route.fulfill({
        json: {
          settings: { enabled: false },
          availability: { staffOnline: false },
          dealerName: settings.identity.name,
        },
      });
    return route.fulfill({
      status: 404,
      json: { error: `No local fixture for ${p}` },
    });
  });
  return { car, records, writes, blocked, reads, errors, savedMessages };
}
async function screenshot(page: Page, name: string) {
  if (!output) return;
  await mkdir(output, { recursive: true });
  await page.screenshot({
    path: path.join(output, `${name}.png`),
    fullPage: true,
    animations: "disabled",
  });
}
async function fits(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(page.viewportSize()!.width);
}

for (const source of ["shore", "multi"] as const) {
  test(`${source}: Cars opens the right case, drafts persist, email stays manual and WhatsApp confirmation journals the right customer`, async ({
    page,
  }, info) => {
    const audit = await setup(page, source);
    await page.goto("/portal?section=cars");
    const cars = page.getByRole("list", { name: "Current cars", exact: true });
    await expect(cars).toBeVisible();
    await cars
      .getByRole("link", { name: /Alex Taylor/ })
      .first()
      .click();
    const selected = page.getByRole("region", {
      name: "Selected enquiry: Alex Taylor",
    });
    await expect(selected).toBeVisible();
    await expect(
      selected.getByText("Please send the delivery price.", { exact: true }),
    ).toBeVisible();
    expect(audit.reads.filter((p) => p.endsWith("/mot-history"))).toHaveLength(
      0,
    );
    expect(audit.writes).toEqual([]);
    await fits(page);
    await screenshot(page, `${info.project.name}-${source}-case`);
    await selected.getByRole("button", { name: "Email", exact: true }).click();
    const message = selected.getByRole("textbox", {
      name: "Message",
      exact: true,
    });
    await expect(message).toHaveValue(
      "Hello Alex Taylor, thank you for your enquiry.",
    );
    await message.fill("Keep this exact customer message.");
    await selected
      .getByRole("button", { name: "WhatsApp", exact: true })
      .first()
      .click();
    await expect(message).toHaveValue("Keep this exact customer message.");
    await selected.getByRole("button", { name: "Email", exact: true }).click();
    await expect(message).toHaveValue("Keep this exact customer message.");
    expect(audit.writes).toEqual([]);
    await selected
      .getByRole("button", { name: "Review email", exact: true })
      .click();
    await expect(
      selected.getByRole("region", { name: "Email preview", exact: true }),
    ).toBeVisible();
    expect(audit.savedMessages).toEqual([]);
    await selected
      .getByRole("button", { name: "Send email", exact: true })
      .click();
    await expect(
      selected.getByText("Resend accepted this email for delivery.", {
        exact: false,
      }),
    ).toBeVisible();
    expect(audit.savedMessages).toEqual(["Keep this exact customer message."]);
    await selected.getByRole("button", { name: "Done", exact: true }).click();
    await selected
      .getByRole("button", { name: "WhatsApp", exact: true })
      .first()
      .click();
    await expect(message).toBeVisible();
    await message.fill("Phone handoff verification only.");
    await selected
      .getByRole("button", { name: "WhatsApp", exact: true })
      .last()
      .click();
    const dialog = page.getByRole("dialog", { name: "Send on WhatsApp" });
    await expect(
      dialog.getByRole("textbox", { name: "Customer number" }),
    ).toHaveValue("07700900123");
    await dialog
      .getByRole("button", { name: "Use email instead", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect(
      selected.getByRole("button", { name: "Email", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(message).toHaveValue(/Phone handoff verification only\./);
    await selected
      .getByRole("button", { name: "WhatsApp", exact: true })
      .first()
      .click();
    await selected
      .getByRole("button", { name: "WhatsApp", exact: true })
      .last()
      .click();
    await expect(
      dialog.getByRole("textbox", { name: "Customer number" }),
    ).toHaveValue("07700900123");
    const link = dialog.getByRole("link", { name: /Open WhatsApp/ });
    await expect(link).toHaveAttribute("href", /wa\.me\/447700900123\?text=/);
    const opens = page.waitForEvent("popup");
    await link.click();
    const popup = await opens;
    await popup.close();
    await dialog.getByRole("button", { name: /I.ve sent it/ }).click();
    await expect(
      dialog.getByText(/Saved as staff-confirmed WhatsApp/),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(
      selected.getByText("WhatsApp sent — staff confirmed", { exact: true }),
    ).toBeVisible();
    expect(audit.blocked).toEqual([]);
    expect(audit.errors).toEqual([]);
    expect(
      audit.writes.filter((w) => w.endsWith("/confirm-whatsapp")),
    ).toHaveLength(1);
    expect(audit.records[1].events).toEqual([]);
    await fits(page);
    await screenshot(page, `${info.project.name}-${source}-whatsapp`);
  });
}

test("queue filters and cancelled navigation retain the unsaved customer message without writes", async ({
  page,
}, info) => {
  const audit = await setup(page, "multi");
  await page.goto("/portal?section=notifications&workView=customers");
  await page.getByRole("button", { name: /Due today/ }).click();
  await expect(
    page.getByRole("button", { name: /Open enquiry for Sam Morgan/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Open enquiry for Alex Taylor/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /All enquiries/ }).click();
  await page
    .getByRole("button", { name: /Open enquiry for Alex Taylor/ })
    .click();
  const selected = page.getByRole("region", {
    name: "Selected enquiry: Alex Taylor",
  });
  await selected.getByRole("button", { name: "Email", exact: true }).click();
  const message = selected.getByRole("textbox", {
    name: "Message",
    exact: true,
  });
  await message.fill("Do not discard this reply.");
  page.once("dialog", (dialog) => void dialog.dismiss());
  if (page.viewportSize()!.width < 900)
    await page
      .getByRole("navigation", { name: "Portal sections" })
      .getByRole("button", { name: "Cars", exact: true })
      .click();
  else
    await page
      .getByRole("button", { name: /Open enquiry for Sam Morgan/ })
      .click();
  await expect(message).toHaveValue("Do not discard this reply.");
  expect(audit.writes).toEqual([]);
  await fits(page);
  await screenshot(page, `${info.project.name}-draft-protection`);
});
