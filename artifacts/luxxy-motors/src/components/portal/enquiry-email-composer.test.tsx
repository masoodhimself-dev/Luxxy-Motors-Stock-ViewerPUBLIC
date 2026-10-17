import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const state = vi.hoisted(() => ({
  fetch: vi.fn(),
  close: vi.fn(),
  generationError: false,
}));
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: unknown[]) => state.fetch(...args),
}));
vi.mock("./enquiry-workspace-tools", () => ({
  useRefreshDesk: () => async () => {},
  workspaceError: (cause: { data?: { error?: string } }) =>
    cause.data?.error || "Could not save this draft.",
}));
import { EnquiryEmailComposer } from "./enquiry-email-composer";

const entry = { id: "enquiry-one", customerName: "Alex", reference: "ENQ-001" };
const config = {
  enabled: true,
  available: true,
  reason: null,
  model: "gpt-6-luna",
  dailyLimit: 20,
  monthlyLimit: 500,
  dailyUsed: 0,
  monthlyUsed: 0,
};
const suggestion = {
  generationId: "00000000-0000-4000-8000-000000000001",
  subject: "Your Ford Fiesta",
  message: "Hello Alex,\n\nThanks for your enquiry about the Ford Fiesta.",
  warnings: [],
};
function context(second = false) {
  return {
    version: 4,
    savedDraft: null,
    email: second ? "jordan@example.test" : "alex@example.test",
    customerName: second ? "Jordan" : "Alex",
    vehicleId: "car-one",
    vehicleTitle: "Ford Fiesta",
    reference: "ENQ-001",
    revision: 2,
    vehicleAvailable: true,
    appointmentAvailable: true,
    defaults: {
      subject: second ? "Jordan’s original subject" : "Original subject",
      message: "Original staff message",
    },
    ready: true,
    templates: [
      {
        id: "vehicle_details",
        label: "Vehicle details",
        subject: "Template subject",
        message: "Template reply",
      },
    ],
    invoices: [
      {
        id: "invoice-one",
        title: "Full invoice",
        number: "INV-001",
        saleId: "sale-one",
        issuedAt: "2026-10-17",
      },
    ],
    photos: [{ id: "photo-one", byte_size: 1024, category: "service_book" }],
    deliveries: [],
  };
}
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const content = (value = entry) => (
    <QueryClientProvider client={client}>
      <EnquiryEmailComposer entry={value} onClose={state.close} />
    </QueryClientProvider>
  );
  return { ...render(content()), content };
}
const calls = (suffix: string) =>
  state.fetch.mock.calls.filter(
    (call) => call[0].endsWith(suffix) && call[1]?.method === "POST",
  );
async function generate() {
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Draft with AI" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Draft with AI" }));
  fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
  await screen.findByRole("button", { name: "Use this draft" });
}
beforeEach(() => {
  state.close.mockReset();
  state.generationError = false;
  state.fetch.mockReset().mockImplementation(async (url: string) => {
    if (url.endsWith("/email-context"))
      return context(url.includes("enquiry-two"));
    if (url.endsWith("/config")) return config;
    if (url.endsWith("/ai-draft")) {
      if (state.generationError)
        throw {
          data: {
            error: "AI is temporarily unavailable. Your draft has not changed.",
          },
        };
      return suggestion;
    }
    if (url.endsWith("/email-draft")) return { version: 5 };
    if (url.includes("/photos/")) return new Blob([], { type: "image/jpeg" });
    if (url.endsWith("/email-preview"))
      return {
        to: "alex@example.test",
        subject: suggestion.subject,
        text: "Previewed draft",
        previewHash: "a".repeat(64),
        attachments: [],
      };
    throw new Error(`Unexpected request: ${url}`);
  });
});

