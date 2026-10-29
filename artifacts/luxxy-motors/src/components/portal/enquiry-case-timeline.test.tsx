import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Enquiry } from "@workspace/api-client-react";

const state = vi.hoisted(() => ({ fetch: vi.fn(), save: vi.fn() }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...(await original<object>()),
  customFetch: (...args: unknown[]) => state.fetch(...args),
  useLogEnquiryConversation: () => ({
    mutateAsync: state.save,
    isPending: false,
  }),
}));
import {
  ConversationEditor,
  CustomerActivityTimeline,
} from "./enquiry-conversation";

const record = (id = "one", extra: Partial<Enquiry> = {}) =>
  ({
    id,
    reference: `ENQ-${id}`,
    customerName: "Alex",
    message: "Original question",
    createdAt: "2026-10-28T09:00:00Z",
    events: [],
    workspaceRevision: 1,
    ...extra,
  }) as Enquiry;
const email = (key: string, extra: Record<string, unknown> = {}) => ({
  key,
  kind: "enquiry",
  enquiry_id: "one",
  subject: "Viewing confirmation",
  status: "sent",
  created_at: "2026-10-28T10:00:00Z",
  message: "Your appointment details",
  ...extra,
});
const call = {
  id: "call-1",
  kind: "conversation_logged",
  actor: "dealer",
  summary: "Call recorded",
  note: "Customer called about delivery",
  occurredAt: "2026-10-28T09:30:00Z",
};
function show(
  props: Partial<Parameters<typeof CustomerActivityTimeline>[0]> = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const rendered = render(
    <QueryClientProvider client={client}>
      <CustomerActivityTimeline entry={record()} {...props} />
    </QueryClientProvider>,
  );
  return { client, ...rendered };
}
beforeEach(() => {
  state.fetch.mockReset();
  state.save.mockReset().mockResolvedValue(record());
});

it("loads only the selected explicit case and combines saved channels without writes or provider checks", async () => {
  state.fetch.mockImplementation(async (url: string) =>
    url.includes("/staff/email?")
      ? {
          messages: [
            email("mail"),
            email("reply:1", {
              kind: "reply",
              status: "reply_needed",
              message: "See you tomorrow",
            }),
            email("sale:1", {
              kind: "sale",
              sale_id: "sale-1",
              subject: "Invoice INV-1",
              message: "Original invoice attached",
              attachment_count: 1,
            }),
          ],
          hasMore: false,
        }
      : {
          events: url.includes("/one/") ? [call] : [],
          total: url.includes("/one/") ? 1 : 0,
          nextCursor: null,
        },
  );
  const primary = record(),
    merged = record("two", { mergedIntoId: primary.id }),
    unrelated = record("other", { phone: "07000000000" });
  show({
    entry: primary,
    entries: [primary, merged, unrelated],
    canEmail: true,
  });
  expect(await screen.findByText("Your appointment details")).toBeVisible();
  expect(screen.getByText("See you tomorrow")).toBeVisible();
  expect(screen.getByText("Customer called about delivery")).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Open linked sale" }),
  ).toHaveAttribute("href", "/portal?section=sales&saleId=sale-1");
  const urls = state.fetch.mock.calls.map((call) => call[0]);
  expect(urls).toHaveLength(3);
  expect(urls).toContain("/api/staff/enquiries/one/conversations");
  expect(urls).toContain("/api/staff/enquiries/two/conversations");
  expect(urls).not.toContain("/api/staff/enquiries/other/conversations");
  expect(urls).toContain(
    "/api/staff/email?includeBody=true&offset=0&enquiryId=one",
  );
  expect(
    state.fetch.mock.calls.every(
      (call) => !call[1]?.method || call[1].method === "GET",
    ),
  ).toBe(true);
});

it("does not request or show cached email journals without email permission", async () => {
  state.fetch.mockResolvedValue({ events: [call], total: 1, nextCursor: null });
  show();
  expect(
    await screen.findByText("Customer called about delivery"),
  ).toBeVisible();
  expect(state.fetch).toHaveBeenCalledTimes(1);
  expect(state.fetch.mock.calls[0][0]).toBe(
    "/api/staff/enquiries/one/conversations",
  );
});

