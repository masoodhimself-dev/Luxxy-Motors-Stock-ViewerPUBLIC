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
  navigate: vi.fn(),
  search: "view=sent",
  enquiries: [] as any[],
}));
const enquiry = {
  id: "enquiry-1",
  customerName: "Alex",
  reference: "ENQ-001",
  email: "alex@example.test",
  vehicleTitle: "Ford Focus",
  message: "Is the Ford Focus still available?",
  source: "website",
  createdAt: "2026-10-12T10:00:00Z",
};
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: any[]) => state.fetch(...args),
  getGetDealerSettingsQueryKey: () => ['/api/dealer-settings'],
  getGetEnquiriesQueryKey: () => ["/api/enquiries"],
  useGetEnquiries: () => ({ data: state.enquiries }),
}));
vi.mock("wouter", () => ({
  useSearch: () => state.search,
  useLocation: () => ["/portal", state.navigate],
  Link: ({ href, children }: any) => <a href={href}>{children}</a>,
}));
vi.mock("./enquiry-workspace-tools", () => ({
  workspaceError: (e: any) => e.data?.error || e.message,
  useRefreshDesk: () => vi.fn(),
}));
import {
  EmailWorkspace,
  emailStatusLabel,
  emailStatusTone,
  groupEmailConversations,
} from "./email-workspace";
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
  state.navigate.mockReset();
  state.search = "view=sent";
  state.enquiries = [enquiry];
  state.fetch
    .mockReset()
    .mockImplementation(async (url: string, options: any) => {
      if (url === '/api/staff/phone-sharing-settings') return { revision: 0, enabled: true };
      if (url === '/api/features') return { features: { customerEmails: true, staffAiDrafts: true }, evaluatedAt: '2026-10-18T10:00:00Z' };
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
function mount(embedded = false) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <EmailWorkspace embedded={embedded} />
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
  expect(document.body).not.toHaveTextContent("ENQ-001");
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

it("keeps email history scoped to the selected customer case when changing views", async () => {
  state.search =
    "section=notifications&workView=email&enquiryId=enquiry-1&view=sent";
  mount();
  expect(
    await screen.findByRole("link", { name: "Open customer" }),
  ).toHaveAttribute(
    "href",
    "/portal?section=notifications&workView=customers&enquiryId=enquiry-1",
  );
  const historyCalls = state.fetch.mock.calls.filter((c) =>
    c[0].startsWith("/api/staff/email?"),
  );
  expect(historyCalls.length).toBeGreaterThan(0);
  expect(
    historyCalls.every(
      (c) =>
        new URL(c[0], "https://example.test").searchParams.get("enquiryId") ===
        "enquiry-1",
    ),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Drafts to review" }));
  await screen.findByRole("heading", { name: "No saved drafts yet" });
  expect(
    state.fetch.mock.calls.some(
      (c) => c[0] === "/api/staff/email-drafts?enquiryId=enquiry-1",
    ),
  ).toBe(true);
});

it("never falls back to all customer emails when a selected customer is unavailable", async () => {
  state.search =
    "section=notifications&workView=email&enquiryId=missing-customer&view=sent";
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "customer record could not be loaded",
  );
  expect(
    state.fetch.mock.calls.some(
      (c) =>
        c[0].startsWith("/api/staff/email?") ||
        c[0].startsWith("/api/staff/email-drafts"),
    ),
  ).toBe(false);
  expect(screen.queryByText("Your Ford Focus")).not.toBeInTheDocument();
});

it("closes the previous customer composer when the route changes to an unavailable customer", async () => {
  state.search = "section=notifications&workView=email&compose=enquiry-1";
  const ui = mount();
  expect(
    await screen.findByRole("textbox", { name: "Subject" }),
  ).toBeInTheDocument();
  state.fetch.mockClear();
  state.search =
    "section=notifications&workView=email&enquiryId=missing-customer";
  ui.rerender(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <EmailWorkspace />
    </QueryClientProvider>,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "customer record could not be loaded",
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("textbox", { name: "Subject" }),
    ).not.toBeInTheDocument(),
  );
  expect(screen.getByRole("button", { name: "New email" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(
    state.fetch.mock.calls.some((c) => c[0].startsWith("/api/staff/email?")),
  ).toBe(false);
});

it("groups by case identity and keeps unrelated customers with the same email separate", () => {
  const second = {
    ...message,
    key: "enquiry:message-2",
    subject: "Service history",
    created_at: "2026-10-14T12:00:00Z",
  };
  const separate = {
    ...message,
    key: "enquiry:message-3",
    enquiry_id: "different-case",
    subject: "A different car",
  };
  const orphanSale = {
    ...message,
    key: "sale:sale-1:doc-1",
    enquiry_id: null,
    sale_id: "sale-1",
    kind: "sale",
  };
  const anotherSale = {
    ...orphanSale,
    key: "sale:sale-2:doc-2",
    sale_id: "sale-2",
  };
  const groups = groupEmailConversations([
    message,
    separate,
    second,
    orphanSale,
    anotherSale,
  ] as any);
  expect(groups).toHaveLength(4);
  expect(groups[0].messages.map((entry) => entry.key)).toEqual([
    message.key,
    second.key,
  ]);
  expect(groups[0].latest?.subject).toBe("Service history");
  expect(
    groups.find((entry) => entry.key === "sale:sale-1")?.messages,
  ).toHaveLength(1);
});

it("loads the whole selected conversation without retaining fuzzy search and orders its bubbles chronologically", async () => {
  state.search = "view=sent&customer=Focus";
  const original = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async (url: string, options: any) => {
    if (url.includes("includeBody=true"))
      return {
        messages: [
          {
            ...message,
            key: "enquiry:later",
            created_at: "2026-10-14T13:00:00Z",
            subject: "Service history",
            message: "Here is your service history.",
            last_event: "delivered",
          },
          { ...message, message: "Yes, the car is available." },
        ],
        hasMore: false,
        replyTo: "sales@showroom.test",
      };
    return original(url, options);
  });
  mount();
  fireEvent.click(
    await screen.findByRole("button", { name: /Your Ford Focus/ }),
  );
  const timeline = await screen.findByRole("list", {
    name: "Conversation messages",
  });
  await within(timeline).findByText("Here is your service history.");
  const bubbles = within(timeline).getAllByRole("article");
  expect(bubbles).toHaveLength(3);
  expect(bubbles[0]).toHaveTextContent("Is the Ford Focus still available?");
  expect(bubbles[0]).toHaveTextContent("Website enquiry");
  expect(bubbles[1]).toHaveTextContent("Yes, the car is available.");
  expect(bubbles[2]).toHaveTextContent("Here is your service history.");
  const request = state.fetch.mock.calls.find(([url]) =>
    url.includes("includeBody=true"),
  )![0];
  const params = new URL(request, "https://example.test").searchParams;
  expect(params.get("enquiryId")).toBe("enquiry-1");
  expect(params.has("q")).toBe(false);
  expect(
    screen.getByText(/Inbox replies are not connected here yet/),
  ).toBeInTheDocument();
  expect(
    state.fetch.mock.calls.some(([url]) => url.includes("/email-context")),
  ).toBe(false);
});

it("loads earlier messages without duplicates or a new email send", async () => {
  const original = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async (url: string, options: any) => {
    if (url.includes("includeBody=true")) {
      const older =
        new URL(url, "https://example.test").searchParams.get("offset") ===
        "50";
      return {
        messages: older
          ? [
              {
                ...message,
                key: "enquiry:older",
                created_at: "2026-10-11T10:00:00Z",
                subject: "Earlier email",
                message: "The earlier saved reply.",
              },
              { ...message, message: "The latest reply." },
            ]
          : [{ ...message, message: "The latest reply." }],
        hasMore: !older,
      };
    }
    return original(url, options);
  });
  mount();
  fireEvent.click(
    await screen.findByRole("button", { name: /Your Ford Focus/ }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Load earlier emails" }),
  );
  await screen.findByText("The earlier saved reply.");
  expect(screen.getAllByText("The latest reply.")).toHaveLength(1);
  expect(
    screen.queryByRole("button", { name: "Load earlier emails" }),
  ).not.toBeInTheDocument();
  expect(
    state.fetch.mock.calls.some(([, options]) => options?.method === "POST"),
  ).toBe(false);
});

it("distinguishes a staff enquiry record and failed email attempt from an incoming or delivered message", async () => {
  enquiry.source = "phone";
  const original = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async (url: string, options: any) => {
    if (url.startsWith("/api/staff/email?"))
      return {
        messages: [
          {
            ...message,
            status: "failed",
            message: "A reply that was not delivered.",
          },
        ],
        hasMore: false,
      };
    return original(url, options);
  });
  try {
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: /Your Ford Focus/ }),
    );
    expect(
      await screen.findByText("Recorded by staff · not an incoming email"),
    ).toBeInTheDocument();
    const bubble = screen.getByRole("article", {
      name: "Your Ford Focus, email from your dealership",
    });
    expect(bubble).toHaveTextContent("Failed");
    expect(bubble).toHaveAttribute("data-tone", "danger");
    expect(within(bubble).queryByText("Delivered")).not.toBeInTheDocument();
    expect(within(bubble).queryByText("Sent")).not.toBeInTheDocument();
  } finally {
    enquiry.source = "website";
  }
});

