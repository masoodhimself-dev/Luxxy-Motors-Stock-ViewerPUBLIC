import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DealerRelationships } from "@workspace/vehicle-meta";
import { RelationshipsPanel } from "./relationships-panel";

type Activity = DealerRelationships["vehicles"][number]["activities"][number];
const counts = { enquiries: 1, appointments: 1, reservations: 1, sales: 1 };
const enquiry: Activity = {
  id: "enquiry-event",
  kind: "enquiry",
  recordType: "enquiry",
  recordId: "enquiry-1",
  reference: "LM-ENQ-101",
  title: "Enquiry received",
  description: "Please confirm the service history.",
  status: "contacted",
  occurredAt: "2026-10-01T09:00:00Z",
  vehicleId: "car-1",
  customerId: "contact-1",
  amountPence: null,
  url: "/portal?section=enquiries&enquiryId=enquiry-1",
};
const activities: Activity[] = [
  enquiry,
  {
    ...enquiry,
    id: "appointment-event",
    kind: "appointment",
    title: "Test drive attended",
    status: "attended",
    occurredAt: "2026-10-02T09:00:00Z",
  },
  {
    ...enquiry,
    id: "reservation-event",
    kind: "reservation",
    recordType: "reservation",
    recordId: "reservation-1",
    reference: "LM-RES-201",
    title: "Car reserved",
    amountPence: 10000,
    status: "reserved",
    url: "/portal?section=reservations&reservationId=reservation-1",
  },
  {
    ...enquiry,
    id: "sale-event",
    kind: "sale",
    recordType: "sale",
    recordId: "sale-1",
    reference: "LM-SALE-301",
    title: "Sale completed",
    status: "completed",
    url: "/portal?section=sales&saleId=sale-1",
  },
  {
    ...enquiry,
    id: "payment-event",
    kind: "payment",
    recordType: "sale",
    recordId: "sale-1",
    reference: "LM-SALE-301",
    title: "Balance received",
    amountPence: 1499999,
    url: "/portal?section=sales&saleId=sale-1",
  },
  {
    ...enquiry,
    id: "document-event",
    kind: "document",
    recordType: "sale",
    recordId: "sale-1",
    reference: "LM-SALE-301",
    title: "Invoice issued",
    url: "/portal?section=sales&saleId=sale-1",
  },
];
function fixture(): DealerRelationships {
  return {
    generatedAt: "2026-10-05T09:00:00Z",
    vehicles: [
      {
        id: "car-1",
        title: "BMW 320i M Sport",
        registration: "AB20 BMW",
        pricePence: 1895000,
        imageUrl: null,
        status: "sold",
        lastActivityAt: "2026-10-02T09:00:00Z",
        customerIds: ["contact-1"],
        counts,
        activities: [...activities],
      },
      {
        id: "car-2",
        title: "Archived Mini Cooper",
        registration: null,
        pricePence: null,
        imageUrl: null,
        status: "archived",
        lastActivityAt: null,
        customerIds: [],
        counts: { enquiries: 0, appointments: 0, reservations: 0, sales: 0 },
        activities: [],
      },
    ],
    customers: [
      {
        id: "contact-1",
        name: "Alex Morgan",
        email: "alex@example.test",
        phone: "07700 900101",
        matchingNote:
          "Grouped by matching email or phone. Check these contact details before using them.",
        vehicleIds: ["car-1"],
        recordKeys: [
          "enquiry:enquiry-1",
          "reservation:reservation-1",
          "sale:sale-1",
        ],
        lastActivityAt: "2026-10-02T09:00:00Z",
        counts,
        activities: [...activities],
      },
      {
        id: "contact-2",
        name: "Sam Taylor",
        email: null,
        phone: null,
        matchingNote: "This record has no shared contact details.",
        vehicleIds: [],
        recordKeys: ["enquiry:enquiry-2"],
        lastActivityAt: null,
        counts: { enquiries: 1, appointments: 0, reservations: 0, sales: 0 },
        activities: [],
      },
    ],
  };
}
let data: DealerRelationships;
let fail: boolean;
let cache: QueryClient;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  data = fixture();
  fail = false;
  window.history.replaceState(
    null,
    "",
    "/portal?section=history&view=vehicles",
  );
  cache = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  fetchMock = vi.fn(async (input: RequestInfo | URL, options: RequestInit) => {
    expect(String(input)).toBe("/api/staff/relationships");
    expect(options.method).toBe("GET");
    return Response.json(fail ? { error: "Unavailable" } : data, {
      status: fail ? 503 : 200,
    });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cache.clear();
  vi.unstubAllGlobals();
});

