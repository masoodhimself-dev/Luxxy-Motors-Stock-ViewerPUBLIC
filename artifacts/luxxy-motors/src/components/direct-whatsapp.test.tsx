import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const state = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: unknown[]) => state.api(...args),
  getGetEnquiriesQueryKey: () => ["/api/enquiries"],
  getGetTestDriveBookingsQueryKey: () => ["/api/test-drive-bookings"],
}));
import { DirectWhatsApp } from "./direct-whatsapp";
const enquiry = {
  id: "canonical-enquiry",
  requestedEnquiryId: "old-enquiry",
  customerName: "Alex",
  phone: "07388 831790",
};
beforeEach(() => {
  state.api
    .mockReset()
    .mockImplementation(async (path: string) =>
      path.includes("/enquiries?")
        ? { enquiries: [enquiry] }
        : { enquiryId: enquiry.id, replayed: false },
    );
});
function show(
  props: Partial<React.ComponentProps<typeof DirectWhatsApp>> = {},
) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <DirectWhatsApp
        enquiryId="old-enquiry"
        customerName="Alex"
        customerPhone="07700900123"
        vehicleId="car-a"
        message="Your visit is confirmed."
        {...props}
      />
    </QueryClientProvider>,
  );
}
const writes = () =>
  state.api.mock.calls.filter(([, options]) => options?.method === "POST");
async function open() {
  fireEvent.click(screen.getByRole("button", { name: "WhatsApp" }));
  return screen.findByRole("link", { name: "Open WhatsApp" });
}
it("prefills the checked canonical customer number and performs no send or log on opening", async () => {
  show();
  const link = await open();
  expect(link).toHaveAttribute(
    "href",
    "https://wa.me/447388831790?text=Your%20visit%20is%20confirmed.",
  );
  expect(writes()).toHaveLength(0);
  expect(screen.getByRole("button", { name: "I’ve sent it" })).toBeDisabled();
});
it("saves only a staff-confirmed handoff against the canonical enquiry, with the exact reviewed copy", async () => {
  show();
  const link = await open();
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: "Hi Alex, Wednesday at 10am." },
  });
  expect(link).toHaveAttribute(
    "href",
    "https://wa.me/447388831790?text=Hi%20Alex%2C%20Wednesday%20at%2010am.",
  );
  fireEvent.click(link);
  expect(writes()).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "I’ve sent it" }));
  await screen.findByRole("status");
  expect(writes()).toHaveLength(1);
  const [path, options] = writes()[0];
  expect(path).toBe("/api/staff/whatsapp/confirm-whatsapp");
  expect(JSON.parse(options.body)).toMatchObject({
    enquiryId: "canonical-enquiry",
    vehicleId: "car-a",
    phone: "07388 831790",
    message: "Hi Alex, Wednesday at 10am.",
    confirmed: true,
  });
  expect(JSON.parse(options.body)).not.toHaveProperty("grantId");
});
it("retries an uncertain confirmation with the same identity and locked text", async () => {
  let attempts = 0;
  state.api.mockImplementation(async (path: string) => {
    if (path.includes("/enquiries?")) return { enquiries: [enquiry] };
    if (++attempts === 1) throw new Error("Lost response");
    return { enquiryId: enquiry.id, replayed: true };
  });
  show();
  fireEvent.click(await open());
  fireEvent.click(screen.getByRole("button", { name: "I’ve sent it" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("textbox", { name: "Message" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "I’ve sent it" }));
  await screen.findByRole("status");
  expect(writes()).toHaveLength(2);
  expect(writes()[1][1].body).toBe(writes()[0][1].body);
});
it("does not allow a number edit to reuse an already opened handoff", async () => {
  show();
  fireEvent.click(await open());
  expect(screen.getByRole("button", { name: "I’ve sent it" })).toBeEnabled();
  fireEvent.change(screen.getByRole("textbox", { name: "Customer number" }), {
    target: { value: "invalid" },
  });
  expect(
    screen.queryByRole("link", { name: "Open WhatsApp" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "I’ve sent it" })).toBeDisabled();
  expect(writes()).toHaveLength(0);
});
it("blocks stale arrangements before opening WhatsApp and keeps fallback email manual", async () => {
  const beforeOpen = vi
    .fn()
    .mockRejectedValue(new Error("Arrangements changed."));
  show({ beforeOpen });
  fireEvent.click(screen.getByRole("button", { name: "WhatsApp" }));
  await screen.findByRole("alert");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(state.api).not.toHaveBeenCalled();
});
it("passes edited wording to internal email without logging it as a WhatsApp send", async () => {
  const fallback = vi.fn();
  show({ onEmailFallback: fallback });
  await open();
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: "Please call us about your visit." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Use email instead" }));
  expect(fallback).toHaveBeenCalledExactlyOnceWith(
    "Please call us about your visit.",
  );
  expect(writes()).toHaveLength(0);
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});

it("uses the confirmed delivery number while keeping the canonical enquiry identity", async () => {
  show({ confirmedPhone: "07958 539535" });
  const link = await open();
  expect(screen.getByRole("textbox", { name: "Customer number" })).toHaveValue(
    "07958 539535",
  );
  expect(link).toHaveAttribute(
    "href",
    "https://wa.me/447958539535?text=Your%20visit%20is%20confirmed.",
  );
  fireEvent.click(link);
  fireEvent.click(screen.getByRole("button", { name: "I’ve sent it" }));
  await screen.findByRole("status");
  expect(JSON.parse(writes()[0][1].body)).toMatchObject({
    enquiryId: "canonical-enquiry",
    phone: "07958 539535",
  });
});

it("checks the exact sale without creating an enquiry, then confirms using only the sale identity", async () => {
  state.api.mockImplementation(async (path: string) =>
    path.includes("/enquiries?")
      ? {
          enquiries: [],
          saleCustomer: { customerName: "Alex", phone: "07388831790" },
        }
      : { enquiryId: "sale-thread" },
  );
  show({ saleId: "sale-a", enquiryId: undefined });
  const link = await open();
  expect(state.api).toHaveBeenCalledExactlyOnceWith(
    "/api/staff/whatsapp/enquiries?saleId=sale-a",
  );
  expect(writes()).toHaveLength(0);
  fireEvent.click(link);
  fireEvent.click(screen.getByRole("button", { name: "I’ve sent it" }));
  await screen.findByRole("status");
  const body = JSON.parse(writes()[0][1].body);
  expect(body.saleId).toBe("sale-a");
  expect(body).not.toHaveProperty("enquiryId");
  expect(body).not.toHaveProperty("newCustomer");
  expect(body).not.toHaveProperty("vehicleId");
});
it("fails closed when the sale cannot be validated", async () => {
  state.api.mockResolvedValue({ enquiries: [] });
  show({ saleId: "sale-a", enquiryId: undefined });
  fireEvent.click(screen.getByRole("button", { name: "WhatsApp" }));
  await screen.findByRole("alert");
  expect(
    screen.queryByRole("link", { name: "Open WhatsApp" }),
  ).not.toBeInTheDocument();
  expect(writes()).toHaveLength(0);
});