it("keeps an unlinked sale conversation scoped to its exact sale", async () => {
  const original = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async (url: string, options: any) => {
    if (url.startsWith("/api/staff/email?"))
      return {
        messages: [
          {
            ...message,
            key: "sale:sale-1:document-1",
            kind: "sale",
            enquiry_id: null,
            sale_id: "sale-1",
            document_id: "document-1",
            message: "The original saved document was attached to this email.",
          },
        ],
        hasMore: false,
      };
    return original(url, options);
  });
  mount();
  fireEvent.click(
    await screen.findByRole("button", { name: /Your Ford Focus/ }),
  );
  await screen.findByText("Email record summary");
  const request = state.fetch.mock.calls.find(([url]) =>
    url.includes("includeBody=true"),
  )![0];
  expect(
    new URL(request, "https://example.test").searchParams.get("saleId"),
  ).toBe("sale-1");
  expect(
    screen.queryByText("Is the Ford Focus still available?"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Write an email" }),
  ).not.toBeInTheDocument();
});

it("opens an original enquiry and its reply action before any email has been sent", async () => {
  state.search = "section=notifications&workView=email&enquiryId=enquiry-1";
  const original = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async (url: string, options: any) =>
    url.startsWith("/api/staff/email?")
      ? { messages: [], hasMore: false }
      : original(url, options),
  );
  mount();
  expect(
    await screen.findByText("Is the Ford Focus still available?"),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Write an email" }),
  ).toBeInTheDocument();
  expect(screen.getByText("No email sent yet")).toBeInTheDocument();
  expect(
    state.fetch.mock.calls.some(([url]) => url.includes("/email-context")),
  ).toBe(false);
});

