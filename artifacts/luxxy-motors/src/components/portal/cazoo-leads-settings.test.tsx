import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CazooLeadsSettings } from "./cazoo-leads-settings";
const state = vi.hoisted(() => ({
  enabled: [] as boolean[],
  refetch: vi.fn(),
  mutate: vi.fn(),
  data: {
    enabled: true,
    mailbox: "cazoo@leads.example.test",
    receipts: [
      {
        id: "receipt-a",
        subject: "Enquiry - Lexus RX AB15CDE",
        status: "imported",
        enquiryId: "case-a",
        draftStatus: "ready",
        receivedAt: "2026-11-02T10:00:00Z",
        errorCode: null,
        reviewText: null,
      },
      {
        id: "receipt-b",
        subject: "Changed template",
        status: "review",
        enquiryId: null,
        draftStatus: "skipped",
        receivedAt: "2026-11-02T09:00:00Z",
        errorCode: "unrecognised_message_layout",
        reviewText: "<script>inert email text</script>",
      },
    ],
  },
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: any) => {
    state.enabled.push(options.enabled);
    return { data: state.data, refetch: state.refetch };
  },
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate: state.mutate }),
}));
it("keeps lead connection collapsed and exposes review-only drafts and inert failed email text", () => {
  render(<CazooLeadsSettings />);
  expect(state.enabled.at(-1)).toBe(false);
  expect(
    screen.queryByText("cazoo@leads.example.test"),
  ).not.toBeInTheDocument();
  const details = screen.getByText("Cazoo enquiries").closest("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  expect(state.enabled.at(-1)).toBe(true);
  expect(screen.getByText("cazoo@leads.example.test")).toBeVisible();
  expect(
    screen.getByText("AI draft ready — review before sending."),
  ).toBeVisible();
  expect(screen.getByRole("link", { name: "Open enquiry" })).toHaveAttribute(
    "href",
    "/portal?section=notifications&workView=customers&enquiryId=case-a",
  );
  expect(screen.getByText("<script>inert email text</script>").tagName).toBe(
    "PRE",
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry import" }));
  expect(state.mutate).toHaveBeenCalledWith("receipt-b");
  fireEvent.click(screen.getByRole("button", { name: "Refresh connection" }));
  expect(state.refetch).toHaveBeenCalledOnce();
  expect(
    screen.queryByRole("button", { name: /send/i }),
  ).not.toBeInTheDocument();
});
