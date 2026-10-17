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
  use: vi.fn(),
  busy: vi.fn(),
}));
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: unknown[]) => state.fetch(...args),
}));
import { AiDraftSuggestion } from "./ai-draft-suggestion";

const config = {
  enabled: true,
  available: true,
  reason: null,
  model: "gpt-6-luna",
  dailyLimit: 20,
  monthlyLimit: 500,
  dailyUsed: 2,
  monthlyUsed: 5,
};
const suggestion = {
  generationId: "00000000-0000-4000-8000-000000000001",
  subject: "Your Ford Fiesta enquiry",
  message:
    "Hello Alex,\n\nThank you for asking about the Ford Fiesta. We can help arrange a visit.",
  warnings: ["Confirm the appointment time with the customer."],
};
function mount(fingerprint = "original", revision = 3) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const content = (value: string, expectedRevision: number) => (
    <QueryClientProvider client={client}>
      <AiDraftSuggestion
        enquiryId="enquiry-one"
        expectedRevision={expectedRevision}
        expectedVersion={7}
        draftFingerprint={value}
        onUse={state.use}
        onBusyChange={state.busy}
      />
    </QueryClientProvider>
  );
  return { ...render(content(fingerprint, revision)), content };
}
const posts = () =>
  state.fetch.mock.calls.filter((call) => call[1]?.method === "POST");
async function disclose() {
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Draft with AI" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Draft with AI" }));
}
async function generate() {
  await disclose();
  fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
}
beforeEach(() => {
  state.fetch
    .mockReset()
    .mockImplementation(async (url: string) =>
      url.endsWith("/config") ? config : suggestion,
    );
  state.use.mockReset();
  state.busy.mockReset();
});

it("loads availability and usage without generating, saving or sending on open", async () => {
  mount();
  expect(
    await screen.findByText("2 of 20 drafts used today · 5 of 500 this month"),
  ).toBeInTheDocument();
  expect(posts()).toHaveLength(0);
  expect(state.use).not.toHaveBeenCalled();
  await disclose();
  expect(screen.getByText(/will be sent to OpenAI/)).toHaveTextContent(
    "Attachments are not sent",
  );
  expect(
    screen.getByText(/Nothing is saved or emailed automatically/),
  ).toBeInTheDocument();
  expect(posts()).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  expect(
    screen.queryByRole("button", { name: "Generate draft" }),
  ).not.toBeInTheDocument();
});

it("requests only the server context versions and UUID, then waits for staff to use the suggestion", async () => {
  mount();
  await generate();
  expect(
    await screen.findByRole("heading", { name: suggestion.subject }),
  ).toBeInTheDocument();
  expect(posts()).toHaveLength(1);
  expect(posts()[0][0]).toBe("/api/staff/enquiries/enquiry-one/ai-draft");
  expect(JSON.parse(posts()[0][1].body)).toEqual({
    requestId: expect.stringMatching(/^[a-f0-9-]{36}$/i),
    expectedRevision: 3,
    expectedVersion: 7,
  });
  expect(state.use).not.toHaveBeenCalled();
  expect(screen.getByText(suggestion.warnings[0])).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Use this draft" }));
  expect(state.use).toHaveBeenCalledExactlyOnceWith(suggestion);
  expect(posts()).toHaveLength(1);
});

