import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PlateEntryCar } from "./bulk-plate-entry";
const state = vi.hoisted(() => ({
  fetch: vi.fn(),
  details: {} as Record<string, { car: PlateEntryCar; vehiclePhotos?: unknown; previewReadOnly?: boolean }>,
}));
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: unknown[]) => state.fetch(...args),
  getGetStockQueryKey: () => ["/api/stock"],
}));
import { BulkPlateEntry } from "./bulk-plate-entry";
const cars: PlateEntryCar[] = [
  { id: "car-one", title: "Ford Focus", plate: null, vrm: null, year: 2019 },
  { id: "car-two", title: "Toyota Yaris", plate: null, vrm: null, year: 2020 },
];
beforeEach(() => {
  vi.restoreAllMocks();
  state.details = Object.fromEntries(cars.map(car => [car.id, { car: { ...car }, vehiclePhotos: [
    { url: `https://images.example.test/${car.id}-rear.jpg`, caption: "Rear" },
    { url: `https://images.example.test/${car.id}-front.jpg`, caption: "Front" },
  ] }]));
  state.fetch.mockReset().mockImplementation(async (path: string, options?: { method?: string; body?: string }) => {
    if (options?.method === "PUT") return { saved: true };
    const id = path.split("/").at(-1)!;
    if (!state.details[id]) throw new Error("Not found");
    return structuredClone(state.details[id]);
  });
});
function mount(queue = cars) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
  const onClose = vi.fn();
  const view = render(<QueryClientProvider client={client}><BulkPlateEntry cars={queue} onClose={onClose} /></QueryClientProvider>);
  return { ...view, onClose, invalidate, client };
}
const input = () => screen.getByRole("textbox", { name: "Number plate from photo" });
const writes = () => state.fetch.mock.calls.filter(([, options]) => options?.method === "PUT");
const reads = () => state.fetch.mock.calls.filter(([, options]) => options?.method !== "PUT");
async function loaded() { await screen.findByRole("textbox", { name: "Number plate from photo" }); }
function enter(value = "ab12 cde") { fireEvent.change(input(), { target: { value } }); }

it("shows the front photo first, saves only the current car with its optimistic plate and advances", async () => {
  const view = mount();
  await loaded();
  expect(screen.getByRole("img")).toHaveAttribute("src", "https://images.example.test/car-one-front.jpg");
  expect(writes()).toHaveLength(0);
  enter();
  expect(writes()).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Save & next" }));
  await screen.findByRole("heading", { name: "Toyota Yaris" });
  expect(writes()).toHaveLength(1);
  expect(writes()[0][0]).toBe("/api/staff/inventory/car-one/plate");
  expect(JSON.parse(writes()[0][1].body)).toEqual({ plate: "AB12CDE", expectedPlate: null });
  expect(view.invalidate).toHaveBeenCalledWith({ queryKey: ["staff-inventory"] });
  expect(view.invalidate).toHaveBeenCalledWith({ queryKey: ["/api/stock"] });
  expect(view.invalidate).toHaveBeenCalledWith({ queryKey: ["dealer-operations"] });
  await loaded();
  enter("cd34efg");
  fireEvent.click(screen.getByRole("button", { name: "Save & next" }));
  await screen.findByRole("heading", { name: "2 number plates saved" });
  expect(writes()[1][0]).toBe("/api/staff/inventory/car-two/plate");
});

it("supports submitting from the plate field's form without automatically saving a typed plate", async () => {
  mount([cars[0]]);
  await loaded();
  const form = input().closest("form");
  expect(form).not.toBeNull();
  expect(screen.getByRole("button", { name: "Save & next" })).toHaveAttribute("type", "submit");
  enter("ef56 ghi");
  fireEvent.submit(form!);
  await screen.findByRole("heading", { name: "1 number plate saved" });
  expect(writes()).toHaveLength(1);
  expect(JSON.parse(writes()[0][1].body).plate).toBe("EF56GHI");
});

