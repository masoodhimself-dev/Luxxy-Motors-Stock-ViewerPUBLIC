import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Enquiry } from "@workspace/api-client-react";
import { enquirySummaryKey } from "@/lib/enquiry-summary-query";
const state = vi.hoisted(() => ({
  fetch: vi.fn(),
  refresh: vi.fn(),
  manage: true,
}));
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: unknown[]) => state.fetch(...args),
  getGetEnquiriesQueryKey: () => ["/api/enquiries"],
}));
vi.mock("./dealer-administration", () => ({
  useStaffAccess: () => ({
    data: { permissions: state.manage ? ["sales.manage"] : [] },
  }),
}));
vi.mock("./enquiry-workspace-tools", () => ({
  useRefreshDesk: () => state.refresh,
  workspaceError: (error: { data?: { error?: string } }) =>
    error.data?.error || "Could not save. Refresh and try again.",
}));
import { EnquiryResolutionAction } from "./enquiry-resolution-action";
const entry = {
  id: "selected-enquiry",
  customerName: "Fixture buyer",
  status: "new",
  workspaceRevision: 7,
} as Enquiry;
function show(
  options: {
    current?: Enquiry;
    dirty?: boolean;
    disabled?: boolean;
    linkedCount?: number;
  } = {},
) {
  const client = new QueryClient();
  client.setQueryData(enquirySummaryKey(), [
    options.current ?? entry,
    { ...entry, id: "other" },
  ]);
  render(
    <QueryClientProvider client={client}>
      <section className="enquiry-customer-case">
        {options.dirty && (
          <textarea aria-label="Unsent reply" data-message-dirty="true" />
        )}
        <EnquiryResolutionAction
          entry={options.current ?? entry}
          disabled={options.disabled}
          linkedCount={options.linkedCount}
        />
      </section>
    </QueryClientProvider>,
  );
  return client;
}
beforeEach(() => {
  vi.clearAllMocks();
  state.manage = true;
  state.fetch.mockResolvedValue({
    id: entry.id,
    status: "closed",
    workspaceRevision: 8,
    updatedAt: "2026-11-02T12:00:00Z",
    changed: true,
  });
});
it("closes only the selected revision, updates its cache and preserves linked records", async () => {
  const cache = show({ linkedCount: 2 });
  expect(screen.getByRole("button", { name: "Mark done" })).toHaveAttribute(
    "title",
    "Changes this enquiry only. Linked enquiries keep their own status.",
  );
  fireEvent.click(screen.getByRole("button", { name: "Mark done" }));
  await waitFor(() => expect(state.refresh).toHaveBeenCalledOnce());
  expect(state.fetch).toHaveBeenCalledWith(
    "/api/staff/enquiries/selected-enquiry/resolution",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ expectedRevision: 7, status: "closed" }),
    }),
  );
  expect(cache.getQueryData<Enquiry[]>(enquirySummaryKey())).toMatchObject([
    { id: entry.id, status: "closed", workspaceRevision: 8 },
    { id: "other", status: "new", workspaceRevision: 7 },
  ]);
});
it("blocks resolution while any local message or private note is unsaved", () => {
  show({ dirty: true });
  fireEvent.click(screen.getByRole("button", { name: "Mark done" }));
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Save or discard your reply and private note",
  );
  expect(state.fetch).not.toHaveBeenCalled();
});
it("does not offer an inaccurate reopen action for closed records", () => {
  show({ current: { ...entry, status: "closed", workspaceRevision: 8 } });
  expect(
    screen.queryByRole("button", { name: "Reopen" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Mark done" }),
  ).not.toBeInTheDocument();
  expect(state.fetch).not.toHaveBeenCalled();
});
it("shows a refused outstanding-work error without hiding messages or marking the case done", async () => {
  state.fetch.mockRejectedValue({
    data: { error: "Complete the outstanding follow-up first." },
  });
  show();
  fireEvent.click(screen.getByRole("button", { name: "Mark done" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Complete the outstanding follow-up first.",
  );
  expect(screen.getByRole("button", { name: "Mark done" })).toBeEnabled();
  expect(state.refresh).not.toHaveBeenCalled();
});
it("hides the mutation for readonly staff and respects a running composer operation", () => {
  state.manage = false;
  show();
  expect(
    screen.queryByRole("button", { name: "Mark done" }),
  ).not.toBeInTheDocument();
  state.manage = true;
  show({ disabled: true });
  expect(screen.getByRole("button", { name: "Mark done" })).toBeDisabled();
  expect(state.fetch).not.toHaveBeenCalled();
});
