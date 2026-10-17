import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const state = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: any[]) => state.fetch(...args),
}));
vi.mock("wouter", () => ({
  Link: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
import { NotificationsHome } from "./notifications-home";
import { EmailDraftQueue } from "./email-draft-queue";
const data = {
  generatedAt: "2026-10-16T10:00:00Z",
  emailAccess: true,
  counts: { enquiries: 1, followups: 0, appointments: 0, drafts: 1, email: 0 },
  items: [
    {
      id: "one",
      category: "enquiries",
      customer: "Alex",
      vehicle: "Ford Focus",
      reference: "ENQ-1",
      at: "2026-10-16T09:00:00Z",
      detail: "Awaiting a reply",
      href: "/portal?section=notifications&enquiryId=one&workView=customers",
    },
    {
      id: "two",
      category: "drafts",
      customer: "Sam",
      vehicle: "Suzuki Swift",
      reference: "ENQ-2",
      at: "2026-10-16T09:30:00Z",
      detail: "Draft ready to continue",
      href: "/portal?section=notifications&draft=two&workView=email",
    },
  ],
};
function show(ui: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {ui}
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  state.fetch.mockReset().mockResolvedValue(data);
});
it("shows actionable categories and links a reply directly to its customer without writing or sending", async () => {
  show(<NotificationsHome />);
  expect(await screen.findByRole("link", { name: /Alex/ })).toHaveAttribute(
    "href",
    "/portal?section=notifications&enquiryId=one&workView=customers",
  );
  expect(screen.getByRole("link", { name: "Prepare reply" })).toHaveAttribute(
    "href",
    "/portal?section=notifications&workView=email&compose=one",
  );
  fireEvent.click(screen.getByRole("button", { name: /Saved drafts/ }));
  expect(screen.queryByRole("link", { name: /Alex/ })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Sam/ })).toHaveAttribute(
    "href",
    "/portal?section=notifications&draft=two&workView=email",
  );
  expect(state.fetch.mock.calls.every((c) => c.length === 1)).toBe(true);
  expect(
    screen.getByText(/AI drafting and new automatic email sending are off/),
  ).toBeVisible();
});
it("hides email categories and compose links without email permission", async () => {
  state.fetch.mockResolvedValue({
    ...data,
    emailAccess: false,
    items: [data.items[0]],
    counts: { ...data.counts, drafts: 0 },
  });
  show(<NotificationsHome />);
  await screen.findByRole("link", { name: /Alex/ });
  expect(
    screen.queryByRole("button", { name: /Saved drafts/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Prepare reply" }),
  ).not.toBeInTheDocument();
});
it('explains staff-reviewed AI only for a permitted and enabled dealership without generating anything', async () => {
  state.fetch.mockResolvedValue({ ...data, capabilities: { aiDrafts: true, automaticDrafts: false, automaticSending: false } });
  show(<NotificationsHome />);
  expect(await screen.findByRole('heading', { name: 'AI reply drafts' })).toBeVisible();
  expect(screen.getByText(/Automatic sending is off/)).toBeVisible();
  expect(state.fetch.mock.calls.every(call => call[0] === '/api/staff/notifications' && call.length === 1)).toBe(true);
});
it("shows an honest error instead of an empty success when notifications fail", async () => {
  state.fetch.mockRejectedValue(new Error("offline"));
  show(<NotificationsHome />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "could not be refreshed",
  );
  expect(screen.queryByText("You’re up to date")).not.toBeInTheDocument();
});
it("keeps uncertain sends out of discard actions and opens only the selected draft", async () => {
  state.fetch.mockResolvedValue({
    drafts: [
      {
        enquiryId: "one",
        version: 2,
        status: "unknown",
        source: "manual",
        subject: "Your car",
        customerName: "Alex",
        vehicleTitle: "Focus",
        reference: "E1",
        updatedAt: data.generatedAt,
      },
    ],
    hasMore: false,
  });
  const open = vi.fn();
  show(<EmailDraftQueue search="" onOpen={open} />);
  fireEvent.click(await screen.findByRole("button", { name: /Check draft/ }));
  expect(open).toHaveBeenCalledWith("one");
  expect(
    screen.queryByRole("button", { name: "Discard" }),
  ).not.toBeInTheDocument();
  expect(state.fetch).toHaveBeenCalledTimes(1);
});
