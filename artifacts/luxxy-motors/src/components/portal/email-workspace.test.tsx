import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const state = vi.hoisted(() => ({ fetch: vi.fn(), search: "view=sent" }));
const enquiry = {
  id: "enquiry-1",
  customerName: "Alex",
  reference: "ENQ-001",
  email: "alex@example.test",
  vehicleTitle: "Ford Focus",
};
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: any[]) => state.fetch(...args),
  getGetEnquiriesQueryKey: () => ["/api/enquiries"],
  useGetEnquiries: () => ({ data: [enquiry] }),
}));
vi.mock("wouter", () => ({
  useSearch: () => state.search,
  useLocation: () => ['/portal', vi.fn()],
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
  state.search = "view=sent";
  state.fetch
    .mockReset()
    .mockImplementation(async (url: string, options: any) => {
      if (url.endsWith("/email-draft")) return { version: 1 };
      if (url.startsWith("/api/staff/email-drafts"))
        return { drafts: [], hasMore: false };
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
  return render(
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
    "/portal?section=notifications&workView=customers&enquiryId=enquiry-1",
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

it("restores a saved reply and saves edits with its version without sending or previewing", async () => {
  const original = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async (url: string, options: any) => {
    const result = await original(url, options);
    if (url.endsWith("/email-context"))
      return {
        ...result,
        version: 7,
        savedDraft: {
          version: 7,
          status: "draft",
          content: {
            to: enquiry.email,
            subject: "Saved subject",
            message: "Saved reply",
            includeVehicle: true,
            includeAppointment: false,
            photoIds: [],
            documentIds: [],
            expectedRevision: 0,
          },
          updatedAt: "2026-10-16T10:00:00Z",
        },
      };
    return result;
  });
  mount();
  fireEvent.click(screen.getByRole("button", { name: "New email" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Customer enquiry" }), {
    target: { value: enquiry.id },
  });
  expect(await screen.findByRole("textbox", { name: "Subject" })).toHaveValue(
    "Saved subject",
  );
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: "Updated reply" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await screen.findByText("Draft saved · not sent");
  const save = state.fetch.mock.calls.find((c) =>
    c[0].endsWith("/email-draft"),
  );
  expect(JSON.parse(save![1].body)).toMatchObject({
    expectedVersion: 7,
    content: { message: "Updated reply" },
  });
  expect(
    state.fetch.mock.calls.some(
      (c) => /\/email(?:-preview)?$/.test(c[0]) && c[1]?.method === "POST",
    ),
  ).toBe(false);
});

it("retains staff text on a draft conflict and prevents preview or sending", async () => {
  const original = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async (url: string, options: any) => {
    if (url.endsWith("/email-draft"))
      throw { status: 409, data: { error: "This draft changed. Reopen it." } };
    return original(url, options);
  });
  mount();
  fireEvent.click(screen.getByRole("button", { name: "New email" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Customer enquiry" }), {
    target: { value: enquiry.id },
  });
  const message = await screen.findByRole("textbox", { name: "Message" });
  fireEvent.change(message, { target: { value: "Keep my text" } });
  fireEvent.click(screen.getByRole("button", { name: "Review email" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This draft changed",
  );
  expect(message).toHaveValue("Keep my text");
  expect(
    state.fetch.mock.calls.some((c) => c[0].endsWith("/email-preview")),
  ).toBe(false);
});

it('keeps email history scoped to the selected customer case when changing views', async () => {
  state.search = 'section=notifications&workView=email&enquiryId=enquiry-1&view=sent';
  mount();
  expect(await screen.findByRole('link', { name: 'Open customer' })).toHaveAttribute('href', '/portal?section=notifications&workView=customers&enquiryId=enquiry-1');
  const historyCalls = state.fetch.mock.calls.filter(c => c[0].startsWith('/api/staff/email?'));
  expect(historyCalls.length).toBeGreaterThan(0);
  expect(historyCalls.every(c => new URL(c[0], 'https://example.test').searchParams.get('enquiryId') === 'enquiry-1')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Drafts to review' }));
  await screen.findByRole('heading', { name: 'No saved drafts yet' });
  expect(state.fetch.mock.calls.some(c => c[0] === '/api/staff/email-drafts?enquiryId=enquiry-1')).toBe(true);
});

it('never falls back to all customer emails when a selected customer is unavailable', async () => {
  state.search = 'section=notifications&workView=email&enquiryId=missing-customer&view=sent';
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('customer record could not be loaded');
  expect(state.fetch.mock.calls.some(c => c[0].startsWith('/api/staff/email?') || c[0].startsWith('/api/staff/email-drafts'))).toBe(false);
  expect(screen.queryByText('Your Ford Focus')).not.toBeInTheDocument();
});

it('closes the previous customer composer when the route changes to an unavailable customer', async () => {
  state.search = 'section=notifications&workView=email&compose=enquiry-1';
  const ui = mount();
  expect(await screen.findByRole('textbox', { name: 'Subject' })).toBeInTheDocument();
  state.search = 'section=notifications&workView=email&enquiryId=missing-customer';
  ui.rerender(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><EmailWorkspace /></QueryClientProvider>);
  expect(await screen.findByRole('alert')).toHaveTextContent('customer record could not be loaded');
  await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Subject' })).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'New email' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(state.fetch.mock.calls.some(c => c[0].startsWith('/api/staff/email?'))).toBe(false);
});
