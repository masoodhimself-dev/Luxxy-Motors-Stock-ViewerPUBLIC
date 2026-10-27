import { beforeEach, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createSaleWorkspace,
  saleHandoverMessage,
  type SaleWorkspaceRecord,
} from "@workspace/vehicle-meta";
import { SaleHandover } from "./sale-handover";
const state = vi.hoisted(() => ({
  fetch: vi.fn(),
  saved: vi.fn(),
  permissions: ["sales.manage", "sales.handover"],
  share: null as any,
  email: null as any,
}));
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: any[]) => state.fetch(...args),
}));
vi.mock("./dealer-administration", () => ({
  useStaffAccess: () => ({ data: { permissions: state.permissions } }),
}));
vi.mock("@/lib/dealer-settings-context", () => ({
  useDealerSettings: () => ({
    settings: { identity: { name: "Test Motors" } },
  }),
}));
vi.mock("@/components/direct-whatsapp", () => ({
  DirectWhatsApp: (props: any) => {
    state.share = props;
    return (
      <button onClick={() => void props.beforeOpen()}>
        WhatsApp confirmation
      </button>
    );
  },
}));
vi.mock("@/components/internal-share-email", () => ({
  InternalShareEmail: (props: any) => {
    state.email = props;
    return (
      <div role="dialog" aria-label="Reviewed dealership email">
        {props.message}
      </div>
    );
  },
}));
function sale() {
  return {
    ...createSaleWorkspace(
      {
        requestId: "request-create",
        draft: {
          customer: "Buyer",
          email: "buyer@example.test",
          phone: "07700900123",
          address: "Invoice address",
          vehicle: "Toyota Yaris",
          vehicleId: "car-a",
          price: "10000",
          fulfilment: {
            method: "delivery",
            viewed: "not-yet-viewed",
            address: "Confirmed delivery address",
            recipient: "Buyer",
            phone: "07700900123",
            scheduledDate: "2026-10-24",
            timeWindow: "14:00–16:00",
            instructions: "INTERNAL DO NOT SHARE",
            driver: "Alex",
          },
        },
      },
      {
        now: "2026-10-23T10:00:00Z",
        actor: "Staff",
        nextId: () => "sale-a",
        nextNumber: () => "TEST",
        branding: {} as any,
      },
      "SALE-TEST",
    ).sale,
    completedAt: "2026-10-23T11:00:00Z",
  } as SaleWorkspaceRecord;
}
function show(record = sale()) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <SaleHandover sale={record} onSaved={state.saved} />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  state.fetch.mockReset();
  state.saved.mockReset();
  state.permissions = ["sales.manage", "sales.handover"];
  state.share = null;
  state.email = null;
});
it("prefills contact, reviews email and WhatsApp without sending and excludes internal notes", () => {
  const record = sale();
  show(record);
  expect(state.share.customerPhone).toBe("07700900123");
  expect(state.share.message).toContain("Confirmed delivery address");
  expect(state.share.message).not.toContain("INTERNAL");
  expect(state.fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Email confirmation" }));
  expect(
    screen.getByRole("dialog", { name: "Reviewed dealership email" }),
  ).toBeVisible();
  expect(state.email.customerEmail).toBe("buyer@example.test");
  expect(state.email.saleId).toBe("sale-a");
  expect(state.email).not.toHaveProperty("newCustomer");
  expect(state.fetch).not.toHaveBeenCalled();
});

it("prevents dispatch and handover before sale completion and after recorded handover", () => {
  const record = sale();
  record.completedAt = undefined;
  const view = show(record);
  expect(
    screen.queryByRole("button", { name: "Mark on the way" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Mark delivered" }),
  ).not.toBeInTheDocument();
  view.unmount();
  const done = sale();
  done.draft.fulfilment!.completedAt = "2026-10-23T12:00:00Z";
  show(done);
  expect(
    screen.queryByRole("button", { name: "Edit arrangements" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Mark delivered" }),
  ).not.toBeInTheDocument();
});
it("uses the existing explicit outstanding-balance acknowledgement before recording delivery", () => {
  show();
  fireEvent.click(screen.getByRole("button", { name: "Mark delivered" }));
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveTextContent(/outstanding/i);
  expect(
    within(dialog).getByRole("button", { name: /Confirm handover/ }),
  ).toBeDisabled();
  expect(state.fetch).not.toHaveBeenCalled();
});
it("a failed save blocks a second action until latest details are reloaded", async () => {
  state.fetch.mockRejectedValue({
    status: 409,
    data: { error: "Changed on another device" },
  });
  show();
  fireEvent.click(screen.getByRole("button", { name: "Edit arrangements" }));
  fireEvent.click(screen.getByRole("button", { name: "Save arrangements" }));
  await screen.findByRole("alert");
  expect(
    screen.getByRole("button", { name: "Save arrangements" }),
  ).toBeDisabled();
  state.fetch.mockResolvedValue({ sale: sale() });
  fireEvent.click(screen.getByRole("button", { name: "Reload latest sale" }));
  await waitFor(() =>
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
  );
  expect(state.saved).toHaveBeenCalled();
});
it("rejects sharing a stale arrangement before creating an email or WhatsApp", async () => {
  const record = sale();
  state.fetch.mockResolvedValue({
    sale: { ...record, revision: record.revision + 1 },
  });
  show(record);
  await expect(state.share.beforeOpen()).rejects.toThrow(/changed/);
});

it("does not expose delivery tasks or controls without existing permissions", () => {
  state.permissions = [];
  show();
  expect(
    screen.queryByRole("region", { name: "Collection and delivery" }),
  ).not.toBeInTheDocument();
  expect(state.fetch).not.toHaveBeenCalled();
});
it("keeps editable arrangements after validation errors so staff can correct them", async () => {
  state.fetch.mockRejectedValue({
    status: 400,
    data: { error: "Choose a valid delivery date" },
  });
  show();
  fireEvent.click(screen.getByRole("button", { name: "Edit arrangements" }));
  fireEvent.change(screen.getByLabelText("Arrival window (UK time)"), {
    target: { value: "Alex updated" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save arrangements" }));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("Arrival window (UK time)")).toHaveValue(
    "Alex updated",
  );
  expect(
    screen.getByRole("button", { name: "Save arrangements" }),
  ).toBeEnabled();
  expect(
    screen.queryByRole("button", { name: "Reload latest sale" }),
  ).not.toBeInTheDocument();
});

it("does not replace a different sale after staff leave while a save is in flight", async () => {
  let finish: (value: unknown) => void = () => {};
  state.fetch.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = show();
  fireEvent.click(screen.getByRole("button", { name: "Edit arrangements" }));
  fireEvent.click(screen.getByRole("button", { name: "Save arrangements" }));
  view.unmount();
  await act(async () => {
    finish({ sale: sale() });
    await Promise.resolve();
  });
  expect(state.saved).not.toHaveBeenCalled();
});

it("keeps delivery sharing on the sale enquiry and uses the confirmed delivery contact", async () => {
  const record = sale();
  record.draft.sourceEnquiryId = "enquiry-original";
  record.draft.fulfilment!.phone = "07958539535";
  state.fetch.mockResolvedValue({ sale: record });
  show(record);
  expect(state.share).toMatchObject({
    customerPhone: "07958539535",
    confirmedPhone: "07958539535",
    customerName: "Buyer",
    saleId: "sale-a",
  });
  await state.share.beforeOpen();
  expect(state.fetch).toHaveBeenCalledExactlyOnceWith(
    "/api/sale-workspace/sale-a",
  );
  await act(async () => {
    await state.share.onEmailFallback("Staff reviewed delivery wording");
  });
  expect(state.email).toMatchObject({
    message: "Staff reviewed delivery wording",
    saleId: "sale-a",
    customerPhone: "07958539535",
    customerEmail: "buyer@example.test",
  });
  expect(state.fetch.mock.calls.every(([, options]) => !options?.method)).toBe(
    true,
  );
});

it("rechecks current arrangements before the internal email composer can prepare its customer record", async () => {
  const record = sale();
  state.fetch.mockResolvedValue({
    sale: { ...record, revision: record.revision + 1 },
  });
  show(record);
  fireEvent.click(screen.getByRole("button", { name: "Email confirmation" }));
  expect(state.fetch).not.toHaveBeenCalled();
  await expect(state.email.verifyBeforePrepare()).rejects.toThrow(
    /arrangements changed/,
  );
  expect(state.fetch).toHaveBeenCalledExactlyOnceWith(
    "/api/sale-workspace/sale-a",
  );
});

it("does not allow a sharing preflight to finish after staff leave the sale", async () => {
  let finish: (value: unknown) => void = () => {};
  state.fetch.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = show();
  const verified = state.share.beforeOpen();
  view.unmount();
  finish({ sale: sale() });
  await expect(verified).rejects.toThrow(/arrangements changed/);
  expect(state.fetch.mock.calls.every(([, options]) => !options?.method)).toBe(
    true,
  );
});
