import { beforeEach, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const state = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: any[]) => state.fetch(...args),
}));
vi.mock("wouter", () => ({
  Link: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
import { NotificationsHome } from "./notifications-home";
import { EmailDraftQueue } from "./email-draft-queue";
const data = {
  generatedAt: "2026-10-16T10:00:00Z",
  emailAccess: true,
  counts: { enquiries: 1, followups: 0, appointments: 0, drafts: 1, email: 0 },
  items: [
    {
      id: "one",
      category: "enquiries",
      customer: "Alex",
      vehicle: "Ford Focus",
      reference: "ENQ-1",
      at: "2026-10-16T09:00:00Z",
      detail: "Awaiting a reply",
      href: "/portal?section=notifications&enquiryId=one&workView=customers",
    },
    {
      id: "two",
      category: "drafts",
      customer: "Sam",
      vehicle: "Suzuki Swift",
      reference: "ENQ-2",
      at: "2026-10-16T09:30:00Z",
      detail: "Draft ready to continue",
      href: "/portal?section=notifications&draft=two&workView=email",
    },
  ],
};
const summary = {
  generatedAt: data.generatedAt,
  unansweredEnquiries: 1,
  upcomingAppointments: 1,
  pendingAppointments: 1,
  overdueFollowUps: 0,
  outstandingBalancePence: 125050,
  salesWithBalance: 1,
  upcomingDeliveries: 0,
  stockCount: 24,
  completedSales: 2,
  totalEnquiries: 10,
  convertedEnquiries: 3,
  enquiryConversionPercent: 30,
  completedConversionPercent: 20,
  stock: {
    stale: false,
    lastSuccessfulSync: data.generatedAt,
    alerts: [] as { code: string; severity: string; message: string }[],
  },
  appointments: [
    {
      id: "appointment",
      customer: "Jo Example",
      vehicle: "Honda Civic",
      at: "2026-10-17T12:00:00Z",
      status: "confirmed",
    },
  ],
  balances: [
    {
      id: "sale-one",
      reference: "SALE-001",
      customer: "Pat Example",
      balancePence: 125050,
    },
  ],
  deliveries: [],
};
function backend({
  notifications = data,
  operations = summary,
  permissions = ["finance.export", "settings.publish"],
}: {
  notifications?: typeof data;
  operations?: typeof summary;
  permissions?: string[];
} = {}) {
  state.fetch.mockImplementation(async (url: string) =>
    url === "/api/staff/access"
      ? {
          role: permissions.includes("settings.publish")
            ? "owner"
            : permissions.includes("finance.export")
              ? "accounts"
              : "salesperson",
          permissions,
          user: { name: "Fictional staff" },
        }
      : url === "/api/dealer-operations"
        ? operations
        : notifications,
  );
}
function show(ui: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {ui}
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  state.fetch.mockReset();
  backend();
});
it("shows actionable categories and links a reply directly to its customer without writing or sending", async () => {
  show(<NotificationsHome />);
  expect(await screen.findByRole("link", { name: /Alex/ })).toHaveAttribute(
    "href",
    "/portal?section=notifications&enquiryId=one&workView=customers",
  );
  expect(screen.getByRole("link", { name: "Prepare reply" })).toHaveAttribute(
    "href",
    "/portal?section=notifications&workView=email&compose=one",
  );
  fireEvent.click(screen.getByRole("button", { name: /Saved drafts/ }));
  expect(screen.queryByRole("link", { name: /Alex/ })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Sam/ })).toHaveAttribute(
    "href",
    "/portal?section=notifications&draft=two&workView=email",
  );
  expect(
    state.fetch.mock.calls.every(
      ([, options]) => !options?.method || options.method === "GET",
    ),
  ).toBe(true);
  expect(
    screen.queryByText(/AI drafting and new automatic email sending are off/),
  ).not.toBeInTheDocument();
});
it("hides email categories and compose links without email permission", async () => {
  backend({
    notifications: {
      ...data,
      emailAccess: false,
      items: data.items,
      counts: { ...data.counts, drafts: 0 },
    },
    permissions: [],
  });
  show(<NotificationsHome />);
  await screen.findByRole("link", { name: /Alex/ });
  expect(
    screen.queryByRole("button", { name: /Saved drafts/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Prepare reply" }),
  ).not.toBeInTheDocument();
});
it("combines the business summary with actions and keeps detailed reporting closed", async () => {
  show(<NotificationsHome embedded />);
  expect(
    await screen.findByRole("link", { name: /Cars in stock.*24/ }),
  ).toHaveAttribute("href", "/portal?section=inventory");
  expect(
    within(screen.getByRole("group", { name: "Dealership figures" })).getByRole(
      "link",
      { name: /Outstanding balance.*£1,250.50/ },
    ),
  ).toHaveAttribute("href", "/portal?section=sales");
  expect(await screen.findByRole("link", { name: /Alex/ })).toBeVisible();
  expect(screen.getByRole("link", { name: /Alex/ }).compareDocumentPosition(screen.getByRole("group", { name: "Dealership figures" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const details = screen
    .getByText("More dealership details")
    .closest("details")!;
  expect(details).not.toHaveAttribute("open");
  expect(
    screen.queryByRole("heading", { name: "Today at a glance" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("AI preparation")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "View dealership overview" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText("Prepare now. Send when ready."),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: /booking needs approval/ }),
  ).not.toBeInTheDocument();
  fireEvent.click(details.querySelector("summary")!);
  expect(screen.getByRole("link", { name: "Open calendar" })).toHaveAttribute(
    "href",
    "/portal?section=notifications&workView=test-drives&deskView=calendar",
  );
  expect(
    screen.getByRole("heading", { name: "Stock connection" }),
  ).toBeVisible();
  expect(
    screen.getByRole("heading", { name: "Customer conversion" }),
  ).toBeVisible();
  expect(
    screen.getByRole("link", { name: /SALE-001.*Pat Example/ }),
  ).toHaveAttribute("href", "/portal?section=sales&saleId=sale-one");
});
it("keeps customer actions usable while the independent business summary is loading or fails", async () => {
  const normal = state.fetch.getMockImplementation()!;
  let fail!: (cause: Error) => void;
  state.fetch.mockImplementation((url: string, ...options: unknown[]) =>
    url === "/api/dealer-operations"
      ? new Promise((_, reject) => {
          fail = reject;
        })
      : normal(url, ...options),
  );
  show(<NotificationsHome embedded />);
  expect(await screen.findByRole("link", { name: /Alex/ })).toBeVisible();
  expect(screen.getByText("Loading dealership summary…")).toBeVisible();
  expect(
    screen.queryByRole("link", { name: /Cars in stock/ }),
  ).not.toBeInTheDocument();
  fail(new Error("Fictional operations unavailable"));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Dealership summary could not be refreshed",
  );
  expect(screen.getByRole("link", { name: /Alex/ })).toBeVisible();
  state.fetch.mockImplementation(normal);
  fireEvent.click(screen.getByRole("button", { name: "Retry summary" }));
  expect(
    await screen.findByRole("link", { name: /Cars in stock.*24/ }),
  ).toBeVisible();
});
it("keeps stock failures visible above collapsed reporting without duplicating notification counts", async () => {
  backend({
    operations: {
      ...summary,
      stock: {
        ...summary.stock,
        stale: true,
        alerts: [
          {
            code: "auth",
            severity: "error",
            message: "Stock credential needs attention.",
          },
        ],
      },
    },
  });
  show(<NotificationsHome embedded />);
  expect(
    await screen.findByText("Stock credential needs attention."),
  ).toBeVisible();
  expect(
    screen.getByText("More dealership details").closest("details"),
  ).not.toHaveAttribute("open");
  expect(
    screen.queryByText("Enquiries awaiting a reply"),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("Upcoming appointments")).not.toBeInTheDocument();
});
it("refreshes actions and the business summary together without writing", async () => {
  show(<NotificationsHome embedded />);
  const refresh = await screen.findByRole("button", { name: "Refresh day" });
  await screen.findByRole("link", { name: /Cars in stock.*24/ });
  const previous = state.fetch.mock.calls.length;
  fireEvent.click(refresh);
  await waitFor(() =>
    expect(state.fetch.mock.calls.slice(previous).map(([url]) => url)).toEqual(
      expect.arrayContaining([
        "/api/staff/notifications",
        "/api/dealer-operations",
      ]),
    ),
  );
  expect(
    state.fetch.mock.calls.every(
      ([, options]) => !options?.method || options.method === "GET",
    ),
  ).toBe(true);
});
it("retains the finance export for accounts permission and hides it from sales staff", async () => {
  backend({ permissions: [] });
  const first = show(<NotificationsHome embedded />);
  fireEvent.click(
    (await screen.findByText("More dealership details")).closest("summary")!,
  );
  expect(
    screen.queryByRole("button", { name: "Export payment ledger" }),
  ).not.toBeInTheDocument();
  first.unmount();
  backend({ permissions: ["finance.export"] });
  const normal = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation((url: string, ...options: unknown[]) =>
    url.endsWith("/payments.csv")
      ? Promise.resolve(new Blob(["fictional,ledger"]))
      : normal(url, ...options),
  );
  const createUrl = vi.fn().mockReturnValue("blob:fictional-ledger");
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: createUrl,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => {});
  show(<NotificationsHome embedded />);
  fireEvent.click(
    (await screen.findByText("More dealership details")).closest("summary")!,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Export payment ledger" }),
  );
  await waitFor(() =>
    expect(state.fetch).toHaveBeenCalledWith(
      "/api/dealer-operations/payments.csv",
      { responseType: "blob" },
    ),
  );
  expect(createUrl).toHaveBeenCalledTimes(1);
  expect(click).toHaveBeenCalledTimes(1);
  click.mockRestore();
});
it("shows an honest error instead of an empty success when notifications fail", async () => {
  const normal = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation((url: string, ...options: unknown[]) =>
    url === "/api/staff/notifications"
      ? Promise.reject(new Error("offline"))
      : normal(url, ...options),
  );
  show(<NotificationsHome />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "could not be refreshed",
  );
  expect(screen.queryByText("You’re up to date")).not.toBeInTheDocument();
});
it("keeps uncertain sends out of discard actions and opens only the selected draft", async () => {
  state.fetch.mockResolvedValue({
    drafts: [
      {
        enquiryId: "one",
        version: 2,
        status: "unknown",
        source: "manual",
        subject: "Your car",
        customerName: "Alex",
        vehicleTitle: "Focus",
        reference: "E1",
        updatedAt: data.generatedAt,
      },
    ],
    hasMore: false,
  });
  const open = vi.fn();
  show(<EmailDraftQueue search="" onOpen={open} />);
  fireEvent.click(await screen.findByRole("button", { name: /Check draft/ }));
  expect(open).toHaveBeenCalledWith("one");
  expect(
    screen.queryByRole("button", { name: "Discard" }),
  ).not.toBeInTheDocument();
  expect(state.fetch).toHaveBeenCalledTimes(1);
});

it("keeps empty notification categories neutral instead of suggesting problems", async () => {
  backend({
    notifications: {
      ...data,
      counts: {
        enquiries: 0,
        followups: 0,
        appointments: 0,
        drafts: 0,
        email: 0,
      },
      items: [],
    },
  });
  show(<NotificationsHome />);
  const categories = await screen.findByLabelText("Notification categories");
  expect(
    within(categories)
      .getAllByRole("button")
      .every((button) => button.dataset.tone === "neutral"),
  ).toBe(true);
  expect(
    screen.getByRole("heading", { name: "You’re up to date" }),
  ).toBeInTheDocument();
});

it("distinguishes actual email issues, due follow-ups and saved drafts while keeping their labels", async () => {
  backend({
    notifications: {
      ...data,
      counts: { ...data.counts, followups: 2, email: 1 },
    },
  });
  show(<NotificationsHome />);
  expect(
    await screen.findByRole("button", { name: /Email needs attention/ }),
  ).toHaveAttribute("data-tone", "danger");
  expect(
    screen.getByRole("button", { name: /Follow-ups due/ }),
  ).toHaveAttribute("data-tone", "warning");
  expect(screen.getByRole("button", { name: /Saved drafts/ })).toHaveAttribute(
    "data-tone",
    "violet",
  );
  expect(
    screen.getByRole("button", { name: /Bookings & today/ }),
  ).toHaveAttribute("data-tone", "neutral");
});

it("puts due work ahead of replies and saved drafts, with honest timing based on the last refresh", async () => {
  backend({ notifications: { ...data, counts: { enquiries: 1, followups: 1, appointments: 1, drafts: 1, email: 1 }, items: [
    data.items[1], data.items[0],
    { ...data.items[0], id: "visit", category: "appointments", customer: "Next visit", at: "2026-10-16T11:00:00Z", detail: "Appointment today" },
    { ...data.items[0], id: "email", category: "email", customer: "Failed email", detail: "Email bounced" },
    { ...data.items[0], id: "due", category: "followups", customer: "Due customer", at: "2026-10-16T07:00:00Z", detail: "Follow-up due" },
  ] } });
  show(<NotificationsHome />);
  await screen.findByRole("link", { name: /Due customer/ });
  const feed = screen.getByRole("region", { name: "Actions needing attention" });
  const rows = within(feed).getAllByRole("listitem");
  expect(rows.map(row => within(row).getByRole("heading").textContent)).toEqual(["Due customer", "Failed email", "Next visit", "Alex", "Sam"]);
  expect(within(rows[0]).getByText("3h overdue")).toBeVisible();
  expect(within(rows[2]).getByText("Today 12:00")).toBeVisible();
});

it("keeps Home to six actions with an explicit expand control and resets that limit when filtering", async () => {
  backend({ notifications: { ...data, counts: { ...data.counts, enquiries: 8 }, items: [
    ...Array.from({ length: 8 }, (_, i) => ({ ...data.items[0], id: `enquiry-${i}`, customer: `Customer ${i}` })),
    data.items[1],
  ] } });
  show(<NotificationsHome />);
  await screen.findByRole("link", { name: /Customer 0/ });
  const feed = screen.getByRole("region", { name: "Actions needing attention" });
  expect(within(feed).getAllByRole("listitem")).toHaveLength(6);
  fireEvent.click(screen.getByRole("button", { name: "Show all 9 actions" }));
  expect(within(feed).getAllByRole("listitem")).toHaveLength(9);
  expect(screen.getByRole("button", { name: "Show fewer" })).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(screen.getByRole("button", { name: /Awaiting a reply/ }));
  expect(within(feed).getAllByRole("listitem")).toHaveLength(6);
  expect(screen.getByRole("button", { name: "Show all 8 actions" })).toHaveAttribute("aria-expanded", "false");
});
it("does not ask staff to record attendance for a pending request whose time has passed", async () => {
  backend({ notifications: { ...data, counts: { ...data.counts, appointments: 1 }, items: [
    { ...data.items[0], id: "pending", category: "appointments", customer: "Pending customer", at: "2026-10-16T09:00:00Z", detail: "Booking needs approval" },
  ] } });
  show(<NotificationsHome />);
  expect(await screen.findByText("Time passed — review request")).toBeVisible();
  expect(screen.queryByText("Check attendance")).not.toBeInTheDocument();
});