function renderPanel(search?: string) {
  if (search) window.history.replaceState(null, "", `/portal?${search}`);
  render(
    <QueryClientProvider client={cache}>
      <RelationshipsPanel />
    </QueryClientProvider>,
  );
}
function detail() {
  return screen.getByRole("article", {
    name: /Selected (vehicle|customer) history/,
  });
}

it("preserves a deep-link selection while its first request is still loading", async () => {
  let resolveResponse!: (response: Response) => void;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      }),
  );
  renderPanel("section=history&view=customers&record=sale%3Asale-1");
  expect(screen.getByRole("status")).toHaveTextContent(
    "Loading vehicle and customer history",
  );
  expect(
    screen.queryByText("This history could not be found"),
  ).not.toBeInTheDocument();
  expect(window.location.search).toContain("record=sale%3Asale-1");
  await act(async () => resolveResponse(Response.json(data)));
  await screen.findByRole("article", { name: "Selected customer history" });
  expect(detail()).toHaveTextContent("Alex Morgan");
  expect(detail()).toHaveTextContent(data.customers[0].matchingNote);
  expect(window.location.search).toContain("record=sale%3Asale-1");
});

it("finds archived or sold vehicle history through a source record and links to the original records", async () => {
  renderPanel(
    "section=history&view=vehicles&record=reservation%3Areservation-1",
  );
  await screen.findByRole("article", { name: "Selected vehicle history" });
  expect(detail()).toHaveTextContent("BMW 320i M Sport");
  expect(detail()).toHaveTextContent("Sold");
  const timeline = screen.getByTestId("history-timeline");
  expect(
    within(timeline)
      .getByTestId("relationship-activity-enquiry-event")
      .querySelector("a"),
  ).toHaveAttribute("href", enquiry.url);
  expect(
    within(timeline).getByRole("link", { name: "Open reservation" }),
  ).toHaveAttribute(
    "href",
    "/portal?section=reservations&reservationId=reservation-1",
  );
  expect(
    within(timeline).getAllByRole("link", { name: "Open sale file" })[0],
  ).toHaveAttribute("href", "/portal?section=sales&saleId=sale-1");
  expect(within(timeline).getByText("£14,999.99")).toBeInTheDocument();
});

it("switches from an interested contact to their cars and updates the URL", async () => {
  renderPanel("section=history&view=vehicles&vehicleId=car-1");
  const connections = await screen.findByRole("region", {
    name: "Interested customers",
  });
  fireEvent.click(
    within(connections).getByRole("button", { name: /Alex Morgan/ }),
  );
  await screen.findByRole("article", { name: "Selected customer history" });
  expect(new URLSearchParams(window.location.search).get("customerId")).toBe(
    "contact-1",
  );
  expect(new URLSearchParams(window.location.search).get("record")).toBe(
    "enquiry:enquiry-1",
  );
  expect(detail()).toHaveTextContent("Grouped by matching email or phone");
  expect(
    within(detail()).getByRole("link", { name: "alex@example.test" }),
  ).toHaveAttribute("href", "mailto:alex@example.test");
  fireEvent.click(
    within(
      screen.getByRole("region", { name: "Cars in this history" }),
    ).getByRole("button", { name: /BMW 320i M Sport/ }),
  );
  await screen.findByRole("article", { name: "Selected vehicle history" });
  expect(new URLSearchParams(window.location.search).get("vehicleId")).toBe(
    "car-1",
  );
  expect(new URLSearchParams(window.location.search).has("customerId")).toBe(
    false,
  );
});

