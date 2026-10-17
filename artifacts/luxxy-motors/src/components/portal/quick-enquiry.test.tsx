import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const state = vi.hoisted(() => ({
  create: vi.fn(),
  options: vi.fn(),
  directoryOptions: vi.fn(),
  accessRetry: vi.fn(),
  directoryRetry: vi.fn(),
  allowed: true,
  accessLoading: false,
  accessError: false,
  directoryLoading: false,
  directoryError: false,
  stockLoading: false,
  stockError: null as string | null,
}));
vi.mock("@workspace/api-client-react", () => ({
  getGetEnquiriesQueryKey: () => ["/api/enquiries"],
  getGetStaffDirectoryQueryKey: () => ["/api/staff/directory"],
  useCreateStaffEnquiry: (options: unknown) => {
    state.options(options);
    return { mutateAsync: state.create, isPending: false };
  },
  useGetStaffDirectory: (options: unknown) => {
    state.directoryOptions(options);
    return {
      data:
        state.directoryLoading || state.directoryError
          ? undefined
          : { currentUserId: "staff-current", members: [] },
      isLoading: state.directoryLoading,
      isError: state.directoryError,
      refetch: state.directoryRetry,
    };
  },
}));
vi.mock("./dealer-administration", () => ({
  useStaffAccess: () => ({
    data: state.accessLoading
      ? undefined
      : { permissions: state.allowed ? ["sales.manage"] : [] },
    isLoading: state.accessLoading,
    isError: state.accessError,
    refetch: state.accessRetry,
  }),
}));
vi.mock("@/lib/stock-context", () => ({
  useStock: () => ({
    stock: {
      cars: [
        {
          id: "car-one",
          title: "Ford Focus",
          year: 2019,
          plate: "AB69CDE",
          registration: "2019",
        },
      ],
    },
    isLoading: state.stockLoading,
    error: state.stockError,
  }),
}));
import { QuickEnquiryDialog } from "./quick-enquiry";
beforeEach(() => {
  state.create
    .mockReset()
    .mockResolvedValue({ id: "enquiry-new", reference: "ENQ-123" });
  state.options.mockClear();
  state.directoryOptions.mockClear();
  state.accessRetry.mockClear();
  state.directoryRetry.mockClear();
  state.allowed = true;
  state.accessLoading = false;
  state.accessError = false;
  state.directoryLoading = false;
  state.directoryError = false;
  state.stockLoading = false;
  state.stockError = null;
});
function mount(open = true, initialVehicleId?: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue();
  const onOpenChange = vi.fn(),
    onCreated = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <QuickEnquiryDialog
        open={open}
        initialVehicleId={initialVehicleId}
        onOpenChange={onOpenChange}
        onCreated={onCreated}
      />
    </QueryClientProvider>,
  );
  return { ...view, invalidate, onOpenChange, onCreated };
}
function fill() {
  fireEvent.change(screen.getByRole("textbox", { name: "Customer name" }), {
    target: { value: "  Alex Smith  " },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Phone number" }), {
    target: { value: " 07700 900123 " },
  });
}
it("starts a car enquiry with the chosen stock car and keeps capture in place", async () => {
  const view = mount(true, "car-one");
  expect(screen.getByRole("combobox", { name: "Car (optional)" })).toHaveValue("car-one");
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Save enquiry" }));
  await waitFor(() => expect(view.onCreated).toHaveBeenCalled());
  expect(state.create.mock.calls[0][0].data.vehicleId).toBe("car-one");
});
it("lets staff cancel a preselected car enquiry without a discard warning until they edit it", () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const view = mount(true, "car-one");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(confirm).not.toHaveBeenCalled();
  expect(view.onOpenChange).toHaveBeenCalledWith(false);
  confirm.mockRestore();
});
it("captures a general enquiry in place using the no-email mode and the current staff owner", async () => {
  const view = mount();
  fill();
  fireEvent.change(screen.getByRole("textbox", { name: "Email (optional)" }), {
    target: { value: " alex@example.test " },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "Car (optional)" }), {
    target: { value: "car-one" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Notes (optional)" }), {
    target: { value: "  Please call about the service history.  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save enquiry" }));
  await waitFor(() =>
    expect(view.onCreated).toHaveBeenCalledWith({
      id: "enquiry-new",
      reference: "ENQ-123",
    }),
  );
  expect(state.options).toHaveBeenCalledWith({
    request: { headers: { "X-Enquiry-Capture": "quick" } },
    mutation: { retry: false },
  });
  expect(state.create).toHaveBeenCalledExactlyOnceWith({
    data: {
      assignedToId: "staff-current",
      type: "general",
      customerName: "Alex Smith",
      phone: "07700 900123",
      email: "alex@example.test",
      preferredContact: "phone",
      vehicleId: "car-one",
      message: "Please call about the service history.",
      appointmentAt: null,
    },
  });
  expect(view.onOpenChange).toHaveBeenCalledWith(false);
  for (const key of [
    ["/api/enquiries"],
    ["staff-notifications"],
    ["dealer-operations"],
    ["staff-relationships"],
    ["inventory-customers"],
  ])
    expect(view.invalidate).toHaveBeenCalledWith({ queryKey: key });
  expect(screen.getByRole("textbox", { name: "Customer name" })).toHaveValue(
    "",
  );
  expect(
    screen.getByText("Save the details now. No email is sent."),
  ).toBeVisible();
});
it("allows no email, car or notes and never creates an appointment or callback", async () => {
  mount();
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Save enquiry" }));
  await waitFor(() => expect(state.create).toHaveBeenCalledTimes(1));
  const payload = state.create.mock.calls[0][0].data;
  expect(payload).toMatchObject({
    email: null,
    vehicleId: null,
    appointmentAt: null,
    type: "general",
    message: "Customer enquiry recorded by our showroom.",
  });
  expect(payload).not.toHaveProperty("followUpAt");
  expect(payload).not.toHaveProperty("allowOutsideHours");
  expect(payload).not.toHaveProperty("adHocVehicle");
});
it.each([
  ["Customer name", "A", "Enter the customer’s name (2–120 characters)."],
  ["Phone number", "123", "Enter a valid contact number."],
  [
    "Email (optional)",
    "not-an-email",
    "Enter a valid email address, or leave it blank.",
  ],
])("validates %s before making any request", async (field, value, message) => {
  mount();
  fill();
  fireEvent.change(screen.getByRole("textbox", { name: field }), {
    target: { value },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save enquiry" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(message);
  expect(state.create).not.toHaveBeenCalled();
});
it("keeps all details and the server explanation when saving fails", async () => {
  state.create.mockRejectedValue({
    data: { error: "This car has changed. Please choose it again." },
  });
  const view = mount();
  fill();
  fireEvent.change(screen.getByRole("textbox", { name: "Notes (optional)" }), {
    target: { value: "Customer notes" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save enquiry" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This car has changed. Please choose it again.",
  );
  expect(screen.getByRole("textbox", { name: "Customer name" })).toHaveValue(
    "  Alex Smith  ",
  );
  expect(screen.getByRole("textbox", { name: "Notes (optional)" })).toHaveValue(
    "Customer notes",
  );
  expect(view.onOpenChange).not.toHaveBeenCalled();
  expect(view.onCreated).not.toHaveBeenCalled();
  expect(state.create).toHaveBeenCalledTimes(1);
});
it("does not automatically retry an uncertain save", async () => {
  state.create.mockRejectedValue(new Error("Network disconnected"));
  mount();
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Save enquiry" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Check Enquiries before retrying",
  );
  expect(state.create).toHaveBeenCalledTimes(1);
});
it("prevents duplicate submits and closing until the pending save finishes", async () => {
  let resolve!: (value: unknown) => void;
  state.create.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const view = mount();
  fill();
  const form = screen
    .getByRole("button", { name: "Save enquiry" })
    .closest("form")!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(state.create).toHaveBeenCalledTimes(1);
  expect(view.onOpenChange).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  resolve({ id: "enquiry-new", reference: "ENQ-123" });
  await waitFor(() => expect(view.onCreated).toHaveBeenCalledTimes(1));
});
it("confirms discarding a dirty enquiry and preserves it when staff choose to keep editing", () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const view = mount();
  fill();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(confirm).toHaveBeenCalledTimes(1);
  expect(view.onOpenChange).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: "Customer name" })).toHaveValue(
    "  Alex Smith  ",
  );
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(view.onOpenChange).toHaveBeenCalledWith(false);
  expect(screen.getByRole("textbox", { name: "Customer name" })).toHaveValue(
    "",
  );
  expect(state.create).not.toHaveBeenCalled();
  confirm.mockRestore();
});
it("shows access loading and does not expose a form to staff without permission", () => {
  state.accessLoading = true;
  const view = mount();
  expect(screen.getByRole("status")).toHaveTextContent(
    "Checking your staff access",
  );
  expect(
    screen.queryByRole("button", { name: "Save enquiry" }),
  ).not.toBeInTheDocument();
  view.unmount();
  state.accessLoading = false;
  state.allowed = false;
  mount();
  expect(
    screen.getByText("Your staff role does not allow creating enquiries."),
  ).toBeVisible();
  expect(
    screen.queryByRole("textbox", { name: "Customer name" }),
  ).not.toBeInTheDocument();
  expect(state.create).not.toHaveBeenCalled();
});
it("retains typed details while staff details are loading or need retrying", () => {
  state.directoryError = true;
  mount();
  fill();
  expect(screen.getByRole("button", { name: "Save enquiry" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Retry staff details" }));
  expect(state.directoryRetry).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("textbox", { name: "Customer name" })).toHaveValue(
    "  Alex Smith  ",
  );
  expect(state.create).not.toHaveBeenCalled();
});
it("allows a general enquiry when stock is unavailable and keeps closed dialogs inactive", async () => {
  state.stockError = "Unavailable";
  const view = mount();
  fill();
  expect(
    screen.getByText(
      "Stock could not load. You can still save without choosing a car.",
    ),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Save enquiry" }));
  await waitFor(() => expect(state.create).toHaveBeenCalledTimes(1));
  view.unmount();
  mount(false);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(state.directoryOptions).toHaveBeenLastCalledWith({
    query: { queryKey: ["/api/staff/directory"], enabled: false, retry: false },
  });
});
