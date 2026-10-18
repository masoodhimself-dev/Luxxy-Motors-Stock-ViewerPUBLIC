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
  features: { customerEmails: true, staffAiDrafts: true },
}));
vi.mock('@/lib/dealer-features', () => ({ useDealerFeatures: () => ({ data: { features: state.features }, enabled: (key: 'customerEmails' | 'staffAiDrafts') => state.features[key], isLoading: false, isError: false }) }));
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: unknown[]) => state.fetch(...args),
}));
vi.mock("./enquiry-workspace-tools", () => ({
  useRefreshDesk: () => async () => {},
  workspaceError: (cause: { data?: { error?: string } }) =>
    cause.data?.error || "Could not save this draft.",
}));
import { EnquiryEmailComposer } from "./enquiry-email-composer";

const declarationContent = { subject: 'Your test-drive declaration', message: 'Please read and sign: https://example.test/test-drive-declaration/private-token', appendText: 'Declaration: https://example.test/test-drive-declaration/private-token', link: 'https://example.test/test-drive-declaration/private-token' };

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
function mount(
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  }),
) {
  const content = (value = entry) => (
    <QueryClientProvider client={client}>
      <EnquiryEmailComposer entry={value} onClose={state.close} />
    </QueryClientProvider>
  );
  return { ...render(content()), content, client };
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
  state.features = { customerEmails: true, staffAiDrafts: true };
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

it("links an unconfigured sender directly to Advanced connection settings", async () => {
  const original = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async (url: string, options: unknown) => {
    const result = await original(url, options);
    return url.endsWith("/email-context") ? { ...result, ready: false } : result;
  });
  mount();
  expect(
    await screen.findByRole("link", {
      name: "Settings → Advanced → Connections → Resend",
    }),
  ).toHaveAttribute("href", "/portal?section=settings&settingsTab=integrations");
  expect(calls("/email")).toHaveLength(0);
});

it('prepares a declaration message without saving or sending it automatically', async () => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><EnquiryEmailComposer entry={entry} initialContent={declarationContent} onClose={state.close}/></QueryClientProvider>);
  expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveValue(declarationContent.message);
  expect(screen.getByRole('textbox', { name: 'Subject' })).toHaveValue(declarationContent.subject);
  expect(screen.getByRole('textbox', { name: 'Customer email' })).toHaveValue('alex@example.test');
  expect(calls('/email')).toHaveLength(0);
  expect(calls('/email-draft')).toHaveLength(0);
  expect(screen.queryByRole('button', { name: 'Add declaration link' })).not.toBeInTheDocument();
});

it('preserves an existing draft and adds the declaration link only when staff request it', async () => {
  const original = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async (url: string, options: unknown) => {
    const result = await original(url, options);
    return url.endsWith('/email-context') ? { ...result, savedDraft: { version: 4, status: 'draft', source: 'staff', content: { to: 'chosen@example.test', subject: 'Keep my subject', message: 'Keep my staff message', photoIds: [], documentIds: [], includeVehicle: true, includeAppointment: true, expectedRevision: 2 } } } : result;
  });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><EnquiryEmailComposer entry={entry} initialContent={declarationContent} onClose={state.close}/></QueryClientProvider>);
  expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveValue('Keep my staff message');
  fireEvent.click(screen.getByRole('button', { name: 'Add declaration link' }));
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(`Keep my staff message\n\n${declarationContent.appendText}`);
  expect(screen.getByRole('textbox', { name: 'Subject' })).toHaveValue('Keep my subject');
  expect(screen.getByRole('textbox', { name: 'Customer email' })).toHaveValue('chosen@example.test');
  expect(calls('/email')).toHaveLength(0);
  expect(calls('/email-draft')).toHaveLength(0);
});