it("skips without guessing or saving and can return to skipped cars", async () => {
  mount();
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Skip car" }));
  await screen.findByRole("heading", { name: "Toyota Yaris" });
  await loaded();
  enter("ab12cde");
  fireEvent.click(screen.getByRole("button", { name: "Save & next" }));
  await screen.findByRole("heading", { name: "1 number plate saved" });
  expect(writes()).toHaveLength(1);
  expect(writes()[0][0]).toContain("car-two");
  expect(screen.getByText(/1 car was skipped. No plate was guessed/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Review skipped cars" }));
  await screen.findByRole("heading", { name: "Ford Focus" });
  expect(screen.getByText("Car 1 of 1 · 1 saved · 0 skipped")).toBeVisible();
  expect(writes()).toHaveLength(1);
});

it("guards concurrent submit and dismissal while one plate write is pending", async () => {
  let finish!: (result: unknown) => void;
  state.fetch.mockImplementation(async (path: string, options?: { method?: string }) => {
    if (options?.method === "PUT") return new Promise(resolve => { finish = resolve; });
    return structuredClone(state.details[path.split("/").at(-1)!]);
  });
  const view = mount([cars[0]]);
  await loaded();
  enter();
  const form = input().closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(writes()).toHaveLength(1);
  expect(view.onClose).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Skip car" })).toBeDisabled();
  await act(async () => finish({ saved: true }));
  await screen.findByRole("heading", { name: "1 number plate saved" });
});

it("preserves the attempted plate after a 409 until staff explicitly check the latest record", async () => {
  let conflict = true;
  state.fetch.mockImplementation(async (path: string, options?: { method?: string }) => {
    if (options?.method === "PUT") {
      if (conflict) throw { status: 409, data: { error: "Changed elsewhere" } };
      return { saved: true };
    }
    return structuredClone(state.details[path.split("/").at(-1)!]);
  });
  mount([cars[0]]);
  await loaded();
  enter("ab12cde");
  fireEvent.click(screen.getByRole("button", { name: "Save & next" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("The plate changed elsewhere");
  expect(input()).toHaveValue("AB12CDE");
  expect(input()).toBeDisabled();
  expect(reads()).toHaveLength(1);
  state.details["car-one"].car.plate = "XY34ZAB";
  fireEvent.click(screen.getByRole("button", { name: "Check latest plate" }));
  await waitFor(() => expect(input()).toHaveValue("XY34ZAB"));
  expect(input()).toBeEnabled();
  expect(writes()).toHaveLength(1);
  conflict = false;
  enter("xy34zac");
  fireEvent.click(screen.getByRole("button", { name: "Save & next" }));
  await screen.findByRole("heading", { name: "1 number plate saved" });
  expect(JSON.parse(writes()[1][1].body)).toEqual({ plate: "XY34ZAC", expectedPlate: "XY34ZAB" });
});

it("treats an HTTP500 as uncertain, does not retry automatically and checks whether the plate already saved", async () => {
  state.fetch.mockImplementation(async (path: string, options?: { method?: string }) => {
    if (options?.method === "PUT") { state.details["car-one"].car.plate = "AB12CDE"; throw { status: 500 }; }
    return structuredClone(state.details[path.split("/").at(-1)!]);
  });
  mount([cars[0]]);
  await loaded();
  enter();
  fireEvent.click(screen.getByRole("button", { name: "Save & next" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("We could not confirm the save");
  expect(writes()).toHaveLength(1);
  expect(reads()).toHaveLength(1);
  fireEvent.submit(input().closest("form")!);
  expect(writes()).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Check latest plate" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Keep & next" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Keep & next" }));
  await screen.findByRole("heading", { name: "0 number plates saved" });
  expect(writes()).toHaveLength(1);
});

it("lets staff browse or zoom a manual photo, and recover from a broken image without guessing", async () => {
  const view = mount([cars[0]]);
  await loaded();
  fireEvent.click(screen.getByRole("button", { name: "Zoom in photo" }));
  expect(screen.getByRole("img").parentElement).toHaveAttribute("data-zoom", "true");
  expect(screen.getByRole("link", { name: "Open full-size car photo" })).toHaveAttribute("target", "_blank");
  fireEvent.error(screen.getByRole("img"));
  expect(screen.getByText(/This photo could not load/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Next photo" }));
  expect(screen.getByRole("img")).toHaveAttribute("src", "https://images.example.test/car-one-rear.jpg");
  expect(screen.getByRole("img").parentElement).toHaveAttribute("data-zoom", "false");
  expect(screen.getByText(/No front view is labelled/)).toBeVisible();
  expect(writes()).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Skip car" }));
  await screen.findByRole("heading", { name: "0 number plates saved" });
  fireEvent.click(screen.getByRole("button", { name: "Back to Cars" }));
  expect(view.onClose).toHaveBeenCalledTimes(1);
});

it("handles missing photos with an explicit skip instead of a generated plate", async () => {
  state.details["car-one"].vehiclePhotos = [];
  mount([cars[0]]);
  await loaded();
  expect(screen.getByText(/No photos are available/)).toBeVisible();
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save & next" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Skip car" }));
  await screen.findByRole("heading", { name: "0 number plates saved" });
  expect(writes()).toHaveLength(0);
});

it("keeps read-only cars non-editable and never sends a write", async () => {
  state.details["car-one"].previewReadOnly = true;
  mount([cars[0]]);
  await loaded();
  expect(input()).toBeDisabled();
  expect(screen.getByRole("button", { name: "Save & next" })).toBeDisabled();
  fireEvent.submit(input().closest("form")!);
  expect(writes()).toHaveLength(0);
});

it("keeps the queue intact after a car-detail error and retries only when staff ask", async () => {
  let unavailable = true;
  state.fetch.mockImplementation(async (path: string) => {
    if (unavailable) throw new Error("Unavailable");
    return structuredClone(state.details[path.split("/").at(-1)!]);
  });
  mount([cars[0]]);
  expect(await screen.findByRole("alert")).toHaveTextContent("This car could not load. Your queue is still here.");
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(reads()).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Save & next" })).toBeDisabled();
  unavailable = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry car" }));
  await loaded();
  expect(reads()).toHaveLength(2);
  expect(screen.getByRole("heading", { name: "Ford Focus" })).toBeVisible();
  expect(writes()).toHaveLength(0);
});

it("uses the current server VRM as the expected plate when correcting a queue item", async () => {
  state.details["car-one"].car.vrm = "OLD123";
  mount([cars[0]]);
  await loaded();
  await waitFor(() => expect(input()).toHaveValue("OLD123"));
  enter("NEW123");
  fireEvent.click(screen.getByRole("button", { name: "Save & next" }));
  await screen.findByRole("heading", { name: "1 number plate saved" });
  expect(JSON.parse(writes()[0][1].body)).toEqual({ plate: "NEW123", expectedPlate: "OLD123" });
});

it("rejects invalid manual plate text before any write", async () => {
  mount([cars[0]]);
  await loaded();
  enter("ABC!123");
  fireEvent.click(screen.getByRole("button", { name: "Save & next" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Enter 2–8 letters and numbers");
  expect(input()).toHaveValue("ABC!123");
  expect(writes()).toHaveLength(0);
});

it("does not authorise a write using details returned for a different car", async () => {
  state.details["car-one"].car = { ...cars[1] };
  mount([cars[0]]);
  await loaded();
  enter("ab12cde");
  fireEvent.submit(input().closest("form")!);
  expect(writes()).toHaveLength(0);
  expect(screen.queryByRole("heading", { name: "1 number plate saved" })).not.toBeInTheDocument();
});

it("asks before discarding an unsaved manual plate and leaves saved queue work alone", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const view = mount([cars[0]]);
  await loaded();
  enter("ab12cde");
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(confirm).toHaveBeenCalledWith("Leave this number plate unsaved? Saved plates will be kept.");
  expect(view.onClose).not.toHaveBeenCalled();
  expect(input()).toHaveValue("AB12CDE");
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(view.onClose).toHaveBeenCalledTimes(1);
  expect(writes()).toHaveLength(0);
});


it("does not let a background refresh replace the optimistic plate baseline without explicit review", async () => {
  const view = mount([cars[0]]);
  await loaded();
  enter("ab12cde");
  state.details["car-one"].car.plate = "XY34ZAB";
  act(() => view.client.setQueryData(["staff-inventory", "plate-entry", "car-one"], structuredClone(state.details["car-one"])));
  expect(await screen.findByRole("button", { name: "Check latest plate" })).toBeVisible();
  expect(input()).toHaveValue("AB12CDE");
  fireEvent.submit(input().closest("form")!);
  expect(writes()).toHaveLength(0);
  expect(input()).toBeDisabled();
  expect(reads()).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Check latest plate" }));
  await waitFor(() => expect(input()).toHaveValue("XY34ZAB"));
  expect(input()).toBeEnabled();
  enter("ab12cde");
  fireEvent.click(screen.getByRole("button", { name: "Save & next" }));
  await screen.findByRole("heading", { name: "1 number plate saved" });
  expect(writes()).toHaveLength(1);
  expect(JSON.parse(writes()[0][1].body)).toEqual({ plate: "AB12CDE", expectedPlate: "XY34ZAB" });
});
