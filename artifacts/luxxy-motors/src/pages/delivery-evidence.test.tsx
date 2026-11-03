import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  token: "a".repeat(64),
  fetch: vi.fn(),
  key: vi.fn(),
  load: vi.fn(),
  save: vi.fn(),
  clear: vi.fn(),
  photo: vi.fn(),
  location: vi.fn(),
}));
vi.mock("wouter", () => ({
  useRoute: () => [true, { token: state.token }],
}));
vi.mock("@/lib/delivery-evidence", async () => {
  const original = await vi.importActual<
    typeof import("@/lib/delivery-evidence")
  >("@/lib/delivery-evidence");
  return {
    ...original,
    deliveryLocalKey: state.key,
    deliveryLocalDraft: state.load,
    saveDeliveryLocalDraft: state.save,
    clearDeliveryLocalDraft: state.clear,
    deliveryPhotoData: state.photo,
  };
});
import DeliveryEvidencePage from "./delivery-evidence";
const record = {
  id: "delivery-job",
  status: "open",
  snapshot: {
    dealerName: "Example Motors",
    saleReference: "SALE-1001",
    vehicleId: "car",
    vehicle: "Ford Focus",
    registration: "AB20 XYZ",
    customer: "Example Customer",
    recipient: "Example Recipient",
    address: "1 Example Street",
    scheduledDate: "2026-11-03",
    timeWindow: "Afternoon",
    driver: "Example Driver",
    phone: "02000000000",
    instructions: "Call on arrival",
  },
  expiresAt: "2099-11-04T12:00:00Z",
  submittedAt: null,
  submission: null,
  photos: [],
};
const response = (value: unknown, ok = true) => ({
  ok,
  status: ok ? 200 : 410,
  json: async () => value,
});
beforeEach(() => {
  state.token = "a".repeat(64);
  vi.clearAllMocks();
  vi.stubGlobal("fetch", state.fetch);
  state.fetch
    .mockReset()
    .mockImplementation(async (path: string, options: { method: string }) =>
      options.method === "POST"
        ? response(
            path.endsWith("/submit")
              ? { received: true, receivedAt: new Date().toISOString() }
              : { saved: true },
          )
        : response(record),
    );
  state.key.mockResolvedValue("key");
  state.load.mockResolvedValue(undefined);
  state.save.mockResolvedValue(undefined);
  state.clear.mockResolvedValue(undefined);
  state.photo.mockResolvedValue("data:image/jpeg;base64,ZmFrZQ==");
  state.location.mockReset();
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition: state.location },
  });
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
});