it('keeps unsaved declaration email edits and allows draft saving when its link becomes unusable', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const content = (sendBlockedReason?: string) => <QueryClientProvider client={client}><EnquiryEmailComposer entry={entry} initialContent={declarationContent} sendBlockedReason={sendBlockedReason} onClose={state.close}/></QueryClientProvider>;
  const view = render(content());
  await screen.findByRole('textbox', { name: 'Message' });
  const text = `My unsaved explanation.\n\n${declarationContent.message}`;
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: text } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Subject' }), { target: { value: 'Keep this private visit subject' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Customer email' }), { target: { value: 'chosen@example.test' } });
  view.rerender(content('This declaration link was revoked.'));
  expect(screen.getByText(/This declaration link was revoked/)).toHaveTextContent('Your text is kept here and can be saved as a draft.');
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(text);
  expect(screen.getByRole('textbox', { name: 'Subject' })).toHaveValue('Keep this private visit subject');
  expect(screen.getByRole('textbox', { name: 'Customer email' })).toHaveValue('chosen@example.test');
  expect(calls('/email-draft')).toHaveLength(0);
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText('Draft saved · not sent');
  expect(JSON.parse(calls('/email-draft')[0][1].body).content).toMatchObject({ message: text, subject: 'Keep this private visit subject', to: 'chosen@example.test' });
  fireEvent.click(screen.getByRole('button', { name: 'Review email' }));
  expect(await screen.findByRole('button', { name: 'Send email' })).toBeDisabled();
  expect(calls('/email')).toHaveLength(0);
  expect(state.close).not.toHaveBeenCalled();
});

