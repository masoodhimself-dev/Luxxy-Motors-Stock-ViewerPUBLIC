import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { dealerConfig } from "@/config/dealer";
const state = vi.hoisted(() => ({
  role: "owner",
  fetch: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock("./dealer-administration", () => ({
  useStaffAccess: () => ({ data: { role: state.role } }),
}));
vi.mock("@/lib/dealer-settings-context", () => ({
  useDealerSettings: () => ({ settings: dealerConfig }),
}));
vi.mock("./staff-cars-query", () => ({
  useStaffCars: () => ({
    data: { feed: { state: "current", receivedAt: "2026-11-06T10:00:00Z" } },
    isPending: false,
  }),
}));
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: unknown[]) => state.fetch(...args),
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/portal", state.navigate],
  Link: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
import {
  WorkspaceSearch,
  OwnerSetup,
  OwnerOperationsReport,
} from "./workspace-tools";
const clients: QueryClient[] = [];
function show(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>,
  );
}
beforeEach(() => {
  state.role = "owner";
  state.fetch.mockReset();
  state.navigate.mockReset();
  state.fetch.mockImplementation(async (url: string) =>
    url.includes("cazoo-leads")
      ? { enabled: true, mailbox: "leads@example.test", receipts: [] }
      : url.includes("dealer-integrations")
        ? {
            resend: { enabled: false },
            readiness: { resend: { ready: false } },
          }
        : url.includes("search")
          ? {
              results: [
                {
                  kind: "car",
                  id: "car",
                  title: "Toyota Land Cruiser",
                  detail: "SB09 YAO",
                  href: "/portal?section=cars&carId=car",
                },
              ],
            }
          : url.includes("website-journey")
            ? {
                from: "2026-11-01",
                to: "2026-11-06",
                days: [
                  {
                    date: "2026-11-06",
                    search: 125,
                    vehicle: 87,
                    enquiry: 12,
                    appointmentRequest: 3,
                  },
                ],
                totals: {
                  search: 125,
                  vehicle: 87,
                  enquiry: 12,
                  appointmentRequest: 3,
                },
              }
            : {
                from: "2026-11-01",
                to: "2026-11-06",
                enquiries: 20,
                testDrivesRequested: 4,
                carsSold: 2,
                receivedPence: 50000,
                refundsPence: 10000,
                netReceivedPence: 40000,
                currentOutstandingPence: 70000,
                currentCustomerCreditPence: 0,
                unreviewedBalances: 1,
              },
  );
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((c) => c.clear());
  vi.restoreAllMocks();
});
it("searches after two characters and opens the linked record", async () => {
  show(<WorkspaceSearch />);
  fireEvent.click(
    screen.getByRole("button", { name: "Search cars, customers and invoices" }),
  );
  const input = screen.getByRole("searchbox", {
    name: "Search all workspace records",
  });
  fireEvent.change(input, { target: { value: "Toyota" } });
  fireEvent.click(
    await screen.findByRole("link", { name: /Toyota Land Cruiser/ }),
  );
  expect(state.navigate).toHaveBeenCalledWith("/portal?section=cars&carId=car");
  expect(state.fetch.mock.calls.some(([url]) => url.includes("q=Toyota"))).toBe(
    true,
  );
});
it("summarises real connection state and links to existing setup sections", async () => {
  show(<OwnerSetup />);
  fireEvent.click(screen.getByText(/Setup & connections/));
  expect(await screen.findByText("Sending switched off")).toBeVisible();
  expect(screen.getByText("Mailbox connected")).toBeVisible();
  expect(screen.getByText("Up to date")).toBeVisible();
  expect(screen.getByRole("link", { name: /bank details/ })).toHaveAttribute(
    "href",
    "/portal?section=settings&settingsTab=paperwork",
  );
});
it("loads owner reports only when opened, distinguishing receipts from profit and current balances", async () => {
  show(<OwnerOperationsReport />);
  expect(state.fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Owner report"));
  await screen.findByText("£400.00");
  expect(screen.getByText(/Money received is not profit/)).toHaveTextContent(
    "1 balance needs review",
  );
  expect(screen.getByText("£700.00")).toBeVisible();
  expect(await screen.findByText("125")).toBeVisible();
  expect(
    screen.getByText(/not unique people or conversion rates/),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Download website events CSV" }),
  ).toBeVisible();
  expect(
    state.fetch.mock.calls.some(([url]) =>
      url.startsWith("/api/staff/website-journey?from="),
    ),
  ).toBe(true);
});
it("hides owner tools and makes no report/config requests for a salesperson", async () => {
  state.role = "salesperson";
  show(
    <>
      <OwnerSetup />
      <OwnerOperationsReport />
    </>,
  );
  await waitFor(() =>
    expect(screen.queryByText("Owner report")).not.toBeInTheDocument(),
  );
  expect(state.fetch).not.toHaveBeenCalled();
});