it("requires an extra explicit confirmation before replacing text edited after generation", async () => {
  const view = mount();
  await generate();
  await screen.findByRole("button", { name: "Use this draft" });
  view.rerender(view.content("staff edited the message", 3));
  fireEvent.click(screen.getByRole("button", { name: "Use this draft" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "You’ve edited this email",
  );
  expect(state.use).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Keep my text" }));
  expect(state.use).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Use this draft" }));
  fireEvent.click(
    screen.getByRole("button", { name: "Replace subject and message" }),
  );
  expect(state.use).toHaveBeenCalledExactlyOnceWith(suggestion);
});

it("discards a suggestion without using or saving it", async () => {
  mount();
  await generate();
  fireEvent.click(
    await screen.findByRole("button", { name: "Discard suggestion" }),
  );
  expect(
    screen.queryByRole("heading", { name: suggestion.subject }),
  ).not.toBeInTheDocument();
  expect(state.use).not.toHaveBeenCalled();
  expect(posts()).toHaveLength(1);
});

it("retries a lost response with the identical request ID instead of creating another paid request", async () => {
  let attempts = 0;
  state.fetch.mockImplementation(async (url: string) => {
    if (url.endsWith("/config")) return config;
    if (++attempts === 1) throw new Error("Connection lost");
    return suggestion;
  });
  mount();
  await generate();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Your message is unchanged",
  );
  fireEvent.click(screen.getByRole("button", { name: "Try AI draft again" }));
  await screen.findByRole("button", { name: "Use this draft" });
  expect(posts()).toHaveLength(2);
  expect(posts()[1][1].body).toBe(posts()[0][1].body);
  expect(state.use).not.toHaveBeenCalled();
});

it("prevents overlapping requests and ignores a response for an enquiry revision that changed", async () => {
  let complete!: (value: typeof suggestion) => void;
  state.fetch.mockImplementation((url: string) =>
    url.endsWith("/config")
      ? Promise.resolve(config)
      : new Promise((resolve) => {
          complete = resolve;
        }),
  );
  const view = mount();
  await generate();
  expect(
    screen.getByRole("button", { name: "Preparing draft…" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Preparing draft…" }));
  expect(posts()).toHaveLength(1);
  expect(state.busy).toHaveBeenCalledWith(true);
  view.rerender(view.content("updated enquiry", 4));
  await act(async () => {
    complete(suggestion);
  });
  expect(
    screen.queryByRole("button", { name: "Use this draft" }),
  ).not.toBeInTheDocument();
  expect(state.use).not.toHaveBeenCalled();
  expect(state.busy).toHaveBeenCalledWith(false);
});

it("can retrieve a lost response using the same request after the final allowance was consumed", async () => {
  let attempts = 0;
  state.fetch.mockImplementation(async (url: string) => {
    if (url.endsWith("/config"))
      return attempts
        ? {
            ...config,
            available: false,
            dailyUsed: 20,
            reason: "Today’s allowance has been reached.",
          }
        : { ...config, dailyUsed: 19 };
    if (++attempts === 1) throw new Error("Response lost after generation");
    return suggestion;
  });
  mount();
  await generate();
  await screen.findByText("Today’s allowance has been reached.");
  expect(
    screen.getByRole("button", { name: "Try AI draft again" }),
  ).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Try AI draft again" }));
  await screen.findByRole("button", { name: "Use this draft" });
  expect(posts()[1][1].body).toBe(posts()[0][1].body);
});

it("shows a clear disabled reason and never sends a generation request", async () => {
  state.fetch.mockResolvedValue({
    ...config,
    enabled: false,
    available: false,
    reason: "AI drafts are available to the Luxxy pilot only.",
  });
  mount();
  expect(
    await screen.findByText("AI drafts are available to the Luxxy pilot only."),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Draft with AI" })).toBeDisabled();
  expect(posts()).toHaveLength(0);
});

it("respects the dealer allowance and retains a generated suggestion when the allowance is then exhausted", async () => {
  let used = 19;
  state.fetch.mockImplementation(async (url: string) => {
    if (url.endsWith("/config")) return { ...config, dailyUsed: used };
    used = 20;
    return suggestion;
  });
  mount();
  await generate();
  await screen.findByText(/allowance has been reached/);
  expect(screen.getByRole("button", { name: "Use this draft" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Use this draft" }));
  expect(state.use).toHaveBeenCalledExactlyOnceWith(suggestion);
  expect(screen.getByRole("button", { name: "Draft with AI" })).toBeDisabled();
});