it('disables a reviewed send when declaration status changes without losing the prepared message', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const content = (sendBlockedReason?: string) => <QueryClientProvider client={client}><EnquiryEmailComposer entry={entry} initialContent={declarationContent} sendBlockedReason={sendBlockedReason} onClose={state.close}/></QueryClientProvider>;
  const view = render(content());
  await screen.findByRole('textbox', { name: 'Message' });
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'An edited message ready for review.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review email' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send email' })).toBeEnabled());
  view.rerender(content('The customer has already signed. Check the record before sending.'));
  expect(screen.getByRole('button', { name: 'Send email' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Send email' }));
  expect(calls('/email')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Edit message' }));
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('An edited message ready for review.');
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled();
  expect(state.close).not.toHaveBeenCalled();
});

it('preserves drafting and preview while platform controls disable AI and customer delivery', async () => {
  state.features = { customerEmails: false, staffAiDrafts: false };
  mount();
  await screen.findByRole('textbox', { name: 'Message' });
  expect(screen.queryByRole('button', { name: 'Draft with AI' })).not.toBeInTheDocument();
  expect(screen.getByText(/Email sending is switched off by platform/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Review email' }));
  expect(await screen.findByRole('button', { name: 'Send email' })).toBeDisabled();
  expect(calls('/email')).toHaveLength(0);
  expect(calls('/ai-draft')).toHaveLength(0);
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

it("restores saved AI text, source and version after closing and reopening with the same query cache", async () => {
  const original = state.fetch.getMockImplementation()!;
  let stored: Record<string, unknown> = context();
  state.fetch.mockImplementation(
    async (url: string, options?: { body?: string }) => {
      if (url.endsWith("/email-context")) return stored;
      if (url.endsWith("/email-draft")) {
        const input = JSON.parse(options!.body!);
        const version = input.expectedVersion + 1;
        const previous = stored.savedDraft as {
          aiGenerationId?: string;
        } | null;
        stored = {
          ...stored,
          version,
          savedDraft: {
            version,
            status: "draft",
            source: "ai",
            aiGenerationId: input.aiGenerationId ?? previous?.aiGenerationId,
            content: input.content,
            updatedAt: "2026-10-17T11:00:00Z",
          },
        };
        return { version, savedDraft: stored.savedDraft };
      }
      return original(url, options);
    },
  );
  const first = mount();
  await generate();
  fireEvent.click(screen.getByRole("button", { name: "Use this draft" }));
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await screen.findByText("Draft saved · not sent");
  expect(
    first.client.getQueryData(["enquiry-email-context", entry.id]),
  ).toMatchObject({
    version: 5,
    savedDraft: {
      source: "ai",
      aiGenerationId: suggestion.generationId,
      content: { subject: suggestion.subject, message: suggestion.message },
    },
  });
  first.unmount();
  mount(first.client);
  expect(await screen.findByRole("textbox", { name: "Subject" })).toHaveValue(
    suggestion.subject,
  );
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(
    suggestion.message,
  );
  expect(
    screen.getByText("AI-assisted draft restored · review before sending"),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await screen.findByText("Draft saved · not sent");
  expect(JSON.parse(calls("/email-draft")[1][1].body).expectedVersion).toBe(5);
  expect(calls("/ai-draft")).toHaveLength(1);
  expect(calls("/email")).toHaveLength(0);
});

it("waits for the latest server draft instead of hydrating cached defaults from before another staff member saved", async () => {
  const original = state.fetch.getMockImplementation()!;
  let finish!: (value: unknown) => void;
  state.fetch.mockImplementation((url: string, options?: unknown) =>
    url.endsWith("/email-context")
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : original(url, options),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["enquiry-email-context", entry.id], context());
  mount(client);
  expect(screen.getByText("Loading latest email details…")).toBeInTheDocument();
  expect(
    screen.queryByRole("textbox", { name: "Message" }),
  ).not.toBeInTheDocument();
  await act(async () => {
    finish({
      ...context(),
      version: 8,
      savedDraft: {
        version: 8,
        status: "draft",
        source: "manual",
        updatedAt: "2026-10-17T11:00:00Z",
        content: {
          to: "alex@example.test",
          subject: "A teammate’s saved subject",
          message: "A teammate’s saved reply",
          includeVehicle: true,
          includeAppointment: false,
          photoIds: [],
          documentIds: [],
          expectedRevision: 2,
        },
      },
    });
  });
  expect(await screen.findByRole("textbox", { name: "Subject" })).toHaveValue(
    "A teammate’s saved subject",
  );
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(
    "A teammate’s saved reply",
  );
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await screen.findByText("Draft saved · not sent");
  expect(JSON.parse(calls("/email-draft")[0][1].body).expectedVersion).toBe(8);
  expect(calls("/ai-draft")).toHaveLength(0);
});

it("does not overwrite unsaved staff edits when the context refetches", async () => {
  const original = state.fetch.getMockImplementation()!;
  let fresh = context();
  state.fetch.mockImplementation((url: string, options?: unknown) =>
    url.endsWith("/email-context")
      ? Promise.resolve(fresh)
      : original(url, options),
  );
  const view = mount();
  await screen.findByRole("textbox", { name: "Message" });
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: "Keep this unsaved staff reply" },
  });
  fresh = {
    ...context(),
    defaults: {
      subject: "New server default",
      message: "New server default reply",
    },
  };
  await act(async () => {
    await view.client.refetchQueries({
      queryKey: ["enquiry-email-context", entry.id],
      exact: true,
    });
  });
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(
    "Keep this unsaved staff reply",
  );
  expect(screen.getByRole("textbox", { name: "Subject" })).toHaveValue(
    "Original subject",
  );
  expect(calls("/email-draft")).toHaveLength(0);
  expect(calls("/ai-draft")).toHaveLength(0);
});

it("labels saving separately from preparing an email preview", async () => {
  const original = state.fetch.getMockImplementation()!;
  let finish!: (value: unknown) => void;
  state.fetch.mockImplementation((url: string, options?: unknown) =>
    url.endsWith("/email-draft")
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : original(url, options),
  );
  mount();
  await screen.findByRole("textbox", { name: "Message" });
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  expect(screen.getByRole("button", { name: "Saving draft…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Review email" })).toBeDisabled();
  expect(screen.queryByText("Preparing preview…")).not.toBeInTheDocument();
  await act(async () => {
    finish({ version: 5 });
  });
  expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled();
  expect(calls("/email-preview")).toHaveLength(0);
});

it("can explicitly refresh stale enquiry details and generate a fresh reply without choosing a template", async () => {
  const original = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation((url: string, options?: unknown) =>
    url.endsWith("/email-context")
      ? Promise.resolve({
          ...context(),
          savedDraft: {
            version: 4,
            status: "draft",
            source: "ai",
            aiGenerationId: "00000000-0000-4000-8000-000000000009",
            updatedAt: "2026-10-17T10:00:00Z",
            content: {
              to: "alex@example.test",
              subject: "Old saved subject",
              message: "Old saved reply to review",
              includeVehicle: true,
              includeAppointment: false,
              photoIds: [],
              documentIds: ["invoice-one"],
              expectedRevision: 1,
            },
          },
        })
      : original(url, options),
  );
  mount();
  await screen.findByRole("textbox", { name: "Message" });
  expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Review email" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Draft with AI" })).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: "Use latest enquiry details" }),
  );
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(
    "Old saved reply to review",
  );
  expect(
    screen.getByRole("checkbox", { name: /Full invoice.*INV-001/ }),
  ).toBeChecked();
  await generate();
  expect(JSON.parse(calls("/ai-draft")[0][1].body)).toMatchObject({
    expectedRevision: 2,
    expectedVersion: 4,
  });
  fireEvent.click(screen.getByRole("button", { name: "Use this draft" }));
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await screen.findByText("Draft saved · not sent");
  expect(JSON.parse(calls("/email-draft")[0][1].body)).toMatchObject({
    aiGenerationId: suggestion.generationId,
    content: {
      expectedRevision: 2,
      message: suggestion.message,
      documentIds: ["invoice-one"],
    },
  });
  expect(calls("/email")).toHaveLength(0);
});

