import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const state = vi.hoisted(() => ({ fetch: vi.fn(), writable: true, selected: true }));
vi.mock("wouter", () => ({
  useSearch: () => state.selected ? "?vehicleId=11111111-1111-4111-8111-111111111111" : "",
  useLocation: () => ["", vi.fn()],
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
it("shows a large plate-inspection photo and only saves corrections explicitly", async () => {
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
  const archived = { ...car, id: "archive-one", title: "Older Toyota", inventory_status: "archived", archived_at: "2026-01-01T00:00:00Z" };
  const oldest = { ...archived, id: "archive-two", title: "Oldest needle vehicle", plate: "ZX99OLD" };
  state.fetch.mockImplementation(async (url: string) => {
    const parsed = new URL(url, "https://fictional.example.test");
    if (parsed.searchParams.has("q")) return { cars: [oldest], counts: { current: 1, archived: 2 }, matchedCount: 1, nextCursor: null };
    if (parsed.searchParams.get("scope") === "archived") return parsed.searchParams.has("cursor")
      ? { cars: [oldest], counts: { current: 1, archived: 2 }, matchedCount: 2, nextCursor: null }
      : { cars: [archived], counts: { current: 1, archived: 2 }, matchedCount: 2, nextCursor: "older-cars" };
    return { cars: [car], counts: { current: 1, archived: 2 }, matchedCount: 1, nextCursor: null };
  });
  mount();
  expect(await screen.findByText("Ford Focus")).toBeVisible();
  expect(screen.queryByText("Older Toyota")).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("combobox", { name: "Availability" }), { target: { value: "archived" } });
  expect(await screen.findByText("Older Toyota")).toBeVisible();
  expect(screen.queryByText("Ford Focus")).not.toBeInTheDocument();
  expect(screen.getByText("Showing 1 of 2 matching archived cars.")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Load older archived cars" }));
  expect(await screen.findByText("Oldest needle vehicle")).toBeVisible();
  expect(screen.getByText("Showing 2 of 2 matching archived cars.")).toBeVisible();
  fireEvent.change(screen.getByRole("textbox", { name: "Search cars" }), { target: { value: "needle" } });
  await waitFor(() => expect(state.fetch.mock.calls.some(([url]) => String(url).includes("q=needle"))).toBe(true));
  expect(await screen.findByText("Showing 1 of 1 matching archived cars.")).toBeVisible();
  expect(screen.queryByText("Older Toyota")).not.toBeInTheDocument();
  expect(state.fetch.mock.calls.every(([, options]) => !options?.method || options.method === "GET")).toBe(true);
});
