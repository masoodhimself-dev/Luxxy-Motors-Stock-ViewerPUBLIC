import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Car, StockData } from "../src/lib/stock-context";
import { defaultBookingSettings } from "../src/lib/test-drive-dates";

const fixtureFolder = process.env.MOT_AUDIT_FIXTURES;
const output = process.env.PORTAL_CARS_OUTPUT;
test.skip(
  !fixtureFolder || process.env.LUXXY_LOCAL_PREVIEW !== "1",
  "Local read-only preview with public dealer snapshots only.",
);

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(page.viewportSize()!.width);
}
async function contained(page: Page, locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.y).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width + 1,
  );
  expect(box!.y + box!.height).toBeLessThanOrEqual(
    page.viewportSize()!.height + 1,
  );
}
async function capture(page: Page, name: string) {
  if (!output) return;
  await mkdir(output, { recursive: true });
  await page.screenshot({
    path: path.join(output, `${name}.png`),
    animations: "disabled",
  });
}
function actor(info: TestInfo) {
  return (locator: Locator) =>
    info.project.use.hasTouch ? locator.tap() : locator.click();
}

async function setup(
  page: Page,
  source: "shore" | "multi",
  options: { booking?: boolean; feature?: boolean; assistance?: boolean } = {},
) {
  const load = async (suffix: string) =>
    JSON.parse(
      await readFile(
        path.join(fixtureFolder!, `${source}-public-${suffix}.json`),
        "utf8",
      ),
    );
  const stock = (await load("stock")) as StockData;
  const settings = await load("settings");
  settings.testDriveBooking = {
    ...defaultBookingSettings,
    enabled: options.booking !== false,
  };
  // Public stock fields remain genuine. Only photos/status of a second fixture car are deterministic.
  stock.cars = stock.cars.map((car, index) => ({
    ...car,
    inventoryStatus: index === 1 ? "reserved" : "available",
    ...(options.assistance ? {price:index===0?7500:15000,transmission:"Automatic"} : {}),
    heroImage: "/src/assets/demo-car-hero.jpg?photo=1",
    images: [1, 2, 3].map((n) => `/src/assets/demo-car-hero.jpg?photo=${n}`),
    imageCount: 3,
  }));
  stock.count = stock.cars.length;
  const first = stock.cars[0],
    now = Date.now();
  const entry = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    reference: `CARS-EXAMPLE-${id}`,
    dealerId: "synthetic-cars-browser",
    customerName: `Example customer ${id}`,
    email: `${id}@example.test`,
    phone: "07700900123",
    vehicleId: first.id,
    vehicleTitle: first.title,
    vehicleRegistration: first.plate,
    vehiclePrice: first.price,
    vehicleUrl: `/vehicle/${first.id}`,
    status: "new",
    type: "general",
    source: options.assistance ? "website" : "phone",
    preferredContact: "phone",
    message: options.assistance ? "Is it available? Do you take part exchange and can you deliver? I want automatic under £8,000." : "My car is JD25KDW or MA06 LDW. I am coming from M6 7JX or M23DW.",
    staffNote: "",
    assignedToId: null,
    assignedToName: null,
    callOutcome: null,
    attendance: "scheduled",
    workspaceRevision: 1,
    appointmentRevision: 1,
    followUpRevision: 1,
    appointmentAt: null,
    appointmentStatus: null,
    appointmentCancelledAt: null,
    followUpAt: null,
    followUpNote: null,
    followUpCompletedAt: null,
    createdAt: new Date(now - 86_400_000).toISOString(),
    updatedAt: new Date(now).toISOString(),
    events: [],
    ...extra,
  });
  const enquiries = [
    entry("case-a"),
    entry("merged-b", {
      mergedIntoId: "case-a",
      mergedAt: new Date(now).toISOString(),
    }),
    entry("booking-c", {
      type: "viewing",
      appointmentAt: new Date(now + 86_400_000).toISOString(),
      appointmentStatus: "confirmed",
    }),
  ];
  const writes: string[] = [],
    motReads: string[] = [],
    errors: string[] = [],
    apiReads: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => void dialog.accept());
  await page.route("**/*", (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (!["GET", "HEAD"].includes(request.method())) {
      writes.push(`${request.method()} ${url.pathname}`);
      return route.abort();
    }
    if (url.origin !== "http://127.0.0.1:4285") return route.abort();
    const pathname = url.pathname;
    if (!pathname.startsWith("/api/")) return route.continue();
    apiReads.push(pathname);
    if (pathname === "/api/postcodes/distance") return route.fulfill({json:{miles:123.4,approximate:true,distanceBasis:"driving"}});
    if (pathname.endsWith("/mot-history")) {
      motReads.push(pathname);
      return route.fulfill({
        json: {
          status: "available",
          history: {registration:"MA06LDW",make:"FORD",model:"FOCUS",checkedAt:new Date().toISOString(),recall:"No",tests:[{completedDate:"2026-05-01T12:00:00Z",result:"PASSED",expiryDate:"2027-04-30",mileage:"90000",mileageUnit:"MI",defects:[]}]},
          message:
            "Registration not supplied. Ask the customer for the registration before checking MOT history.",
        },
      });
    }
    if (options.assistance && pathname.endsWith("/conversations")) return route.fulfill({json:{events:[],total:0,nextCursor:null}});
    if (options.assistance && pathname === "/api/staff/email") return route.fulfill({json:{messages:[],hasMore:false}});
    if (options.assistance && pathname.endsWith("/email-context")) return route.fulfill({json:{version:4,savedDraft:null,email:"case-a@example.test",customerName:"Example customer case-a",vehicleId:first.id,vehicleTitle:first.title,reference:"CARS-EXAMPLE-case-a",revision:1,vehicleAvailable:true,appointmentAvailable:true,defaults:{subject:"Your enquiry",message:"Hello, thank you for your enquiry."},ready:true,templates:[],invoices:[],photos:[],deliveries:[]}});
    if (pathname === "/api/stock") return route.fulfill({ json: stock });
    if (pathname === "/api/dealer-settings")
      return route.fulfill({ json: settings });
    if (pathname === "/api/features")
      return route.fulfill({
        json: {
          evaluatedAt: new Date().toISOString(),
          features: {
            testDriveBookings: options.feature !== false,
            testDriveDeclarations: true,
            customerEmails: true,
            publicEnquiries: true,
            partExchange: true,
          },
        },
      });
    if (pathname === "/api/portal/session")
      return route.fulfill({
        json: {
          state: "allowed",
          name: "Browser reviewer",
          email: "reviewer@example.test",
        },
      });
    if (pathname === "/api/staff/access")
      return route.fulfill({
        json: {
          role: "owner",
          permissions: ["sales.manage", "settings.publish"],
          user: {
            authUserId: "cars-reviewer",
            name: "Browser reviewer",
            email: "reviewer@example.test",
          },
        },
      });
    if (pathname === "/api/staff/directory")
      return route.fulfill({
        json: {
          currentUserId: "cars-reviewer",
          members: [{ id: "cars-reviewer", name: "Browser reviewer" }],
        },
      });
    if (pathname === "/api/enquiries")
      return route.fulfill({ json: enquiries });
    if (pathname === "/api/staff/email/reply-attention")
      return route.fulfill({ json: { enquiries: [] } });
    if (pathname === "/api/test-drive-bookings")
      return route.fulfill({
        json: enquiries.filter((e) => e.type === "viewing"),
      });
    if (pathname === "/api/sale-workspace")
      return route.fulfill({
        json: { sales: [], hasMore: false, nextOffset: null, preview: true },
      });
    if (pathname === "/api/sale-workspace/paperwork")
      return route.fulfill({
        json: {
          correctionSettings: {
            handling: "accountant",
            instructions: "Contact your accountant.",
          },
        },
      });
    if (pathname === "/api/sales") return route.fulfill({ json: [] });
    if (pathname === "/api/enquiries/availability") {
      const date = url.searchParams.get("date");
      return route.fulfill({
        json: {
          date,
          timezone: "Europe/London",
          slots: ["10:00", "11:00", "13:00"].map((label) => ({
            label,
            startAt: `${date}T${label}:00.000Z`,
            available: true,
          })),
        },
      });
    }
    if (pathname === "/api/recent-handovers")
      return route.fulfill({ json: { schemaVersion: 1, handovers: [] } });
    if (pathname === "/api/chat/config")
      return route.fulfill({
        json: {
          settings: { enabled: false },
          availability: { staffOnline: false },
          dealerName: settings.identity.name,
        },
      });
    // No API request is forwarded to a service or production environment.
    return route.fulfill({
      status: 404,
      json: { error: `No read-only browser fixture for ${pathname}` },
    });
  });
  return { stock, first, settings, writes, motReads, errors, apiReads };
}


