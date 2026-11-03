import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ request: vi.fn(), photo: vi.fn() }));
vi.mock("@/lib/test-drive-declarations", async () => ({
  ...(await vi.importActual<typeof import("@/lib/test-drive-declarations")>(
    "@/lib/test-drive-declarations",
  )),
  declarationRequest: api.request,
}));
vi.mock("@workspace/api-client-react", () => ({ customFetch: api.photo }));
import { VehicleDeliveryEvidence } from "./vehicle-delivery-evidence";
const job = {
  id: "job-one",
  status: "received",
  current: true,
  createdAt: "2026-11-03T12:00:00Z",
  submittedAt: "2026-11-03T13:00:00Z",
  snapshot: {
    vehicle: "Example estate",
    registration: "AB20 XYZ",
    address: "Example address",
    scheduledDate: "2026-11-03",
    driver: "Example Driver",
  },
  submission: {
    driverName: "Example Driver",
    recipientName: "Example Recipient",
    handoverAt: "2026-11-03T12:50:00Z",
    outcome: "delivered",
    mileage: 42000,
    keys: 2,
    notes: "Rear bumper mark recorded",
    location: null,
    locationReason: "Permission declined",
  },
  photos: [{ id: "photo-one", phase: "arrival", slot: "front" }],
};
beforeEach(() => {
  vi.clearAllMocks();
  api.request.mockImplementation(async (url: string) =>
    url.includes("/vehicles/")
      ? {
          sales: [
            {
              saleId: "sale-one",
              reference: "SALE-1001",
              revision: 4,
              evidenceCount: 1,
            },
          ],
        }
      : { jobs: [job] },
  );
  api.photo.mockResolvedValue(new Blob(["photo"], { type: "image/jpeg" }));
  vi.stubGlobal(
    "URL",
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:private-delivery-photo"),
      revokeObjectURL: vi.fn(),
    }),
  );
});
it("keeps vehicle evidence folded, loads only the selected sale and opens photos through the authenticated sale route", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <VehicleDeliveryEvidence vehicleId="car-one" />
    </QueryClientProvider>,
  );
  expect(api.request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Delivery evidence" }));
  const summary = await screen.findByText("SALE-1001 · 1 delivery file");
  expect(api.request).toHaveBeenCalledTimes(1);
  expect(api.request.mock.calls[0][0]).toBe(
    "/api/staff/vehicles/car-one/delivery-evidence",
  );
  const details = summary.closest("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  await screen.findByText("Rear bumper mark recorded");
  expect(
    screen.queryByRole("button", { name: "Generate driver link" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Upload signed paper" }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "arrival · front" }));
  await screen.findByRole("img", { name: "arrival · front" });
  expect(api.photo).toHaveBeenCalledWith(
    "/api/staff/sales/sale-one/delivery-evidence/job-one/photos/photo-one",
    { responseType: "blob", cache: "no-store" },
  );
  expect(api.request.mock.calls.every((call) => call[1] === undefined)).toBe(
    true,
  );
  client.clear();
});
it("shows an honest empty state and resets the selected vehicle without loading old files", async () => {
  api.request.mockResolvedValue({ sales: [] });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <VehicleDeliveryEvidence key="car-two" vehicleId="car-two" />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Delivery evidence" }));
  expect(
    await screen.findByText(
      "No delivery reports or photos have been saved for this vehicle.",
    ),
  ).toBeVisible();
  await waitFor(() => expect(api.request).toHaveBeenCalledTimes(1));
  client.clear();
});