it("shows the exact server design before an explicitly requested email send", async () => {
  const original = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async (url: string, options?: unknown) => {
    const result = await original(url, options);
    if (url.endsWith("/email-preview"))
      return {
        ...result,
        html: '<html><body><h1>Approved Test Motors design</h1><p>Original staff message</p><a href="https://dealer.example/car">View car</a></body></html>',
      };
    return result;
  });
  mount();
  await screen.findByRole("textbox", { name: "Message" });
  fireEvent.click(screen.getByRole("button", { name: "Review email" }));
  const frame = await screen.findByTitle("Customer email design preview");
  expect(frame.getAttribute("srcdoc")).toContain("Approved Test Motors design");
  expect(frame).toHaveAttribute("sandbox", "");
  expect(calls("/email")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Plain text" }));
  expect(screen.getByText("Previewed draft")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Send email" })).toBeEnabled();
  expect(calls("/email")).toHaveLength(0);
});

it("restores a saved template selection and clears it when an AI reply replaces the template", async () => {
  const original = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation((url: string, options?: unknown) =>
    url.endsWith("/email-context")
      ? Promise.resolve({
          ...context(),
          savedDraft: {
            version: 4,
            status: "draft",
            source: "template",
            updatedAt: "2026-10-17T10:00:00Z",
            content: {
              to: "alex@example.test",
              templateId: "vehicle_details",
              subject: "Saved template subject",
              message: "Saved template reply",
              includeVehicle: true,
              includeAppointment: false,
              photoIds: [],
              documentIds: [],
              expectedRevision: 2,
            },
          },
        })
      : original(url, options),
  );
  mount();
  expect(
    await screen.findByRole("combobox", { name: "Email template" }),
  ).toHaveValue("vehicle_details");
  await generate();
  fireEvent.click(screen.getByRole("button", { name: "Use this draft" }));
  expect(screen.getByRole("combobox", { name: "Email template" })).toHaveValue(
    "",
  );
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(
    suggestion.message,
  );
});

it.each([
  {
    templateId: "invoice_copy",
    checkbox: /Full invoice.*INV-001/,
    warning: /Choose an invoice to attach/,
  },
  {
    templateId: "service_history",
    checkbox: /Service book.*Photo 1/,
    warning: /Choose at least one service-book photo/,
  },
  {
    templateId: "pre_accident_photos",
    checkbox: /Pre-accident.*Photo 2/,
    warning: /Choose at least one pre-accident photo/,
  },
])(
  "requires the promised attachment for $templateId without blocking an unfinished draft save",
  async ({ templateId, checkbox, warning }) => {
    const original = state.fetch.getMockImplementation()!;
    state.fetch.mockImplementation((url: string, options?: unknown) =>
      url.endsWith("/email-context")
        ? Promise.resolve({
            ...context(),
            photos: [
              ...context().photos,
              { id: "photo-two", byte_size: 1024, category: "pre_accident" },
            ],
            templates: [
              {
                id: templateId,
                label: "Attachment template",
                subject: "Your documents",
                message: "Please find your documents attached.",
              },
            ],
          })
        : original(url, options),
    );
    mount();
    fireEvent.change(
      await screen.findByRole("combobox", { name: "Email template" }),
      { target: { value: templateId } },
    );
    expect(screen.getByRole("checkbox", { name: checkbox })).toBeChecked();
    expect(screen.getByRole("button", { name: "Review email" })).toBeEnabled();
    fireEvent.click(screen.getByRole("checkbox", { name: checkbox }));
    expect(screen.getByText(warning)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review email" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled();
    fireEvent.submit(
      screen.getByRole("button", { name: "Review email" }).closest("form")!,
    );
    expect(calls("/email-preview")).toHaveLength(0);
    expect(calls("/email")).toHaveLength(0);
    expect(calls("/email-draft")).toHaveLength(0);
  },
);

it('refreshes a queued email from its journal without making a second send request', async () => {
  const original = state.fetch.getMockImplementation()!;
  let submitted = false, completed = false;
  const delivery = { id: 'delivery-one', requestId: 'approved-request', to: 'alex@example.test', subject: 'Approved reply', status: 'sending', photoCount: 0, documentCount: 0, createdAt: '2026-10-17T10:00:00Z', error: 'The provider is busy. The approved email will retry automatically.', retryAt: '2026-10-17T10:01:00Z', attempts: 1 };
  state.fetch.mockImplementation(async (url: string, options?: {method?: string}) => {
    if (url.endsWith('/email') && options?.method === 'POST') { submitted = true; return {delivery}; }
    if (url.endsWith('/email-context')) return {...context(), deliveries: submitted ? [{...delivery, ...(completed ? {status: 'sent', retryAt: null, error: null} : {})}] : []};
    return original(url, options);
  });
  mount();
  await screen.findByRole('textbox', {name: 'Message'});
  fireEvent.click(screen.getByRole('button', {name: 'Review email'}));
  fireEvent.click(await screen.findByRole('button', {name: 'Send email'}));
  expect(await screen.findByRole('heading', {name: 'Retry scheduled'})).toBeInTheDocument();
  expect(screen.getByText(/The same approved email is queued/)).toBeInTheDocument();
  completed = true;
  fireEvent.click(screen.getByRole('button', {name: 'Refresh saved status'}));
  expect(await screen.findByRole('heading', {name: 'Submitted to Resend'})).toBeInTheDocument();
  expect(screen.queryByRole('button', {name: 'Send email'})).not.toBeInTheDocument();
  expect(calls('/email')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', {name: 'Done'}));
  expect(state.close).toHaveBeenCalledWith('sent');
});

it('keeps uncertain email acceptance protected when a saved-status refresh fails', async () => {
  const original = state.fetch.getMockImplementation()!;
  let failStatus = false;
  state.fetch.mockImplementation(async (url: string, options?: {method?: string}) => {
    if (url.endsWith('/email') && options?.method === 'POST') return {delivery: {id: 'unknown-one', requestId: 'uncertain-request', to: 'alex@example.test', subject: 'Approved reply', status: 'unknown', photoCount: 0, createdAt: '2026-10-17T10:00:00Z', error: 'Check Resend before sending another copy.'}};
    if (url.endsWith('/email-context') && failStatus) throw new Error('Fictional read failure');
    return original(url, options);
  });
  mount();
  await screen.findByRole('textbox', {name: 'Message'});
  fireEvent.click(screen.getByRole('button', {name: 'Review email'}));
  fireEvent.click(await screen.findByRole('button', {name: 'Send email'}));
  await screen.findByRole('heading', {name: 'Acceptance unconfirmed'});
  failStatus = true;
  fireEvent.click(screen.getByRole('button', {name: 'Refresh saved status'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not refresh the saved status');
  expect(screen.getByRole('heading', {name: 'Acceptance unconfirmed'})).toBeInTheDocument();
  expect(screen.queryByRole('button', {name: 'Send email'})).not.toBeInTheDocument();
  expect(calls('/email')).toHaveLength(1);
});