it("shows explicitly merged records as one conversation and retains all original enquiries", async () => {
  state.enquiries = [
    enquiry,
    {
      ...enquiry,
      id: "source-2",
      mergedIntoId: enquiry.id,
      reference: "ENQ-002",
      message: "Can I also see the service book?",
      createdAt: "2026-10-12T11:00:00Z",
    },
    {
      ...enquiry,
      id: "source-3",
      mergedIntoId: enquiry.id,
      reference: "ENQ-003",
      message: "I have a part exchange.",
      createdAt: "2026-10-12T11:30:00Z",
    },
  ];
  const original = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async (url: string, options: any) =>
    url.startsWith("/api/staff/email?")
      ? {
          messages: [
            { ...message, message: "First reply." },
            {
              ...message,
              key: "enquiry:source-reply",
              enquiry_id: "source-2",
              message: "Second reply.",
            },
          ],
          hasMore: false,
        }
      : original(url, options),
  );
  mount();
  const list = await screen.findByRole("region", {
    name: "Customer conversations",
  });
  await within(list).findByText("2 emails");
  const threads = within(list).getAllByRole("button", {
    name: /Your Ford Focus/,
  });
  expect(threads).toHaveLength(1);
  fireEvent.click(threads[0]);
  expect(
    await screen.findByText("Can I also see the service book?"),
  ).toBeInTheDocument();
  expect(screen.getByText("I have a part exchange.")).toBeInTheDocument();
  expect(
    state.fetch.mock.calls.some(
      ([url]) =>
        url.includes("includeBody=true") &&
        new URL(url, "https://example.test").searchParams.get("enquiryId") ===
          enquiry.id,
    ),
  ).toBe(true);
});

