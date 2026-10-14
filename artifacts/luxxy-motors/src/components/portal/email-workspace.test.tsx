import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const state = vi.hoisted(() => ({ fetch: vi.fn() }));
const enquiry = {
  id: "enquiry-1",
  customerName: "Alex",
  reference: "ENQ-001",
  email: "alex@example.test",
  vehicleTitle: "Ford Focus",
};
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: any[]) => state.fetch(...args),
  useGetEnquiries: () => ({ data: [enquiry] }),
}));
vi.mock("wouter", () => ({
  useSearch: () => "",
  Link: ({ href, children }: any) => <a href={href}>{children}</a>,
}));
vi.mock("./enquiry-workspace-tools", () => ({
  workspaceError: (e: any) => e.data?.error || e.message,
  useRefreshDesk: () => vi.fn(),
}));
import { EmailWorkspace, emailStatusLabel } from "./email-workspace";
const message = {
  key: "enquiry:message-1",
  kind: "enquiry",
  customer_name: "Alex",
  recipient: "alex@example.test",
  subject: "Your Ford Focus",
  status: "sent",
  created_at: "2026-10-13T12:00:00Z",
  vehicle_id: "car-1",
  vehicle_title: "Ford Focus",
  enquiry_id: "enquiry-1",
  sale_id: null,
  document_id: null,
  reference: "ENQ-001",
  attachment_count: 1,
  provider_id: "provider-1",
  last_event: null,
  checked_at: null,
};
beforeEach(() => {
  state.fetch
    .mockReset()
    .mockImplementation(async (url: string, options: any) => {
      if (url.includes("/email-context"))
        return {
          email: enquiry.email,
          customerName: "Alex",
          vehicleId: "car-1",
          vehicleTitle: "Ford Focus",
          reference: "ENQ-001",
          revision: 0,
          vehicleAvailable: true,
          appointmentAvailable: false,
          defaults: { subject: "Ford Focus", message: "Hello Alex" },
          ready: true,
          photos: [],
          deliveries: [],
          templates: [
            {
              id: "vehicle_details",
              label: "Vehicle details",
              subject: "Your car details",
              message: "Here are the details Alex.",
            },
          ],
          invoices: [
            {
              id: "sale-1:invoice-1",
              title: "Full invoice",
              number: "INV-001",
              saleId: "sale-1",
              issuedAt: "2026-10-13",
            },
          ],
        };
      if (url.endsWith("/email-preview"))
        return {
          to: enquiry.email,
          subject: "Your car details",
          text: "Reviewed email",
          previewHash: "a".repeat(64),
          attachments: [
            { id: "sale-1:invoice-1", filename: "INV-001.pdf", byteSize: 1024 },
          ],
        };
      if (url.endsWith("/status"))
        return { event: "opened", checkedAt: "2026-10-13T13:00:00Z" };
      if (url.includes("/message/"))
        return { message: { message: "The saved customer email." } };
      return { messages: [message], hasMore: false };
    });
});
function mount() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <EmailWorkspace />
    </QueryClientProvider>,
  );
}
it("links sent messages to their customer, enquiry and car without resending", async () => {
  mount();
  fireEvent.click(
    await screen.findByRole("button", { name: /Your Ford Focus/ }),
  );
  expect(
    await screen.findByText("The saved customer email."),
  ).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open enquiry" })).toHaveAttribute(
    "href",
    "/portal?section=enquiries&enquiryId=enquiry-1",
  );
  expect(screen.getByRole("link", { name: "Open car" })).toHaveAttribute(
    "href",
    "/portal?section=inventory&vehicleId=car-1",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Check delivery status" }),
  );
  await screen.findByText("Opened");
  expect(
    screen.getByText(/does not prove the customer read/),
  ).toBeInTheDocument();
  expect(
    state.fetch.mock.calls.some(
      (c) => /\/email$/.test(c[0]) && c[1]?.method === "POST",
    ),
  ).toBe(false);
});
it("applies a template and attaches the saved invoice only after staff review", async () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "New email" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Customer enquiry" }), {
    target: { value: enquiry.id },
  });
  await screen.findByRole("combobox", { name: "Email template" });
  fireEvent.change(screen.getByRole("combobox", { name: "Email template" }), {
    target: { value: "vehicle_details" },
  });
  expect(screen.getByRole("textbox", { name: "Subject" })).toHaveValue(
    "Your car details",
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: /Full invoice.*INV-001/ }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Review email" }));
  await screen.findByText("Reviewed email");
  expect(screen.getByText("INV-001.pdf · 1 KB")).toBeInTheDocument();
  const preview = state.fetch.mock.calls.find((c) =>
    c[0].endsWith("/email-preview"),
  );
  expect(JSON.parse(preview![1].body).templateId).toBe("vehicle_details");
  expect(JSON.parse(preview![1].body).documentIds).toEqual([
    "sale-1:invoice-1",
  ]);
  expect(
    state.fetch.mock.calls.some(
      (c) => /\/email$/.test(c[0]) && c[1]?.method === "POST",
    ),
  ).toBe(false);
});
it("labels provider acceptance and unknown status without claiming delivery or reading", () => {
  expect(emailStatusLabel("sent")).toBe("Submitted to Resend");
  expect(emailStatusLabel("unknown")).toBe("Acceptance unconfirmed");
  expect(emailStatusLabel("opened")).toBe("Opened");
  expect(emailStatusLabel("invented")).toBe("Status unavailable");
});