it("pages older notes and emails on demand and avoids duplicated journal rows", async () => {
  state.fetch.mockImplementation(async (url: string) =>
    url.includes("/staff/email?")
      ? {
          messages: url.includes("offset=50")
            ? [email("mail"), email("older", { subject: "Earlier email" })]
            : [email("mail")],
          hasMore: !url.includes("offset=50"),
        }
      : {
          events: url.includes("cursor=")
            ? [call, { ...call, id: "older", note: "Earlier call" }]
            : [call],
          total: 2,
          nextCursor: url.includes("cursor=") ? null : "older-note",
        },
  );
  show({ canEmail: true });
  fireEvent.click(
    await screen.findByRole("button", { name: "Load older activity" }),
  );
  expect(await screen.findByText("Earlier call")).toBeVisible();
  expect(await screen.findByText("Earlier email")).toBeVisible();
  expect(screen.getAllByText("Viewing confirmation")).toHaveLength(1);
  expect(screen.getAllByText("Customer called about delivery")).toHaveLength(1);
  expect(
    screen.queryByRole("button", { name: "Load older activity" }),
  ).not.toBeInTheDocument();
});

it("preserves original and current notes when a channel fails and retries without sending anything", async () => {
  let fail = true;
  state.fetch.mockImplementation(async (url: string) => {
    if (url.includes("/staff/email?")) {
      if (fail) throw new Error("Temporarily unavailable");
      return { messages: [email("mail")], hasMore: false };
    }
    return { events: [call], total: 1, nextCursor: null };
  });
  show({
    entry: record("one", { staffNote: "Private current note" }),
    canEmail: true,
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Some activity could not be loaded",
  );
  expect(screen.getByText("Original question")).toBeVisible();
  expect(screen.getByText("Private current note")).toBeVisible();
  expect(screen.getByText("Customer called about delivery")).toBeVisible();
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry activity" }));
  expect(await screen.findByText("Your appointment details")).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("invalidates selected notes using the existing enquiry write prefix", async () => {
  state.fetch.mockResolvedValue({ events: [], total: 0, nextCursor: null });
  const { client } = show();
  await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(1));
  state.fetch.mockResolvedValue({ events: [call], total: 1, nextCursor: null });
  await client.invalidateQueries({ queryKey: ["/api/enquiries"] });
  expect(
    await screen.findByText("Customer called about delivery"),
  ).toBeVisible();
});

it("refreshes incoming reply bodies and review actions when the selected or explicitly merged record changes, without requesting unrelated customers", async () => {
  let messages: ReturnType<typeof email>[] = [];
  state.fetch.mockImplementation(async (url: string) =>
    url.includes("/staff/email?")
      ? { messages, hasMore: false }
      : { events: [], total: 0, nextCursor: null },
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const content = (primaryRevision: number, linkedRevision: number, unrelatedRevision = 1) => {
    const primary = record("one", { workspaceRevision: primaryRevision });
    return <QueryClientProvider client={client}><CustomerActivityTimeline
      entry={primary}
      entries={[primary, record("two", { mergedIntoId: primary.id, workspaceRevision: linkedRevision }), record("other", { workspaceRevision: unrelatedRevision })]}
      canEmail
    /></QueryClientProvider>;
  };
  const view = render(content(1, 1));
  const timeline = screen.getByRole("region", { name: "Customer activity" });
  const journalReads = () => state.fetch.mock.calls.filter(([url]) => String(url).includes("/staff/email?"));
  await waitFor(() => expect(journalReads()).toHaveLength(1));
  expect(screen.queryByText("Email details")).not.toBeInTheDocument();
  messages = [email("reply:new-primary", { kind: "reply", status: "reply_needed", message: "Fresh reply for the selected customer" })];
  view.rerender(content(2, 1));
  expect(await screen.findByText("Fresh reply for the selected customer")).toBeVisible();
  expect(screen.getAllByText("Email details")).toHaveLength(1);
  expect(screen.getByRole("region", { name: "Customer activity" })).toBe(timeline);
  messages = [...messages, email("reply:new-linked", { enquiry_id: "two", kind: "reply", status: "reply_needed", message: "Fresh reply on the explicitly merged enquiry" })];
  view.rerender(content(2, 2));
  expect(await screen.findByText("Fresh reply on the explicitly merged enquiry")).toBeVisible();
  expect(screen.getAllByText("Email details")).toHaveLength(2);
  await waitFor(() => expect(journalReads()).toHaveLength(3));
  messages = [...messages, email("reply:unrelated", { enquiry_id: "other", kind: "reply", status: "reply_needed", message: "Private unrelated customer reply" })];
  view.rerender(content(2, 2, 2));
  expect(journalReads()).toHaveLength(3);
  expect(screen.queryByText("Private unrelated customer reply")).not.toBeInTheDocument();
  expect(journalReads().every(([url]) => String(url).endsWith("&enquiryId=one"))).toBe(true);
  expect(state.fetch.mock.calls.some(([url]) => String(url).includes("/other/"))).toBe(false);
  expect(state.fetch.mock.calls.every(([, options]) => !options?.method || options.method === "GET")).toBe(true);
});

it("reviews the saved incoming sender on demand and marks only that reply handled after staff confirmation", async () => {
  let handled = false;
  state.fetch.mockImplementation(
    async (url: string, options?: { method?: string }) => {
      if (url.endsWith("/handled") && options?.method === "POST") {
        handled = true;
        return { handled: true };
      }
      if (url.includes("/staff/email/message/"))
        return {
          message: {
            sender: "Actual Sender <customer@example.com>",
            message: "Can I change the time?",
            attachments: [],
          },
        };
      if (url.includes("/staff/email?"))
        return {
          messages: [
            email("reply:incoming-1", {
              kind: "reply",
              status: handled ? "handled" : "review",
              subject: "Change my viewing",
              message: "Can I change the time?",
            }),
          ],
          hasMore: false,
        };
      return { events: [], total: 0, nextCursor: null };
    },
  );
  show({ canEmail: true });
  expect(await screen.findByText("Change my viewing")).toBeVisible();
  expect(
    screen.getByText(
      "Check the sender and message before treating this as a customer reply.",
    ),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Mark handled" }),
  ).not.toBeInTheDocument();
  expect(
    state.fetch.mock.calls.some((call) => call[0].includes("/message/")),
  ).toBe(false);
  const summary = screen.getByText("Check sender & review reply");
  const details = summary.closest("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  expect(
    await screen.findByText("Actual Sender <customer@example.com>"),
  ).toBeVisible();
  expect(
    state.fetch.mock.calls.some((call) => call[1]?.method === "POST"),
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Mark handled" }));
  await waitFor(() =>
    expect(
      state.fetch.mock.calls.filter((call) => call[1]?.method === "POST"),
    ).toEqual([
      [
        "/api/staff/email/replies/incoming-1/handled",
        { method: "POST", responseType: "json" },
      ],
    ]),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Mark handled" }),
    ).not.toBeInTheDocument(),
  );
  expect(screen.queryByText("Reply needed")).not.toBeInTheDocument();
});

it("embeds the existing private-note editor without a dialog and retains callback validation and revisions", async () => {
  const saved = vi.fn();
  render(
    <ConversationEditor
      inline
      entry={record("one", { workspaceRevision: 3, followUpRevision: 4 })}
      onSaved={saved}
      onClose={vi.fn()}
    />,
  );
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(
    screen.getByRole("region", { name: "Private conversation note for Alex" }),
  ).not.toHaveAttribute("data-message-dirty");
  fireEvent.change(screen.getByRole("textbox", { name: "Conversation note" }), {
    target: { value: "Promised a callback" },
  });
  expect(
    screen.getByRole("region", { name: "Private conversation note for Alex" }),
  ).toHaveAttribute("data-message-dirty", "true");
  fireEvent.change(
    screen.getByRole("combobox", { name: "Conversation outcome" }),
    { target: { value: "callback_requested" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Save conversation" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Schedule the next follow-up",
  );
  expect(state.save).not.toHaveBeenCalled();
  fireEvent.change(
    screen.getByRole("combobox", { name: "Conversation outcome" }),
    { target: { value: "information_given" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Save conversation" }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByRole('region', { name: 'Private conversation note for Alex' })).not.toHaveAttribute('data-message-dirty'));
  expect(screen.getByRole('textbox', { name: 'Conversation note' })).toHaveValue('');
  expect(state.save).toHaveBeenCalledWith({
    id: "one",
    data: {
      expectedRevision: 3,
      expectedFollowUpRevision: 4,
      note: "Promised a callback",
      callOutcome: "information_given",
    },
  });
  expect(state.fetch).not.toHaveBeenCalled();
});