test("Enquiry registration and postcode checks do not write records", async ({page}) => {
 const audit=await setup(page,"multi");
 await page.goto("/portal?section=notifications&workView=customers&enquiryId=case-a");
 const plate=page.getByRole("button",{name:"Check MOT history for MA06LDW"}).first();
 await expect(plate).toBeVisible(); expect(audit.motReads).toHaveLength(0);
 await plate.scrollIntoViewIfNeeded();
 await capture(page,"example-enquiry-message");
 await plate.click(); const dialog=page.getByRole("dialog");
 await expect(dialog.getByRole("textbox",{name:"Registration number"})).toHaveValue("MA06LDW");
 await contained(page,dialog);
 await dialog.getByRole("button",{name:"Check MOT",exact:true}).click();
 await expect(dialog).toContainText("FORD FOCUS");
 await capture(page,"example-mot-history");
 await dialog.getByRole("button",{name:"Close",exact:true}).click();
 await expect(plate).toBeFocused();
 await page.getByRole("button",{name:"Check road distance from M2 3DW"}).first().click();
 await contained(page,dialog);
 await dialog.getByRole("button",{name:"Check road distance",exact:true}).click();
 await expect(dialog.getByRole("status")).toContainText("123.4 road miles");
 await capture(page,"example-postcode-distance");
 await dialog.getByRole("button",{name:"Close",exact:true}).click();
 await noOverflow(page); expect(audit.writes).toEqual([]); expect(audit.errors).toEqual([]);
});

test("Reply assistance offers local questions and stock links without sending or saving", async({page})=>{
 const audit=await setup(page,"multi",{assistance:true});
 await page.goto("/portal?section=notifications&workView=customers&enquiryId=case-a");
 const assistance=page.getByRole("region",{name:"Reply assistance"});
 await expect(assistance).toBeVisible();
 await expect(assistance).toContainText("Waiting for your reply");
 await assistance.getByRole("checkbox",{name:"Delivery"}).check();
 await expect(assistance.getByRole("checkbox",{name:"Delivery"})).toBeChecked();
 await assistance.getByText(/Matching available cars/).click();
 await assistance.getByRole("button",{name:"Add to reply"}).click();
 const message=page.getByRole("textbox",{name:"Message",exact:true});
 await expect(message).toHaveValue(new RegExp(`/vehicle/${audit.first.id}`));
 await expect(message).toHaveValue(/Hello, thank you for your enquiry/);
 await noOverflow(page); expect(audit.writes).toEqual([]);expect(audit.errors).toEqual([]);
});