it("responds to browser URL changes and returns to the directory without discarding data", async () => {
  renderPanel("section=history&view=vehicles&vehicleId=car-1");
  await screen.findByRole("article", { name: "Selected vehicle history" });
  act(() => {
    window.history.pushState(
      null,
      "",
      "/portal?section=history&view=customers&record=enquiry%3Aenquiry-2",
    );
  });
  await screen.findByRole("article", { name: "Selected customer history" });
  expect(detail()).toHaveTextContent("Sam Taylor");
  fireEvent.click(screen.getByRole("button", { name: "Back to customers" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("article", { name: "Selected customer history" }),
    ).not.toBeInTheDocument(),
  );
  expect(new URLSearchParams(window.location.search).get("view")).toBe(
    "customers",
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("searches registration, phone and source references, including stored spaces", async () => {
  renderPanel();
  await screen.findByTestId("relationship-vehicle-car-1");
  fireEvent.change(screen.getByLabelText("Search vehicle history"), {
    target: { value: "AB20BMW" },
  });
  expect(screen.getByTestId("relationship-vehicle-car-1")).toBeInTheDocument();
  expect(
    screen.queryByTestId("relationship-vehicle-car-2"),
  ).not.toBeInTheDocument();
  fireEvent.click(
    within(screen.getByRole("navigation", { name: "History views" })).getByRole(
      "button",
      { name: /Customer history/ },
    ),
  );
  fireEvent.change(screen.getByLabelText("Search customer history"), {
    target: { value: "07700900101" },
  });
  expect(
    screen.getByTestId("relationship-customer-contact-1"),
  ).toBeInTheDocument();
  expect(
    screen.queryByTestId("relationship-customer-contact-2"),
  ).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Search customer history"), {
    target: { value: "LM-RES-201" },
  });
  expect(
    screen.getByTestId("relationship-customer-contact-1"),
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Search customer history"), {
    target: { value: "Missing contact" },
  });
  expect(screen.getByText("No matching histories")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(
    screen.getByTestId("relationship-customer-contact-2"),
  ).toBeInTheDocument();
});

it("includes payments and documents in the sales filter while isolating appointments", async () => {
  renderPanel("section=history&view=customers&customerId=contact-1");
  const timeline = await screen.findByTestId("history-timeline");
  const filters = within(timeline).getByRole("group", {
    name: "Filter activity timeline",
  });
  fireEvent.click(within(filters).getByRole("button", { name: "Sales" }));
  expect(
    within(filters).getByRole("button", { name: "Sales" }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(within(timeline).getByText("Balance received")).toBeInTheDocument();
  expect(within(timeline).getByText("Invoice issued")).toBeInTheDocument();
  expect(
    within(timeline).queryByText("Test drive attended"),
  ).not.toBeInTheDocument();
  fireEvent.click(
    within(filters).getByRole("button", { name: "Appointments" }),
  );
  expect(within(timeline).getByText("Test drive attended")).toBeInTheDocument();
  expect(
    within(timeline).queryByText("Enquiry received"),
  ).not.toBeInTheDocument();
  expect(
    within(timeline).queryByText("Invoice issued"),
  ).not.toBeInTheDocument();
});

it("keeps a long staff message accessible through an explicit expansion control", async () => {
  const message =
    "An extended customer message. ".repeat(16) +
    "The final detail must remain accessible.";
  data.vehicles[0].activities = [{ ...enquiry, description: message }];
  renderPanel("section=history&view=vehicles&vehicleId=car-1");
  const activity = await screen.findByTestId(
    "relationship-activity-enquiry-event",
  );
  expect(activity).not.toHaveTextContent(
    "The final detail must remain accessible.",
  );
  fireEvent.click(
    within(activity).getByRole("button", { name: "Read full message" }),
  );
  expect(activity).toHaveTextContent(
    "The final detail must remain accessible.",
  );
  expect(
    within(activity).getByRole("button", { name: "Show less" }),
  ).toHaveAttribute("aria-expanded", "true");
});

it("distinguishes a failed load from an empty history and supports retry", async () => {
  fail = true;
  renderPanel("section=history&view=vehicles&vehicleId=car-2");
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "History could not be loaded.",
  );
  expect(
    screen.queryByText("No activity recorded yet"),
  ).not.toBeInTheDocument();
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByText("No activity recorded yet");
  expect(detail()).toHaveTextContent("Archived Mini Cooper");
  expect(detail()).not.toHaveTextContent(/Unknown|Not supplied|Unavailable|£0/);
  expect(within(detail()).queryByRole("img")).not.toBeInTheDocument();
});

it("does not silently replace an unavailable requested profile with a different customer", async () => {
  renderPanel("section=history&view=customers&customerId=deleted-contact");
  await screen.findByText("This history could not be found");
  expect(
    screen.queryByRole("article", { name: "Selected customer history" }),
  ).not.toBeInTheDocument();
  expect(new URLSearchParams(window.location.search).get("customerId")).toBe(
    "deleted-contact",
  );
});