it("does not attach a previous job photo or late location callback to a different driver link", async () => {
  let finishPhoto!: (data: string) => void;
  state.photo.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        finishPhoto = resolve;
      }),
  );
  const view = render(<DeliveryEvidencePage />);
  await screen.findByText("AB20 XYZ");
  fireEvent.click(screen.getByRole("button", { name: "Use current location" }));
  const input = screen
    .getByText("Front *")
    .closest("label")!
    .querySelector("input")!;
  fireEvent.change(input, {
    target: {
      files: [new File(["fake"], "old-car.jpg", { type: "image/jpeg" })],
    },
  });
  state.token = "b".repeat(64);
  state.fetch.mockResolvedValue(
    response({
      ...record,
      id: "different-job",
      snapshot: { ...record.snapshot, registration: "AB21 ABC" },
    }),
  );
  view.rerender(<DeliveryEvidencePage />);
  await screen.findByText("AB21 ABC");
  await act(async () => {
    finishPhoto("data:image/jpeg;base64,ZmFrZQ==");
    state.location.mock.calls[0][0]({
      coords: { latitude: 51.5, longitude: 0, accuracy: 10 },
      timestamp: Date.now(),
    });
  });
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Use current location" }),
  ).toBeEnabled();
});
it("shows only the delivery job and asks for device location only on explicit action", async () => {
  render(<DeliveryEvidencePage />);
  expect(await screen.findByText("AB20 XYZ")).toBeVisible();
  expect(screen.getByText("Ford Focus")).toBeVisible();
  expect(screen.getByRole("textbox", { name: "Driver name" })).toHaveValue(
    "Example Driver",
  );
  expect(state.location).not.toHaveBeenCalled();
  expect(state.fetch.mock.calls[0][1]).toMatchObject({
    credentials: "omit",
    cache: "no-store",
    referrerPolicy: "no-referrer",
  });
  fireEvent.click(screen.getByRole("button", { name: "Use current location" }));
  expect(state.location).toHaveBeenCalledTimes(1);
  expect(state.location.mock.calls[0][2]).toMatchObject({
    enableHighAccuracy: true,
    maximumAge: 0,
  });
});
it("uploads five photos before report, reuses request identities and waits for server acknowledgement", async () => {
  render(<DeliveryEvidencePage />);
  await screen.findByText("AB20 XYZ");
  for (const label of [
    "Front *",
    "Rear *",
    "Left side *",
    "Right side *",
    "Dashboard & mileage *",
  ]) {
    const input = screen
      .getByText(label)
      .closest("label")!
      .querySelector("input")!;
    fireEvent.change(input, {
      target: {
        files: [new File(["fake"], "photo.jpg", { type: "image/jpeg" })],
      },
    });
    await waitFor(() =>
      expect(input.closest("label")).toHaveTextContent("Ready to upload"),
    );
  }
  fireEvent.change(screen.getByRole("spinbutton", { name: "Mileage" }), {
    target: { value: "42000" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Use current time" }));
  fireEvent.change(
    screen.getByRole("textbox", { name: "Reason if unavailable" }),
    { target: { value: "Permission declined" } },
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: /named recipient acknowledged/ }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Submit delivery evidence" }),
  );
  await screen.findByRole("heading", { name: "Evidence received" });
  const posts = state.fetch.mock.calls.filter(
    ([, options]) => options.method === "POST",
  );
  expect(posts).toHaveLength(6);
  expect(posts.slice(0, 5).every(([path]) => path.endsWith("/photos"))).toBe(
    true,
  );
  const final = JSON.parse(posts[5][1].body);
  expect(final).toMatchObject({
    mileage: 42000,
    driverName: "Example Driver",
    recipientName: "Example Recipient",
    location: null,
    locationReason: "Permission declined",
    acknowledged: true,
  });
  expect(state.clear).toHaveBeenCalledWith("key");
  expect(
    screen.queryByRole("button", { name: "Submit delivery evidence" }),
  ).not.toBeInTheDocument();
});
it("keeps the report on the device when offline and never claims the evidence was received", async () => {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: false,
  });
  render(<DeliveryEvidencePage />);
  await screen.findByText("AB20 XYZ");
  fireEvent.change(
    screen.getByRole("textbox", { name: "Reason if unavailable" }),
    { target: { value: "No reception" } },
  );
  fireEvent.change(screen.getByRole("spinbutton", { name: "Mileage" }), {
    target: { value: "42000" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Use current time" }));
  fireEvent.click(
    screen.getByRole("checkbox", { name: /named recipient acknowledged/ }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Save and retry when online" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("You are offline");
  expect(
    state.fetch.mock.calls.filter(([, options]) => options.method === "POST"),
  ).toHaveLength(0);
  await waitFor(() => expect(state.save).toHaveBeenCalled());
  expect(
    screen.queryByRole("heading", { name: "Evidence received" }),
  ).not.toBeInTheDocument();
});
it("preserves a cached draft when the showroom withdraws the link", async () => {
  state.load.mockResolvedValue({
    record,
    report: {
      requestId: "request",
      driverName: "Cached Driver",
      recipientName: "Example Recipient",
      handoverAt: new Date().toISOString(),
      mileage: 42000,
      outcome: "delivered",
      notes: "",
      keys: 2,
      documentsProvided: true,
      acknowledged: false,
      location: null,
      locationReason: "",
    },
    photos: [],
  });
  state.fetch.mockResolvedValue(
    response(
      { error: "This delivery link has expired or been withdrawn." },
      false,
    ),
  );
  render(<DeliveryEvidencePage />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "expired or been withdrawn",
  );
  expect(screen.getByRole("textbox", { name: "Driver name" })).toHaveValue(
    "Cached Driver",
  );
  expect(state.clear).not.toHaveBeenCalled();
});
