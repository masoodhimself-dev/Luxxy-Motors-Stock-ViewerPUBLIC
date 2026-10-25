import { beforeEach, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const state = vi.hoisted(() => ({
  fetch: vi.fn(),
  writable: true,
  selected: true,
  vehicleId: "11111111-1111-4111-8111-111111111111",
  staffId: 'staff-one',
  dealerId: 'dealer-one',
  navigate: vi.fn(),
}));
vi.mock("wouter", () => ({
  useSearch: () => (state.selected ? `?vehicleId=${state.vehicleId}` : ""),
  useLocation: () => ["", state.navigate],
  Link: ({ children, href }: any) => <a href={href}>{children}</a>,
}));
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: any[]) => state.fetch(...args),
  getGetDealerSettingsQueryKey: () => ['/api/dealer-settings'],
  useGetStaffDirectory: () => ({
    data: {
      currentUserId: "staff-one",
      members: [{ id: "staff-one", name: "Sam" }],
    },
  }),
}));
vi.mock("./dealer-administration", () => ({
  useStaffAccess: () => ({
    data: { permissions: state.writable ? ["sales.manage"] : [], user: { authUserId: state.staffId } },
  }),
}));
vi.mock("./enquiry-email-composer", () => ({
  EnquiryEmailComposer: ({ entry }: any) => (
    <div data-testid="inventory-selected-enquiry" data-enquiry-id={entry.id}>Email customer {entry.customerName}</div>
  ),
}));
vi.mock("./enquiry-workspace-tools", () => ({
  workspaceError: (e: any) => e.data?.error || e.message,
}));
import { StaffInventory } from "./staff-inventory";
import { staffRecentCarsKey } from '@/lib/staff-recent-cars';
const id = "11111111-1111-4111-8111-111111111111";
const car = {
  id,
  title: "Ford Focus",
  price: 9000,
  plate: "AB12CDE",
  vrm: null,
  registration: "2012",
  inventory_status: "reserved",
  source_status: "live",
  photo: "https://images.example.test/car.jpg",
};
beforeEach(() => {
  sessionStorage.clear();
  state.staffId = 'staff-one';
  state.dealerId = 'dealer-one';
  state.writable = true;
  state.selected = true;
  state.vehicleId = id;
  state.navigate.mockReset();
  state.fetch
    .mockReset()
    .mockImplementation(async (url: string, options: any) => {
      if (url === '/api/staff/phone-sharing-settings') return { revision: 0, enabled: true };
      if (options?.method === "PUT" || options?.method === "POST")
        return url.endsWith("/upload-session")
          ? {
              id: "grant",
              url: "https://example.test/staff-upload#token",
              expiresAt: new Date(Date.now() + 900000).toISOString(),
              category: JSON.parse(options.body).category,
            }
          : { saved: true };
      if (url.endsWith("/customers"))
        return {
          customers: [
            {
              id: "customer",
              customerName: "Alex",
              reference: "ENQ-001",
              email: "alex@example.test",
            },
          ],
        };
      if (url === "/api/staff/inventory") return { dealerId: state.dealerId, cars: [car] };
      return {
        dealerId: state.dealerId,
        car,
        preparation: {
          revision: 0,
          tasks: {
            cleaning: "pending",
            inspection: "pending",
            mot: "pending",
            servicing: "pending",
          },
          assigned_to_id: null,
          due_date: null,
          notes: "",
        },
        photos: [],
      };
    });
});
function mount(props: Parameters<typeof StaffInventory>[0] = {}) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <StaffInventory {...props} />
    </QueryClientProvider>,
  );
}
it("keeps full-size plate inspection available and only saves corrections explicitly", async () => {
  mount();
  const field = await screen.findByRole("textbox", { name: "Number plate" });
  fireEvent.change(field, { target: { value: "xy22 zzz" } });
  expect(
    state.fetch.mock.calls.filter((c) => c[1]?.method === "PUT"),
  ).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Save number plate" }));
  await waitFor(() =>
    expect(state.fetch).toHaveBeenCalledWith(
      `/api/staff/inventory/${id}/plate`,
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ plate: "XY22 ZZZ", expectedPlate: "AB12CDE" }),
      }),
    ),
  );
  expect(
    screen.getByRole("link", { name: "Open full-size photo" }),
  ).toHaveAttribute("href", car.photo);
});
it("creates a pre-accident QR and opens the existing email review for a linked customer", async () => {
  mount();
  await screen.findByRole("button", { name: "Pre-accident photos" });
  fireEvent.click(screen.getByRole("button", { name: "Pre-accident photos" }));
  fireEvent.click(screen.getByRole("button", { name: "Upload from phone" }));
  await waitFor(() =>
    expect(state.fetch).toHaveBeenCalledWith(
      `/api/staff/inventory/${id}/upload-session`,
      expect.objectContaining({
        body: JSON.stringify({ category: "pre_accident" }),
      }),
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Customers" }));
  fireEvent.change(
    screen.getByRole("combobox", { name: "Choose customer or enquiry" }),
    { target: { value: "customer" } },
  );
  expect(screen.getByText("Email customer Alex")).toBeInTheDocument();
});
it('distinguishes same-name enquiries and opens the exact selected customer thread', async () => {
  const normal = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async (url: string, options: unknown) => url.endsWith('/customers') ? {
    customers: [
      { id: 'enquiry-first', customerName: 'Alex Taylor', reference: 'ENQ-001', email: 'alex.first@example.test' },
      { id: 'enquiry-second', customerName: 'Alex Taylor', reference: 'ENQ-002', email: 'alex.second@example.test' },
      { id: 'enquiry-phone', customerName: 'Alex Taylor', reference: 'ENQ-003', email: null },
    ],
  } : normal(url, options));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Customers' }));
  const selector = screen.getByRole('combobox', { name: 'Choose customer or enquiry' });
  expect(within(selector).getByRole('option', { name: 'Alex Taylor · ENQ-001 · alex.first@example.test' })).toHaveValue('enquiry-first');
  expect(within(selector).getByRole('option', { name: 'Alex Taylor · ENQ-002 · alex.second@example.test' })).toHaveValue('enquiry-second');
  expect(within(selector).getByRole('option', { name: 'Alex Taylor · ENQ-003' })).toHaveValue('enquiry-phone');
  fireEvent.change(selector, { target: { value: 'enquiry-second' } });
  expect(screen.getByTestId('inventory-selected-enquiry')).toHaveAttribute('data-enquiry-id', 'enquiry-second');
  fireEvent.change(selector, { target: { value: 'enquiry-phone' } });
  expect(screen.getByTestId('inventory-selected-enquiry')).toHaveAttribute('data-enquiry-id', 'enquiry-phone');
  expect(state.fetch.mock.calls.some(([, options]) => options?.method && options.method !== 'GET')).toBe(false);
});
it("requires confirmation to unreserve and hides editing from read-only staff", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Unreserve car" }));
  expect(state.fetch.mock.calls.some((c) => c[0].endsWith("/unreserve"))).toBe(
    false,
  );
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Unreserve car" }));
  await waitFor(() =>
    expect(state.fetch).toHaveBeenCalledWith(
      `/api/staff/inventory/${id}/unreserve`,
      expect.objectContaining({ body: JSON.stringify({ confirm: true }) }),
    ),
  );
  confirm.mockRestore();
});
it("keeps the plate readable for staff without edit permission", async () => {
  state.writable = false;
  mount();
  await screen.findByText("Ford Focus");
  expect(
    screen.queryByRole("button", { name: "Save number plate" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Unreserve car" }),
  ).not.toBeInTheDocument();
});

it("loads archived cars separately and searches across older archive pages", async () => {
  state.selected = false;
  const archived = {
    ...car,
    id: "archive-one",
    title: "Older Toyota",
    inventory_status: "archived",
    archived_at: "2026-01-01T00:00:00Z",
  };
  const oldest = {
    ...archived,
    id: "archive-two",
    title: "Oldest needle vehicle",
    plate: "ZX99OLD",
  };
  state.fetch.mockImplementation(async (url: string) => {
    const parsed = new URL(url, "https://fictional.example.test");
    if (parsed.searchParams.has("q"))
      return {
        cars: [oldest],
        counts: { current: 1, archived: 2 },
        matchedCount: 1,
        nextCursor: null,
      };
    if (parsed.searchParams.get("scope") === "archived")
      return parsed.searchParams.has("cursor")
        ? {
            cars: [oldest],
            counts: { current: 1, archived: 2 },
            matchedCount: 2,
            nextCursor: null,
          }
        : {
            cars: [archived],
            counts: { current: 1, archived: 2 },
            matchedCount: 2,
            nextCursor: "older-cars",
          };
    return {
      cars: [car],
      counts: { current: 1, archived: 2 },
      matchedCount: 1,
      nextCursor: null,
    };
  });
  mount();
  expect(await screen.findByText("Ford Focus")).toBeVisible();
  expect(screen.queryByText("Older Toyota")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Archived/ }));
  expect(await screen.findByText("Older Toyota")).toBeVisible();
  expect(screen.queryByText("Ford Focus")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("combobox", { name: "Preparation" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("combobox", { name: "Sort cars" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText("Showing 1 of 2 matching archived cars."),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Load older archived cars" }),
  );
  expect(await screen.findByText("Oldest needle vehicle")).toBeVisible();
  expect(
    screen.getByText("Showing 2 of 2 matching archived cars."),
  ).toBeVisible();
  fireEvent.change(screen.getByRole("textbox", { name: "Search cars" }), {
    target: { value: "needle" },
  });
  await waitFor(() =>
    expect(
      state.fetch.mock.calls.some(([url]) => String(url).includes("q=needle")),
    ).toBe(true),
  );
  expect(
    await screen.findByText("Showing 1 of 1 matching archived cars."),
  ).toBeVisible();
  expect(screen.queryByText("Older Toyota")).not.toBeInTheDocument();
  expect(
    state.fetch.mock.calls.every(
      ([, options]) => !options?.method || options.method === "GET",
    ),
  ).toBe(true);
});

it("keeps car identity, price, photos and availability clear without preparation clutter", async () => {
  state.selected = false;
  state.fetch.mockResolvedValue({
    cars: [
      { ...car, year: 2020, mileage: 52000, fuel: "Petrol", transmission: "Manual", variant:"1.0 EcoBoost Titanium", trim:"Titanium", body_type:"Hatchback", engine_size:"1.0L", colour:"Blue", doors:5, seats:5, tasks: {cleaning: "done", inspection: "pending", mot: "not_required", servicing: "pending"}, service_photo_count: 2, assigned_to_id: "staff-one", due_date: "2000-01-01" },
      { ...car, id: "second", title: "BMW 1 Series", price: 5000, plate: "ZX22ABC", inventory_status: "available" },
      { ...car, id: "third", title: "Toyota Yaris", price: null, plate: null, vrm: null, registration: null, photo: null, inventory_status: "hidden" },
    ],
    counts: { current: 3, archived: 12 }, matchedCount: 3, nextCursor: null,
  });
  mount();
  expect(await screen.findByRole("heading", { name: "Ford Focus" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Cars", level: 2 })).toBeVisible();
  const row = screen.getByRole('heading',{name:'Ford Focus'}).closest('article')!;
  for (const value of ['2020','52,000 miles','Petrol','Manual','Hatchback','Blue','1.0L','5 doors / 5 seats']) expect(within(row).getByText(value)).toBeVisible();
  expect(within(row).getByText('1.0 EcoBoost Titanium')).toBeVisible();
  expect(screen.getByText("2 service photos")).toBeVisible();
  expect(screen.queryByRole("combobox", { name: "Preparation" })).not.toBeInTheDocument();
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  expect(screen.queryByText(/preparation checks|Preparation not started|Overdue 1 Jan/)).not.toBeInTheDocument();
  expect(screen.queryByText("Sam")).not.toBeInTheDocument();
  expect(screen.getByText("Registration not supplied")).toBeVisible();
  expect(screen.getByText("Price not supplied")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Available" }));
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(screen.getByRole("heading", { name: "BMW 1 Series" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "All current" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Sort cars" }), { target: { value: "price-low" } });
  expect(screen.getAllByRole("article").map(row => within(row).getByRole("heading").textContent)).toEqual(["BMW 1 Series", "Ford Focus", "Toyota Yaris"]);
  const photo = screen.getByRole("button", { name: "Open Ford Focus photo and vehicle details" });
  expect(photo.querySelector(".inventory-photo-enlarged")).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open Ford Focus, AB12CDE" }));
  expect(state.navigate).toHaveBeenCalledWith(`/portal?section=inventory&vehicleId=${id}`);
  expect(state.fetch.mock.calls.every(([, options]) => !options?.method || options.method === "GET")).toBe(true);
});
it("searches on the server after trimming input and handles missing photos without broken image rows", async () => {
  state.selected = false;
  state.fetch.mockResolvedValue({
    cars: [car],
    counts: { current: 1, archived: 0 },
    matchedCount: 1,
    nextCursor: null,
  });
  mount();
  const image = await screen.findByRole("img", { name: "Ford Focus" });
  fireEvent.error(image);
  expect(screen.getByText("No photo")).toBeVisible();
  fireEvent.change(screen.getByRole("textbox", { name: "Search cars" }), {
    target: { value: "  AB12CDE  " },
  });
  expect(screen.getByRole("heading", { name: "Ford Focus" })).toBeVisible();
  await waitFor(() =>
    expect(
      state.fetch.mock.calls.some(([url]) => String(url).includes("q=AB12CDE")),
    ).toBe(true),
  );
  expect(
    state.fetch.mock.calls.some(([url]) => String(url).includes("q=++")),
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Clear car search" }));
  expect(screen.getByRole("textbox", { name: "Search cars" })).toHaveValue("");
});

it("lets preview cards open while keeping every mutation and email action disabled", async () => {
  const normal = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async (url: string, options: unknown) => ({
    ...(await normal(url, options)),
    previewReadOnly: true,
  }));
  mount();
  expect(
    await screen.findByRole("heading", { name: "Ford Focus" }),
  ).toBeVisible();
  expect(screen.getByText(/Read-only preview/)).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Save number plate" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Save preparation" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Unreserve car" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Upload from phone" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Customers" }));
  expect(
    screen.getByRole("combobox", { name: "Choose customer or enquiry" }),
  ).toBeDisabled();
  expect(screen.queryByText("Email customer Alex")).not.toBeInTheDocument();
  expect(
    state.fetch.mock.calls.every(
      ([, options]) => !options?.method || options.method === "GET",
    ),
  ).toBe(true);
});

it.each(["accepted", "rejected"] as const)(
  "does not display another car's late %s upload result after navigation",
  async (outcome) => {
    const secondId = "22222222-2222-4222-8222-222222222222";
    const normal = state.fetch.getMockImplementation()!;
    let resolveGrant!: (value: unknown) => void;
    let rejectGrant!: (error: Error) => void;
    const delayedGrant = new Promise((resolve, reject) => {
      resolveGrant = resolve;
      rejectGrant = reject;
    });
    state.fetch.mockImplementation(async (url: string, options: any) => {
      if (url.endsWith("/upload-session") && options?.method === "POST")
        return delayedGrant;
      const value = await normal(url, options);
      return url.endsWith(`/${secondId}`)
        ? { ...value, car: { ...car, id: secondId, title: "Toyota Yaris" } }
        : value;
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const renderWorkspace = () => (
      <QueryClientProvider client={client}>
        <StaffInventory />
      </QueryClientProvider>
    );
    const view = render(renderWorkspace());
    fireEvent.click(
      await screen.findByRole("button", { name: "Upload from phone" }),
    );
    await waitFor(() =>
      expect(
        state.fetch.mock.calls.some(
          ([url, options]) =>
            url.endsWith("/upload-session") && options?.method === "POST",
        ),
      ).toBe(true),
    );
    state.vehicleId = secondId;
    view.rerender(renderWorkspace());
    await screen.findByRole("heading", { name: "Toyota Yaris" });
    if (outcome === "accepted")
      resolveGrant({
        id: "first-car-only",
        url: "https://example.test/staff-upload#first-car-token",
        expiresAt: new Date(Date.now() + 900000).toISOString(),
        category: "service_book",
      });
    else rejectGrant(new Error("First car upload failed."));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Upload from phone" }),
      ).toBeEnabled(),
    );
    expect(
      screen.queryByText("Scan the QR code using your phone camera."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("First car upload failed."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Open upload page on this device" }),
    ).not.toBeInTheDocument();
  },
);

it("finds missing plates and service photos without mistaking an age identifier for a number plate", async () => {
  state.selected = false;
  state.fetch.mockResolvedValue({
    cars: [
      { ...car, title: "Needs plate", plate: null, registration: "2019 (68 reg)", inventory_status: "available", service_photo_count: 0 },
      { ...car, id: "confirmed", title: "Confirmed registration", plate: null, registration: "XY22 ZZZ", service_photo_count: 2 },
      { ...car, id: "later", title: "Later vehicle", inventory_status: "available", service_photo_count: 0 },
      { ...car, id: "sold", title: "Sold vehicle", inventory_status: "sold", service_photo_count: 3 },
    ],
    counts: { current: 4, archived: 0 },
  });
  mount();
  const checks = await screen.findByRole("group", { name: "Cars to check" });
  expect(within(checks).getByRole("button", { name: "Missing number plate 1" })).toHaveAttribute("data-tone", "warning");
  expect(within(checks).getByRole("button", { name: "No service-book photos 2" })).toHaveAttribute("data-tone", "info");
  expect(within(checks).queryByRole("button", { name: /Overdue preparation/ })).not.toBeInTheDocument();
  fireEvent.click(within(checks).getByRole("button", { name: "Missing number plate 1" }));
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(screen.getByRole("heading", { name: "Needs plate" })).toBeVisible();
  expect(screen.getByText("Plate needed")).toBeVisible();
  fireEvent.click(within(checks).getByRole("button", { name: "No service-book photos 2" }));
  expect(screen.getAllByRole("article")).toHaveLength(2);
  fireEvent.click(within(checks).getByRole("button", { name: "No service-book photos 2" }));
  expect(screen.getAllByRole("article")).toHaveLength(4);
  expect(state.fetch.mock.calls.every(([, options]) => !options?.method || options.method === "GET")).toBe(true);
});

it("starts a car-specific quick enquiry from the car actions without navigating or changing stock", async () => {
  state.selected = false;
  const onQuickEnquiry = vi.fn();
  mount({ onQuickEnquiry });
  const actions = await screen.findByRole("button", {
    name: "Actions for Ford Focus, AB12CDE",
  });
  fireEvent.keyDown(actions, { key: "Enter" });
  fireEvent.click(
    await screen.findByRole("menuitem", { name: "Quick enquiry" }),
  );
  expect(onQuickEnquiry).toHaveBeenCalledWith(id);
  expect(state.navigate).not.toHaveBeenCalled();
  expect(
    state.fetch.mock.calls.every(
      ([, options]) => !options?.method || options.method === "GET",
    ),
  ).toBe(true);
});

it.each([true, false])(
  "copies an advert link or exposes a usable manual fallback when clipboard permission is %s",
  async (allowed) => {
    state.selected = false;
    const writeText = vi.fn(async () => {
      if (!allowed) throw new Error("Permission denied");
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    mount();
    fireEvent.keyDown(
      await screen.findByRole("button", {
        name: "Actions for Ford Focus, AB12CDE",
      }),
      { key: "Enter" },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Copy customer link" }),
    );
    const expected = new URL(`/vehicle/${id}`, window.location.origin).href;
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expected));
    expect(
      await screen.findByText(
        allowed
          ? "Customer link copied."
          : "Copy the customer link below, or open it and share the address.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: expected })).toHaveAttribute(
      "href",
      expected,
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
  },
);

it("keeps customer activity available but hides enquiry capture and sharing for archived cars", async () => {
  state.selected = false;
  state.fetch.mockResolvedValue({
    cars: [{ ...car, archived_at: "2026-01-01", inventory_status: "archived" }],
    counts: { current: 0, archived: 1 },
  });
  const onQuickEnquiry = vi.fn();
  mount({ onQuickEnquiry });
  fireEvent.click(screen.getByRole("button", { name: /Archived/ }));
  fireEvent.keyDown(
    await screen.findByRole("button", {
      name: "Actions for Ford Focus, AB12CDE",
    }),
    { key: "Enter" },
  );
  expect(
    screen.queryByRole("menuitem", { name: "Quick enquiry" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("menuitem", { name: "Copy customer link" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("group", { name: "Cars to check" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("menuitem", { name: "Customer activity" }));
  expect(state.navigate).toHaveBeenCalledWith(
    `/portal?section=history&view=vehicles&vehicleId=${id}`,
  );
});

it("does not offer a quick enquiry to read-only staff", async () => {
  state.writable = false;
  mount({ onQuickEnquiry: vi.fn() });
  fireEvent.keyDown(
    await screen.findByRole("button", {
      name: "Actions for Ford Focus, AB12CDE",
    }),
    { key: "Enter" },
  );
  expect(
    screen.queryByRole("menuitem", { name: "Quick enquiry" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("menuitem", { name: "Customer activity" }),
  ).toBeVisible();
});

it.each(['68 reg', '2019 (68 reg)', '2019'])('offers quick plate entry for an age identifier %s', async registration => {
  state.selected = false;
  state.fetch.mockResolvedValue({cars: [{...car, plate: null, vrm: null, registration}], counts: {current: 1, archived: 0}});
  mount();
  expect(await screen.findByRole('button', {name: 'Missing number plate 1'})).toBeVisible();
  expect(screen.getByRole('button', {name: 'Add number plates'})).toBeEnabled();
});

it('uses the shared title formatting for staff car rows without changing source records', async () => {
  state.selected = false;
  state.fetch.mockResolvedValue({cars: [{...car, title: '2025 MG MG HS', make: 'MG', year: 2025}], counts: {current: 1, archived: 0}});
  mount();
  expect(await screen.findByRole('heading', {name: 'MG HS'})).toBeVisible();
  expect(screen.queryByRole('heading', {name: '2025 MG MG HS'})).not.toBeInTheDocument();
});

it("shows a failed customer lookup honestly and retries without suggesting duplicate enquiries", async () => {
  const normal = state.fetch.getMockImplementation()!;
  let customerReads = 0;
  state.fetch.mockImplementation(async (url: string, options: unknown) => {
    if (url.endsWith("/customers") && ++customerReads === 1)
      throw new Error("Temporary customer lookup failure");
    return normal(url, options);
  });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Customers" }));
  expect(await screen.findByText("Customer enquiries could not be loaded.")).toBeVisible();
  expect(screen.queryByText(/Log a customer enquiry for this car first/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry customer enquiries" }));
  await waitFor(() => expect(screen.queryByText("Customer enquiries could not be loaded.")).not.toBeInTheDocument());
  expect(screen.getByRole("combobox", { name: "Choose customer or enquiry" })).toBeEnabled();
  fireEvent.change(screen.getByRole("combobox", { name: "Choose customer or enquiry" }), { target: { value: "customer" } });
  expect(screen.getByText("Email customer Alex")).toBeVisible();
  expect(customerReads).toBe(2);
  expect(state.fetch.mock.calls.every(([, options]) => !options?.method || options.method === "GET")).toBe(true);
});

it.each([
  { name: "sold", inventory_status: "sold" },
  { name: "hidden", inventory_status: "hidden" },
  { name: "source-missing", source_status: "missing" },
  { name: "archived", archived_at: "2026-01-01T00:00:00Z" },
])("keeps $name car history accessible without offering its customer page", async ({ name: _name, ...unavailable }) => {
  const normal = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async (url: string, options: unknown) => {
    const result = await normal(url, options);
    return url === `/api/staff/inventory/${id}` ? { ...result, car: { ...car, ...unavailable } } : result;
  });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Customers" }));
  expect(screen.queryByRole("link", { name: "Customer vehicle page" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open vehicle activity" })).toHaveAttribute("href", `/portal?section=history&view=vehicles&vehicleId=${id}`);
});

it("starts with photos and keeps other work in focused sections without preparation", async () => {
  mount();
  expect(await screen.findByRole("heading", { name: "Private photos" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Photos & video" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByRole("button", { name: "Preparation" })).not.toBeInTheDocument();
  expect(screen.queryByRole("checkbox", { name: "Cleaning & presentation" })).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "Internal notes" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Save preparation" })).not.toBeInTheDocument();
  expect(screen.queryByRole("combobox", { name: "Choose customer or enquiry" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Customers" }));
  expect(screen.getByRole("combobox", { name: "Choose customer or enquiry" })).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Private photos" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Photos & video" }));
  expect(screen.getByRole("heading", { name: "Private photos" })).toBeVisible();
  expect(state.fetch.mock.calls.every(([, options]) => !options?.method || options.method === "GET")).toBe(true);
});

it('keeps zero mileage, uses recorded engine capacity and omits unavailable details', async () => {
 state.selected = false;
 state.fetch.mockResolvedValue({cars:[{...car,mileage:0,engine_size:null,engine_cc:1498,variant:'SE',trim:'SE',colour:null,body_type:null}],counts:{current:1,archived:0}});
 mount();
 const row = (await screen.findByRole('heading',{name:'Ford Focus'})).closest('article')!;
 expect(within(row).getByText('0 miles')).toBeVisible();
 expect(within(row).getByText('1,498 cc')).toBeVisible();
 expect(within(row).getByText('SE')).toBeVisible();
 expect(within(row).queryByText('Colour')).not.toBeInTheDocument();
 expect(within(row).queryByText('Body')).not.toBeInTheDocument();
});

it('reopens only accessible recent cars, uses fresh titles and clears staff history without touching public history', async () => {
 const key = staffRecentCarsKey(state.dealerId, state.staffId)!;
 const view = mount();
 await screen.findByRole('textbox', {name:'Number plate'});
 await waitFor(() => expect(JSON.parse(sessionStorage.getItem(key)!)).toEqual([id]));
 view.unmount();
 sessionStorage.setItem(key, JSON.stringify([id, 'foreign-dealer-car']));
 sessionStorage.setItem('luxxy:recently-viewed', 'public-history');
 state.selected = false;
 mount();
 const recent = await screen.findByRole('navigation', {name:'Recently viewed cars'});
 expect(within(recent).getByRole('button', {name:'Reopen Ford Focus, AB12CDE'})).toBeVisible();
 expect(within(recent).queryByText('foreign-dealer-car')).not.toBeInTheDocument();
 fireEvent.click(within(recent).getByRole('button', {name:'Reopen Ford Focus, AB12CDE'}));
 expect(state.navigate).toHaveBeenCalledWith(`/portal?section=inventory&vehicleId=${id}`);
 fireEvent.click(within(recent).getByRole('button', {name:'Clear recent cars'}));
 expect(screen.queryByRole('navigation', {name:'Recently viewed cars'})).not.toBeInTheDocument();
 expect(sessionStorage.getItem(key)).toBeNull();
 expect(sessionStorage.getItem('luxxy:recently-viewed')).toBe('public-history');
 expect(state.fetch.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
});

it.each(['staff', 'dealer'])('does not show recent history from a different %s account', async change => {
 sessionStorage.setItem(staffRecentCarsKey(state.dealerId, state.staffId)!, JSON.stringify([id]));
 if (change === 'staff') state.staffId = 'staff-two'; else state.dealerId = 'dealer-two';
 state.selected = false;
 mount();
 await screen.findByRole('heading', {name:'Ford Focus'});
 expect(screen.queryByRole('navigation', {name:'Recently viewed cars'})).not.toBeInTheDocument();
});

it('does not record a failed car lookup, and browser storage failure never blocks the car workspace', async () => {
 const normal = state.fetch.getMockImplementation()!;
 state.fetch.mockImplementation(async (url: string, options: unknown) => {
   if (url === `/api/staff/inventory/${id}`) throw new Error('Access denied');
   return normal(url, options);
 });
 const failed = mount();
 await screen.findByText('Could not load this car. Refresh to retry.');
 expect(sessionStorage.getItem(staffRecentCarsKey(state.dealerId, state.staffId)!)).not.toContain(id);
 failed.unmount();
 state.fetch.mockImplementation(normal);
 const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {throw new Error('Storage blocked');});
 const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {throw new Error('Storage blocked');});
 try {
   mount();
   expect(await screen.findByRole('heading', {name:'Private photos'})).toBeVisible();
 } finally { read.mockRestore(); write.mockRestore(); }
});

it('shows open enquiry and future visit counts with verified latest import changes', async () => {
 const enriched = {...car, enquiry_count:3, upcoming_test_drive_count:1, next_test_drive_at:'2026-10-26T14:30:00Z', stock_changes:{checkedAt:'2026-10-24T09:00:00Z', items:[
   {kind:'price', changedAt:'2026-10-24T09:00:00Z', previousPrice:9500, currentPrice:9000},
   {kind:'photos', changedAt:'2026-10-24T09:00:00Z', previousPhotoCount:12, currentPhotoCount:15},
   {kind:'details', changedAt:'2026-10-24T09:00:00Z', fields:['Mileage','Description']},
 ]}};
 state.selected = false;
 state.fetch.mockResolvedValue({dealerId:state.dealerId, cars:[enriched]});
 const list = mount();
 const row = (await screen.findByRole('heading',{name:'Ford Focus'})).closest('article')!;
 expect(within(row).getByText('open enquiries')).toBeVisible();
 expect(within(row).getByText('upcoming test drive')).toHaveAttribute('title', 'Next test drive: 26 Oct, 14:30 (UK time)');
 expect(within(row).getByText('Price reduced: £9,500 → £9,000')).toBeVisible();
 expect(within(row).getByText('Photos updated: 12 → 15')).toBeVisible();
 expect(within(row).getByText('Details updated')).toBeVisible();
 list.unmount();
 state.selected = true;
 state.fetch.mockResolvedValue({dealerId:state.dealerId, car:enriched, cars:[enriched], preparation:{}, photos:[], customers:[]});
 mount();
 expect(await screen.findByText('Checked 24 Oct, 10:00 (UK time)')).toBeVisible();
 expect(screen.getByText('Details updated: Mileage, Description')).toBeVisible();
 expect(screen.getByText('Next test drive: 26 Oct, 14:30 (UK time)')).toBeVisible();
});

it('keeps unknown counts blank instead of pretending there are no customers', async () => {
 state.selected = false;
 mount();
 const row = (await screen.findByRole('heading',{name:'Ford Focus'})).closest('article')!;
 expect(within(row).queryByText(/open enquiries|upcoming test drives|Price reduced/)).not.toBeInTheDocument();
});

it('shows verified watcher counts separately from enquiries and hides unknown counts on a failed lookup', async () => {
  state.selected = false;
  const normal = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async (url: string, options: any) => url === '/api/staff/vehicle-watch-counts' ? { counts: [{ vehicleId: id, count: 4 }] } : normal(url, options));
  const active = mount();
  const row = (await screen.findByRole('heading', { name: 'Ford Focus' })).closest('article')!;
  expect(await within(row).findByText('customers watching')).toHaveTextContent('4 customers watching');
  expect(within(row).queryByText('open enquiries')).not.toBeInTheDocument();
  expect(state.fetch.mock.calls.every(([, options]) => !options?.method)).toBe(true);
  active.unmount();
  state.fetch.mockImplementation(async (url: string, options: any) => { if (url === '/api/staff/vehicle-watch-counts') throw new Error('temporarily unavailable'); return normal(url, options); });
  mount();
  const unknown = (await screen.findByRole('heading', { name: 'Ford Focus' })).closest('article')!;
  await waitFor(() => expect(state.fetch).toHaveBeenCalledWith('/api/staff/vehicle-watch-counts'));
  expect(within(unknown).queryByText(/customers watching|customer watching/)).not.toBeInTheDocument();
});
