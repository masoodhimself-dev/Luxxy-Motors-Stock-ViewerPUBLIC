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
  navigate: vi.fn(),
}));
vi.mock("wouter", () => ({
  useSearch: () =>
    state.selected ? `?vehicleId=${state.vehicleId}` : "",
  useLocation: () => ["", state.navigate],
  Link: ({ children, href }: any) => <a href={href}>{children}</a>,
}));
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: any[]) => state.fetch(...args),
  useGetStaffDirectory: () => ({ data: { members: [] } }),
}));
vi.mock("./dealer-administration", () => ({
  useStaffAccess: () => ({
    data: { permissions: state.writable ? ["sales.manage"] : [] },
  }),
}));
vi.mock("./enquiry-email-composer", () => ({
  EnquiryEmailComposer: ({ entry }: any) => (
    <div>Email customer {entry.customerName}</div>
  ),
}));
vi.mock("./enquiry-workspace-tools", () => ({
  workspaceError: (e: any) => e.data?.error || e.message,
}));
import { StaffInventory } from "./staff-inventory";
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
  state.writable = true;
  state.selected = true;
  state.vehicleId = id;
  state.navigate.mockReset();
  state.fetch
    .mockReset()
    .mockImplementation(async (url: string, options: any) => {
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
      if (url === "/api/staff/inventory") return { cars: [car] };
      return {
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
function mount() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <StaffInventory />
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
  fireEvent.change(
    screen.getByRole("combobox", { name: "Choose customer to email" }),
    { target: { value: "customer" } },
  );
  expect(screen.getByText("Email customer Alex")).toBeInTheDocument();
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
  fireEvent.change(screen.getByRole("combobox", { name: "Preparation" }), {
    target: { value: "cleared" },
  });
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

it("keeps the stock list compact, identifies cars clearly and filters preparation without changing stock", async () => {
  state.selected = false;
  const tasks = {
    cleaning: "done",
    inspection: "pending",
    mot: "not_required",
    servicing: "pending",
  };
  const rows = [
    {
      ...car,
      year: 2020,
      mileage: 52000,
      fuel: "Petrol",
      transmission: "Manual",
      tasks,
      service_photo_count: 2,
      assigned_to_id: "staff-one",
      due_date: "2026-10-20",
    },
    {
      ...car,
      id: "second",
      title: "BMW 1 Series",
      price: 5000,
      plate: "ZX22ABC",
      inventory_status: "available",
      tasks: {
        cleaning: "done",
        inspection: "done",
        mot: "not_required",
        servicing: "done",
      },
      assigned_to_id: null,
    },
    {
      ...car,
      id: "third",
      title: "Toyota Yaris",
      price: null,
      plate: null,
      vrm: null,
      registration: null,
      photo: null,
      inventory_status: "hidden",
      tasks: null,
      assigned_to_id: "staff-one",
    },
  ];
  state.fetch.mockResolvedValue({
    cars: rows,
    counts: { current: 3, archived: 12 },
    matchedCount: 3,
    nextCursor: null,
  });
  mount();
  expect(
    await screen.findByRole("heading", { name: "Ford Focus" }),
  ).toBeVisible();
  expect(screen.getByRole("heading", { name: "Cars", level: 2 })).toBeVisible();
  expect(screen.queryByText("Your showroom")).not.toBeInTheDocument();
  expect(
    screen.queryByText(
      "Private service records, preparation and customer activity.",
    ),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText("2020 · 52,000 miles · Petrol · Manual"),
  ).toBeVisible();
  expect(screen.getByText("2/3 service photos")).toBeVisible();
  expect(
    screen.getByRole("progressbar", {
      name: "Ford Focus preparation checks cleared",
    }),
  ).toHaveAttribute("aria-valuenow", "2");
  expect(screen.getByText("Registration not supplied")).toBeVisible();
  expect(screen.getByText("Price not supplied")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Available" }));
  expect(
    screen.queryByRole("heading", { name: "Ford Focus" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "BMW 1 Series" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "All current" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Preparation" }), {
    target: { value: "cleared" },
  });
  expect(screen.getAllByRole("article")).toHaveLength(1);
  expect(screen.getByRole("heading", { name: "BMW 1 Series" })).toBeVisible();
  fireEvent.change(screen.getByRole("combobox", { name: "Preparation" }), {
    target: { value: "pending" },
  });
  expect(screen.getAllByRole("article")).toHaveLength(2);
  fireEvent.change(screen.getByRole("combobox", { name: "Preparation" }), {
    target: { value: "unassigned" },
  });
  expect(screen.getAllByRole("article")).toHaveLength(1);
  fireEvent.change(screen.getByRole("combobox", { name: "Preparation" }), {
    target: { value: "all" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "Sort cars" }), {
    target: { value: "price-low" },
  });
  expect(
    screen
      .getAllByRole("article")
      .map((row) => within(row).getByRole("heading").textContent),
  ).toEqual(["BMW 1 Series", "Ford Focus", "Toyota Yaris"]);
  const photo = screen.getByRole("button", {
    name: "Open Ford Focus photo and vehicle details",
  });
  expect(photo.querySelector(".inventory-photo-enlarged")).not.toBeNull();
  expect(
    screen
      .getByRole("button", { name: "Open Ford Focus, AB12CDE" })
      .querySelector(".inventory-photo-enlarged"),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Open Ford Focus, AB12CDE" }),
  );
  expect(state.navigate).toHaveBeenCalledWith(
    `/portal?section=inventory&vehicleId=${id}`,
  );
  expect(
    state.fetch.mock.calls.every(
      ([, options]) => !options?.method || options.method === "GET",
    ),
  ).toBe(true);
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
  expect(
    screen.getByRole("combobox", { name: "Choose customer to email" }),
  ).toBeDisabled();
  expect(screen.getByLabelText("Cleaning & presentation")).toBeDisabled();
  expect(screen.queryByText("Email customer Alex")).not.toBeInTheDocument();
  expect(
    state.fetch.mock.calls.every(
      ([, options]) => !options?.method || options.method === "GET",
    ),
  ).toBe(true);
});

it("opens read-only preview rows and keeps a collapsed preparation filter easy to clear", async () => {
  state.selected = false;
  state.fetch.mockResolvedValue({
    cars: [car],
    counts: { current: 1, archived: 0 },
    matchedCount: 1,
    previewReadOnly: true,
  });
  const { container } = render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <StaffInventory />
    </QueryClientProvider>,
  );
  const row = await screen.findByRole("button", {
    name: "Open Ford Focus, AB12CDE",
  });
  expect(row).not.toBeDisabled();
  fireEvent.click(row);
  expect(state.navigate).toHaveBeenCalledWith(
    `/portal?section=inventory&vehicleId=${id}`,
  );
  const toggle = container.querySelector<HTMLButtonElement>(
    ".inventory-filter-toggle",
  )!;
  const panel = container.querySelector(".inventory-work-filters")!;
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(panel).toHaveAttribute("data-collapsed", "true");
  expect(toggle).toHaveAttribute("aria-controls", panel.id);
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "true");
  fireEvent.change(screen.getByRole("combobox", { name: "Preparation" }), {
    target: { value: "pending" },
  });
  fireEvent.click(toggle);
  expect(panel).toHaveAttribute("data-collapsed", "true");
  expect(
    screen.getByRole("button", { name: "Clear preparation filter" }),
  ).toHaveTextContent("Work to do");
  fireEvent.click(
    screen.getByRole("button", { name: "Clear preparation filter" }),
  );
  expect(
    screen.queryByRole("button", { name: "Clear preparation filter" }),
  ).not.toBeInTheDocument();
});

it("keeps a late preparation save from replacing the next car's draft or success message", async () => {
  const secondId = "22222222-2222-4222-8222-222222222222";
  const second = { ...car, id: secondId, title: "Toyota Yaris" };
  const prep = (notes: string) => ({
    revision: 0,
    tasks: { cleaning: "pending", inspection: "pending", mot: "pending", servicing: "pending" },
    assigned_to_id: null,
    due_date: null,
    notes,
  });
  let resolveRefresh!: (value: unknown) => void;
  const delayedRefresh = new Promise((resolve) => { resolveRefresh = resolve; });
  let firstCarReads = 0;
  state.fetch.mockImplementation(async (url: string, options: any) => {
    if (options?.method === "PUT") return { saved: true };
    if (url.endsWith("/customers")) return { customers: [] };
    if (url === "/api/staff/inventory") return { cars: [car, second] };
    if (url.endsWith(`/${id}`)) {
      firstCarReads++;
      return firstCarReads === 1 ? { car, preparation: prep("First car notes"), photos: [] } : delayedRefresh;
    }
    return { car: second, preparation: prep("Second car notes"), photos: [] };
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const renderWorkspace = () => <QueryClientProvider client={client}><StaffInventory /></QueryClientProvider>;
  const view = render(renderWorkspace());
  const notes = await screen.findByRole("textbox", { name: "Internal notes" });
  await waitFor(() => expect(notes).toHaveValue("First car notes"));
  fireEvent.change(notes, { target: { value: "Saved first car notes" } });
  fireEvent.click(screen.getByRole("button", { name: "Save preparation" }));
  await waitFor(() => expect(firstCarReads).toBe(2));
  // This also represents browser Back or an external route change during the request.
  state.vehicleId = secondId;
  view.rerender(renderWorkspace());
  await screen.findByRole("heading", { name: "Toyota Yaris" });
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Internal notes" })).toHaveValue("Second car notes"));
  resolveRefresh({ car, preparation: prep("Saved first car notes"), photos: [] });
  await waitFor(() => expect(screen.getByRole("button", { name: "Save preparation" })).toBeEnabled());
  expect(screen.getByRole("textbox", { name: "Internal notes" })).toHaveValue("Second car notes");
  expect(screen.queryByText("Preparation saved.")).not.toBeInTheDocument();
});

it.each(["accepted", "rejected"] as const)("does not display another car's late %s upload result after navigation", async (outcome) => {
  const secondId = "22222222-2222-4222-8222-222222222222";
  const normal = state.fetch.getMockImplementation()!;
  let resolveGrant!: (value: unknown) => void;
  let rejectGrant!: (error: Error) => void;
  const delayedGrant = new Promise((resolve, reject) => { resolveGrant = resolve; rejectGrant = reject; });
  state.fetch.mockImplementation(async (url: string, options: any) => {
    if (url.endsWith("/upload-session") && options?.method === "POST") return delayedGrant;
    const value = await normal(url, options);
    return url.endsWith(`/${secondId}`) ? { ...value, car: { ...car, id: secondId, title: "Toyota Yaris" } } : value;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const renderWorkspace = () => <QueryClientProvider client={client}><StaffInventory /></QueryClientProvider>;
  const view = render(renderWorkspace());
  fireEvent.click(await screen.findByRole("button", { name: "Upload from phone" }));
  await waitFor(() => expect(state.fetch.mock.calls.some(([url, options]) => url.endsWith("/upload-session") && options?.method === "POST")).toBe(true));
  state.vehicleId = secondId;
  view.rerender(renderWorkspace());
  await screen.findByRole("heading", { name: "Toyota Yaris" });
  if (outcome === "accepted") resolveGrant({ id: "first-car-only", url: "https://example.test/staff-upload#first-car-token", expiresAt: new Date(Date.now() + 900000).toISOString(), category: "service_book" });
  else rejectGrant(new Error("First car upload failed."));
  await waitFor(() => expect(screen.getByRole("button", { name: "Upload from phone" })).toBeEnabled());
  expect(screen.queryByText("Scan the QR code using your phone camera.")).not.toBeInTheDocument();
  expect(screen.queryByText("First car upload failed.")).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Open upload page on this device" })).not.toBeInTheDocument();
});
