import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test.skip(
  process.env.LUXXY_LOCAL_PREVIEW !== "1",
  "Local intercepted fixtures only; no live records or customer messages.",
);
const base = "http://127.0.0.1:4285";
const now = "2026-10-29T12:00:00.000Z";
const id = "11111111-2222-4333-8444-555555555555";
const protectedId = "99999999-8888-4777-8666-555555555555";

async function setup(page: Page) {
  const sample = {
    reference: "ENQ-ONE",
    type: "general",
    source: "phone",
    status: "new",
    phone: "07700900123",
    email: null,
    preferredContact: "phone",
    vehicleId: null,
    vehicleTitle: "Ford Focus",
    appointmentAt: null,
    workspaceRevision: 2,
    followUpRevision: 0,
    createdAt: now,
    updatedAt: now,
    events: [],
    assignedToId: "local-owner",
  };
  const one = {
    ...sample,
    id,
    customerName: "Alex Taylor",
    message: "Please call about this car.",
  };
  const protectedRecord = {
    ...sample,
    id: protectedId,
    customerName: "Jordan Morgan",
    phone: "07700900456",
    message: "Please keep my invoice and booking.",
  };
  let enquiries = [one, protectedRecord];
  const originalProtected = JSON.stringify(protectedRecord);
  const errors: string[] = [],
    writes: string[] = [],
    blocked: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.context().route("**/*", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname,
      method = req.method();
    if (url.origin !== base) return route.abort();
    if (!path.startsWith("/api/")) return route.continue();
    if (path === "/api/staff/access")
      return route.fulfill({
        json: {
          role: "owner",
          permissions: ["settings.publish", "sales.manage"],
          user: { authUserId: "local-owner", name: "Jamie" },
        },
      });
    if (path === "/api/portal/session")
      return route.fulfill({
        json: { state: "allowed", name: "Jamie", email: "owner@example.test" },
      });
    const match = path.match(/^\/api\/staff\/enquiries\/([^/]+)\/deletion$/);
    if (match) {
      const target = match[1];
      if (method === "GET")
        return route.fulfill({
          json: {
            id: target,
            expectedRevision: 2,
            canDelete: target === id,
            reason:
              target === protectedId
                ? "This enquiry is connected to a saved sale and cannot be deleted."
                : null,
          },
        });
      if (method === "DELETE") {
        writes.push(`delete:${target}`);
        expect(req.postDataJSON()).toEqual({
          expectedRevision: 2,
          confirmDelete: true,
        });
        expect(target).toBe(id);
        enquiries = enquiries.filter((entry) => entry.id !== target);
        return route.fulfill({ json: { deleted: true, id: target } });
      }
    }
    if (path === "/api/enquiries") return route.fulfill({ json: enquiries });
    if (path === "/api/staff/email/reply-attention")
      return route.fulfill({ json: { enquiries: [] } });
    if (path === "/api/staff/directory")
      return route.fulfill({
        json: {
          currentUserId: "local-owner",
          members: [{ id: "local-owner", name: "Jamie" }],
        },
      });
    if (path.endsWith("/conversations"))
      return route.fulfill({
        json: { events: [], total: 0, nextCursor: null },
      });
    if (path === "/api/staff/email")
      return route.fulfill({ json: { messages: [], hasMore: false } });
    if (
      path === "/api/staff/notifications" ||
      path === "/api/staff/notifications/snapshot"
    )
      return route.fulfill({
        json: {
          enquiries: 0,
          emailReplies: 0,
          drafts: 0,
          testDriveRequests: 0,
        },
      });
    if (method === "GET" || method === "HEAD") return route.continue();
    blocked.push(`${method} ${path}`);
    return route.abort();
  });
  return {
    writes,
    blocked,
    errors,
    assertPreserved: () => {
      expect(enquiries).toEqual([protectedRecord]);
      expect(JSON.stringify(protectedRecord)).toBe(originalProtected);
    },
  };
}

async function openDeletion(page: Page, name: string) {
  const workspace = page.getByRole("article", {
    name: `Customer workspace for ${name}`,
  });
  await expect(workspace).toBeVisible();
  const context = workspace.locator("details.enquiry-case-context-disclosure");
  if ((await context.getAttribute("open")) === null)
    await workspace.getByText("Vehicle & checks", { exact: true }).click();
  await workspace
    .getByText("Customer details & history", { exact: true })
    .click();
  await workspace
    .getByRole("button", { name: "Delete enquiry", exact: true })
    .click();
  return page.getByRole("alertdialog", { name: "Delete this enquiry?" });
}

test("staff cancel or explicitly confirm only the chosen enquiry; protected sale records cannot be deleted", async ({
  page,
}, info) => {
  const state = await setup(page);
  await page.goto(
    `/portal?section=notifications&workView=customers&enquiryId=${id}`,
  );
  let dialog = await openDeletion(page, "Alex Taylor");
  await expect(dialog.getByText("Alex Taylor", { exact: true })).toBeVisible();
  await expect(dialog.getByText("ENQ-ONE", { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Delete permanently", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("checkbox").check();
  await dialog
    .getByRole("button", { name: "Keep enquiry", exact: true })
    .click();
  expect(state.writes).toEqual([]);
  await page
    .getByRole("article", { name: "Customer workspace for Alex Taylor" })
    .getByRole("button", { name: "Delete enquiry", exact: true })
    .click();
  dialog = page.getByRole("alertdialog", { name: "Delete this enquiry?" });
  await expect(dialog.getByRole("checkbox")).not.toBeChecked();
  await expect(
    dialog.getByRole("button", { name: "Delete permanently", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("checkbox").check();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const output = process.env.PORTAL_DELETION_OUTPUT;
  if (output) {
    await mkdir(output, { recursive: true });
    await page.screenshot({
      path: `${output}/delete-${info.project.name}.png`,
      animations: "disabled",
    });
  }
  await dialog
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Enquiry deleted." }),
  ).toBeVisible();
  await page.goto(
    `/portal?section=notifications&workView=customers&enquiryId=${protectedId}`,
  );
  dialog = await openDeletion(page, "Jordan Morgan");
  await expect(dialog.getByRole("alert")).toContainText(
    "connected to a saved sale",
  );
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Delete permanently", exact: true }),
  ).toBeDisabled();
  state.assertPreserved();
  expect(state.writes).toEqual([`delete:${id}`]);
  expect(state.blocked).toEqual([]);
  expect(state.errors).toEqual([]);
});