it("keeps AI separate until accepted, then preserves the recipient and attachments when explicitly saved", async () => {
  mount();
  await screen.findByRole("textbox", { name: "Message" });
  fireEvent.change(screen.getByRole("textbox", { name: "Customer email" }), {
    target: { value: "approved@example.test" },
  });
  fireEvent.click(
    screen.getByRole("checkbox", { name: /Full invoice.*INV-001/ }),
  );
  fireEvent.click(
    screen.getByRole("checkbox", { name: /Service book.*Photo 1/ }),
  );
  await generate();
  expect(screen.getByRole("textbox", { name: "Subject" })).toHaveValue(
    "Original subject",
  );
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(
    "Original staff message",
  );
  expect(calls("/email-draft")).toHaveLength(0);
  expect(calls("/email-preview")).toHaveLength(0);
  expect(calls("/email")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Use this draft" }));
  expect(screen.getByRole("textbox", { name: "Subject" })).toHaveValue(
    suggestion.subject,
  );
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(
    suggestion.message,
  );
  expect(screen.getByRole("textbox", { name: "Customer email" })).toHaveValue(
    "approved@example.test",
  );
  expect(
    screen.getByRole("checkbox", { name: /Full invoice.*INV-001/ }),
  ).toBeChecked();
  expect(
    screen.getByRole("checkbox", { name: /Service book.*Photo 1/ }),
  ).toBeChecked();
  expect(calls("/email-draft")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await screen.findByText("Draft saved · not sent");
  expect(JSON.parse(calls("/email-draft")[0][1].body)).toMatchObject({
    expectedVersion: 4,
    aiGenerationId: suggestion.generationId,
    content: {
      to: "approved@example.test",
      subject: suggestion.subject,
      message: suggestion.message,
      photoIds: ["photo-one"],
      documentIds: ["invoice-one"],
      includeVehicle: true,
      includeAppointment: true,
      expectedRevision: 2,
    },
  });
  expect(calls("/email-preview")).toHaveLength(0);
  expect(calls("/email")).toHaveLength(0);
});

it("clears the unsaved AI generation reference when staff choose a different template", async () => {
  mount();
  await generate();
  fireEvent.click(screen.getByRole("button", { name: "Use this draft" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Email template" }), {
    target: { value: "vehicle_details" },
  });
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(
    "Template reply",
  );
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await screen.findByText("Draft saved · not sent");
  expect(JSON.parse(calls("/email-draft")[0][1].body)).toMatchObject({
    content: {
      templateId: "vehicle_details",
      subject: "Template subject",
      message: "Template reply",
    },
  });
  expect(JSON.parse(calls("/email-draft")[0][1].body)).not.toHaveProperty(
    "aiGenerationId",
  );
});

it("saves the generation reference once, then reviews using the new saved version without generating or sending again", async () => {
  mount();
  await generate();
  fireEvent.click(screen.getByRole("button", { name: "Use this draft" }));
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await screen.findByText("Draft saved · not sent");
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: `${suggestion.message}\n\nKind regards, Alex` },
  });
  fireEvent.click(screen.getByRole("button", { name: "Review email" }));
  await screen.findByText("Previewed draft");
  expect(calls("/ai-draft")).toHaveLength(1);
  expect(calls("/email-draft")).toHaveLength(2);
  expect(JSON.parse(calls("/email-draft")[0][1].body)).toHaveProperty(
    "aiGenerationId",
    suggestion.generationId,
  );
  const reviewed = JSON.parse(calls("/email-draft")[1][1].body);
  expect(reviewed.expectedVersion).toBe(5);
  expect(reviewed).not.toHaveProperty("aiGenerationId");
  expect(reviewed.content.message).toContain("Kind regards, Alex");
  expect(calls("/email")).toHaveLength(0);
});

it("retains staff text on a generation failure without saving or sending it", async () => {
  state.generationError = true;
  mount();
  await screen.findByRole("textbox", { name: "Message" });
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: "Keep my carefully written reply" },
  });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Draft with AI" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Draft with AI" }));
  fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "AI is temporarily unavailable",
  );
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(
    "Keep my carefully written reply",
  );
  expect(calls("/email-draft")).toHaveLength(0);
  expect(calls("/email")).toHaveLength(0);
});

it("temporarily locks edits and saving while a suggestion is being prepared", async () => {
  const original = state.fetch.getMockImplementation()!;
  let complete!: (value: typeof suggestion) => void;
  state.fetch.mockImplementation((url: string, options?: unknown) =>
    url.endsWith("/ai-draft")
      ? new Promise((resolve) => {
          complete = resolve;
        })
      : original(url, options),
  );
  mount();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Draft with AI" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Draft with AI" }));
  fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
  expect(screen.getByRole("textbox", { name: "Message" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Review email" })).toBeDisabled();
  expect(calls("/email-draft")).toHaveLength(0);
  await act(async () => {
    complete(suggestion);
  });
  expect(screen.getByRole("textbox", { name: "Message" })).toBeEnabled();
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(
    "Original staff message",
  );
});

it("does not carry a suggestion or its provenance into another customer's composer", async () => {
  const view = mount();
  await generate();
  fireEvent.click(screen.getByRole("button", { name: "Use this draft" }));
  view.rerender(
    view.content({
      id: "enquiry-two",
      customerName: "Jordan",
      reference: "ENQ-002",
    }),
  );
  expect(await screen.findByRole("textbox", { name: "Subject" })).toHaveValue(
    "Jordan’s original subject",
  );
  expect(screen.getByRole("textbox", { name: "Customer email" })).toHaveValue(
    "jordan@example.test",
  );
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await screen.findByText("Draft saved · not sent");
  expect(calls("/email-draft")[0][0]).toBe(
    "/api/staff/enquiries/enquiry-two/email-draft",
  );
  expect(JSON.parse(calls("/email-draft")[0][1].body)).not.toHaveProperty(
    "aiGenerationId",
  );
});