it("keeps embedded email controls in one toolbar and puts search inside the conversation list", async () => {
  mount(true);
  expect(
    screen.queryByRole("heading", { name: "Email" }),
  ).not.toBeInTheDocument();
  const toolbar = screen
    .getByRole("button", { name: "Refresh" })
    .closest(".email-toolbar");
  expect(toolbar).toContainElement(
    screen.getByRole("button", { name: "Conversations" }),
  );
  expect(toolbar).toContainElement(
    screen.getByRole("button", { name: "New email" }),
  );
  const list = await screen.findByRole("region", {
    name: "Customer conversations",
  });
  expect(list).toContainElement(
    screen.getByRole("textbox", { name: "Search email" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Drafts to review" }));
  expect(
    await screen.findByRole("textbox", { name: "Search email" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("region", { name: "Customer conversations" }),
  ).not.toBeInTheDocument();
});

it("leaves scoped customer context when returning to the conversation list", async () => {
  state.search =
    "section=notifications&workView=email&enquiryId=enquiry-1&view=sent";
  mount(true);
  fireEvent.click(
    await screen.findByRole("button", { name: "Back to conversations" }),
  );
  expect(state.navigate).toHaveBeenCalledWith(
    "/portal?section=notifications&workView=email&view=sent",
  );
});

it("sorts PostgreSQL timestamps, ISO UTC and offset timestamps by their actual instant", async () => {
  const at1900 = {
    ...message,
    key: "enquiry:at-1900",
    subject: "Earlier receipt",
    created_at: "2026-10-12 19:00:00+00",
    message: "Receipt before the enquiry.",
  };
  const at1908 = {
    ...message,
    key: "enquiry:at-1908",
    subject: "Deposit receipt",
    created_at: "2026-10-12 19:08:00+00",
    message: "Your deposit receipt.",
  };
  const at1912 = {
    ...message,
    key: "enquiry:at-1912",
    subject: "Later update",
    created_at: "2026-10-12T20:12:00+01:00",
    message: "The final update.",
  };
  const anotherCase = {
    ...message,
    key: "enquiry:other-case",
    enquiry_id: "another-case",
    created_at: "2026-10-12T19:10:00Z",
  };
  const grouped = groupEmailConversations([
    at1900,
    at1912,
    at1908,
    anotherCase,
  ] as any);
  expect(grouped[0].latest?.key).toBe(at1912.key);
  expect(grouped[1].latest?.key).toBe(anotherCase.key);
  state.enquiries = [
    {
      ...enquiry,
      source: "phone",
      createdAt: "2026-10-12T19:01:00.000Z",
      message: "The original staff enquiry.",
    },
  ];
  const original = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async (url: string, options: any) =>
    url.startsWith("/api/staff/email?")
      ? { messages: [at1912, at1908, at1900], hasMore: false }
      : original(url, options),
  );
  mount();
  fireEvent.click(await screen.findByRole("button", { name: /Later update/ }));
  const timeline = await screen.findByRole("list", {
    name: "Conversation messages",
  });
  await within(timeline).findByText("Your deposit receipt.");
  const bubbles = within(timeline).getAllByRole("article");
  expect(bubbles.map((bubble) => bubble.textContent)).toEqual([
    expect.stringContaining("Receipt before the enquiry."),
    expect.stringContaining("The original staff enquiry."),
    expect.stringContaining("Your deposit receipt."),
    expect.stringContaining("The final update."),
  ]);
});

it("keeps normal delivery progress distinct from uncertain or failed delivery", () => {
  expect(emailStatusTone("sent")).toBe("info");
  expect(emailStatusTone("sending")).toBe("info");
  expect(emailStatusTone("delivered")).toBe("success");
  expect(emailStatusTone("unknown")).toBe("warning");
  expect(emailStatusTone("delivery_delayed")).toBe("warning");
  expect(emailStatusTone("failed")).toBe("danger");
  expect(emailStatusTone("bounced")).toBe("danger");
  expect(emailStatusTone("prepared")).toBe("violet");
  expect(emailStatusTone("canceled")).toBe("neutral");
  expect(emailStatusTone("not-a-known-event")).toBe("neutral");
});
it('shows incoming customer replies as customer bubbles and only resolves them on staff action', async()=>{
  const incoming={...message,key:'reply:reply-one',kind:'reply',status:'reply_needed',subject:'Re: Your Ford Focus',message:'Can I visit tomorrow?',attachment_count:0,provider_id:null};
  state.fetch.mockImplementation(async(url:string,options:any)=>{
    if(url.startsWith('/api/staff/email/message/'))return{message:{message:incoming.message,sender:'alex@example.test'}};
    if(url.includes('/handled'))return{handled:true};
    if(url.startsWith('/api/staff/email?'))return{messages:[incoming,message],hasMore:false,repliesConnected:true};
    if(url==='/api/enquiries')return state.enquiries;
    return{drafts:[],hasMore:false};
  });
  mount();fireEvent.click(await screen.findByRole('button',{name:/Re: Your Ford Focus/}));
  await screen.findByText('Can I visit tomorrow?');
  expect(screen.getByRole('article',{name:'Re: Your Ford Focus, email from customer'}).closest('li')).toHaveClass('is-customer');
  expect(state.fetch.mock.calls.some(([url])=>url.includes('/handled'))).toBe(false);
  await screen.findByRole('button',{name:'Mark handled'});fireEvent.click(screen.getByRole('button',{name:'Mark handled'}));
  await waitFor(()=>expect(state.fetch).toHaveBeenCalledWith('/api/staff/email/replies/reply-one/handled',{method:'POST'}));
  expect(state.fetch.mock.calls.some(([url])=>url.endsWith('/status'))).toBe(false);
});
