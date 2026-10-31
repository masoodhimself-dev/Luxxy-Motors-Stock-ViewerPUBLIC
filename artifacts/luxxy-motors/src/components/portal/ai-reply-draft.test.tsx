import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  enabled: true,
  remaining: 10,
  busy: false,
  error: "",
  run: vi.fn(),
}));
vi.mock("@/lib/ai-assistance", () => ({ useAiAssistance: () => state }));
import { AiReplyDraft } from "./ai-reply-draft";
beforeEach(() => {
  state.enabled = true;
  state.remaining = 10;
  state.error = "";
  state.busy = false;
  state.run.mockReset();
});
it("generating does not change the message; explicit apply changes text only", async () => {
  const apply = vi.fn();
  state.run.mockResolvedValue({
    answer: "Please confirm the service records when you visit.",
  });
  render(
    <AiReplyDraft
      enquiryId="isolated-enquiry"
      onApply={apply}
      disabled={false}
    />,
  );
  fireEvent.click(screen.getByText("Draft a reply with AI"));
  fireEvent.click(screen.getByRole("button", { name: "Generate draft" }));
  await screen.findByRole("region", { name: "AI reply suggestion" });
  expect(state.run).toHaveBeenCalledWith("reply", {
    enquiryId: "isolated-enquiry",
  });
  expect(apply).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("button", { name: /send/i }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", {
      name: "Replace message with this suggestion",
    }),
  );
  expect(apply).toHaveBeenCalledOnce();
  expect(apply).toHaveBeenCalledWith(
    "Please confirm the service records when you visit.",
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("region", { name: "AI reply suggestion" }),
    ).not.toBeInTheDocument(),
  );
});
it("does not render when unconfigured and never calls AI automatically", () => {
  state.enabled = false;
  const { container } = render(
    <AiReplyDraft enquiryId="enquiry" onApply={vi.fn()} disabled={false} />,
  );
  expect(container).toBeEmptyDOMElement();
  expect(state.run).not.toHaveBeenCalled();
});
it("quota or locked editor cannot generate a draft", () => {
  state.remaining = 0;
  render(
    <AiReplyDraft enquiryId="enquiry" onApply={vi.fn()} disabled={false} />,
  );
  fireEvent.click(screen.getByText("Draft a reply with AI"));
  expect(screen.getByRole("button", { name: "Generate draft" })).toBeDisabled();
  expect(state.run).not.toHaveBeenCalled();
});
