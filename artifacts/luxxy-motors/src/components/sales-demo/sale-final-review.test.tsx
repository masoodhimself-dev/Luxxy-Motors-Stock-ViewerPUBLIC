import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { SaleWorkspaceRecord } from "@workspace/vehicle-meta";
import { SaleFinalReview } from "./sale-final-review";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const sale = (revision = 1): SaleWorkspaceRecord =>
  ({
    id: "sale-123",
    revision,
    reference: "SALE-123",
    draft: {},
    payments: [],
    documents: [],
    events: [],
  }) as unknown as SaleWorkspaceRecord;
function checked(status: "passed" | "attention" | "unavailable", revision = 2) {
  const saved = {
    ...sale(revision),
    finalReview: {
      id: `review-${revision}`,
      checkedAt: "2026-11-03T14:35:00Z",
      reviewedRevision: revision,
      status,
      summary:
        status === "passed"
          ? "The saved details are consistent."
          : status === "attention"
            ? "Check the delivery charge."
            : "AI review is temporarily unavailable.",
      issues:
        status === "attention"
          ? [
              {
                field: "handover",
                severity: "error" as const,
                message: "Delivery has been added twice.",
              },
            ]
          : [],
    },
  };
  return { sale: saved, review: saved.finalReview };
}
function staffOverride(revision = 2) {
  const result = checked("passed", revision);
  const review = {
    ...result.review,
    status: "overridden" as const,
    summary: "Staff continued without AI review.",
    override: {
      actor: "Alex Staff",
      reason: "Manually checked the paperwork",
      at: "2026-11-03T15:00:00Z",
    },
  };
  return { sale: { ...result.sale, finalReview: review }, review };
}
it("allows staff without payment permission to view existing checks without running or overriding them", () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  render(
    <SaleFinalReview
      sale={checked("passed").sale}
      onSaved={vi.fn()}
      disabled
    />,
  );
  expect(screen.getByText("Checks passed")).toBeInTheDocument();
  expect(
    screen.getByText(
      "You can view these results. A staff member with payment permissions must run the checks or record an override.",
    ),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("button", {
      name: /Run final checks|Check again|Skip AI check|Continue without AI/,
    }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(/Save the deal before/)).not.toBeInTheDocument();
  expect(fetcher).not.toHaveBeenCalled();
});
it("keeps overridden AI advice available and labels it as a staff decision", () => {
  const result = staffOverride();
  const ignored = {
    ...checked("attention").review,
    summary: "AI flagged conflicting warranty cover.",
  };
  const review = {
    ...result.review,
    issues: ignored.issues,
    override: { ...result.review.override, ignoredReview: ignored },
  };
  render(
    <SaleFinalReview
      sale={{ ...result.sale, finalReview: review }}
      onSaved={vi.fn()}
    />,
  );
  expect(screen.getByText("Staff override")).toBeInTheDocument();
  expect(screen.getByText("Staff reviewed this issue")).toBeInTheDocument();
  expect(screen.queryByText("Fix before continuing")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("AI advice overridden"));
  expect(
    screen.getByText("AI flagged conflicting warranty cover."),
  ).toBeVisible();
});
it("shows honest pending text until the real response and saves a successful review", async () => {
  let respond!: (response: Response) => void;
  const fetcher = vi.fn(
    (_url, _init) =>
      new Promise<Response>((resolve) => {
        respond = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const onSaved = vi.fn();
  render(<SaleFinalReview canReview sale={sale()} onSaved={onSaved} />);
  fireEvent.click(screen.getByRole("button", { name: "Run final checks" }));
  expect(screen.getByRole("status")).toHaveTextContent(
    "Please wait while AI checks the sale…",
  );
  expect(screen.getByRole("button", { name: "Checking…" })).toBeDisabled();
  expect(
    screen.getByRole("list", { name: "What is checked" }).children,
  ).toHaveLength(4);
  expect(onSaved).not.toHaveBeenCalled();
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
    expectedRevision: 1,
  });
  await act(async () => respond(Response.json(checked("passed"))));
  expect(await screen.findByText("Checks passed")).toBeInTheDocument();
  expect(onSaved).toHaveBeenCalledWith(checked("passed").sale);
  expect(screen.getByRole("button", { name: "Check again" })).toBeEnabled();
});
it("shows the specific issues and navigates to their field without providing an override", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(checked("attention"))),
  );
  const navigate = vi.fn();
  render(
    <SaleFinalReview
      canReview
      sale={sale()}
      onSaved={vi.fn()}
      onNavigate={navigate}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Run final checks" }));
  expect(await screen.findByText("Needs attention")).toBeInTheDocument();
  expect(
    screen.getByText("Delivery has been added twice."),
  ).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Open Collection and delivery" }),
  );
  expect(navigate).toHaveBeenCalledWith("handover");
  expect(
    screen.queryByRole("button", { name: /override|continue anyway/i }),
  ).not.toBeInTheDocument();
});
it("offers retry after an unavailable check and uses the returned saved revision", async () => {
  const calls: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      calls.push(JSON.parse(init.body));
      return Response.json(
        checked(
          calls.length === 1 ? "unavailable" : "passed",
          calls.length + 1,
        ),
      );
    }),
  );
  render(<SaleFinalReview canReview sale={sale()} onSaved={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Run final checks" }));
  expect(await screen.findByText("Unable to check")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry checks" }));
  expect(await screen.findByText("Checks passed")).toBeInTheDocument();
  expect(calls).toEqual([{ expectedRevision: 1 }, { expectedRevision: 2 }]);
});
it("a pass expires when the saved revision changes and unsaved edits disable the check", async () => {
  const saved = checked("passed").sale;
  const view = render(
    <SaleFinalReview canReview sale={saved} onSaved={vi.fn()} />,
  );
  expect(screen.getByText("Checks passed")).toBeInTheDocument();
  view.rerender(
    <SaleFinalReview
      canReview
      sale={{ ...saved, revision: 3 }}
      onSaved={vi.fn()}
    />,
  );
  expect(screen.getByText("The sale has changed")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Run final checks" }),
  ).toBeEnabled();
  view.rerender(
    <SaleFinalReview
      canReview
      sale={{ ...saved, revision: 3 }}
      onSaved={vi.fn()}
      disabled
    />,
  );
  expect(
    screen.getByText("Save your changes, then run the final checks again."),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Run final checks" }),
  ).toBeDisabled();
});
it("offers a fresh check when external evidence changes without changing the sale revision", async () => {
  const saved = checked("passed").sale;
  const fetcher = vi.fn(async (_url: unknown, _init: RequestInit) =>
    Response.json(checked("passed", 3)),
  );
  vi.stubGlobal("fetch", fetcher);
  const view = render(
    <SaleFinalReview canReview sale={saved} onSaved={vi.fn()} />,
  );
  expect(screen.getByRole("button", { name: "Check again" })).toBeEnabled();
  view.rerender(
    <SaleFinalReview
      canReview
      sale={{ ...saved, finalReviewContextStale: true }}
      onSaved={vi.fn()}
    />,
  );
  expect(screen.getByText("The sale has changed")).toBeInTheDocument();
  expect(
    screen.getByText(
      "The delivery evidence, terms or vehicle details changed. Run the checks again before continuing.",
    ),
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Run final checks" }));
  expect(await screen.findByText("Checks passed")).toBeInTheDocument();
  expect(JSON.parse(String(fetcher.mock.calls[0][1].body))).toEqual({
    expectedRevision: 2,
  });
});
it("does not keep displaying a pass when a requested recheck fails", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));
  render(
    <SaleFinalReview
      canReview
      sale={checked("passed").sale}
      onSaved={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Check again" }));
  expect(await screen.findByText("Unable to check")).toBeInTheDocument();
  expect(screen.queryByText("Checks passed")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Retry checks" })).toBeEnabled();
});
it("records an explicit staff override with a stable retry reference and never calls it an AI pass", async () => {
  let respond!: (value: Response) => void;
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error("Connection lost"))
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          respond = resolve;
        }),
    );
  vi.stubGlobal("fetch", fetcher);
  const onSaved = vi.fn();
  render(<SaleFinalReview canReview sale={sale()} onSaved={onSaved} />);
  fireEvent.click(screen.getByRole("button", { name: "Skip AI check" }));
  expect(
    screen.getByRole("button", { name: "Record staff override" }),
  ).toBeDisabled();
  fireEvent.change(
    screen.getByRole("textbox", { name: "Reason for override" }),
    { target: { value: "Manually checked the paperwork" } },
  );
  expect(
    screen.getByRole("button", { name: "Record staff override" }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "I have reviewed this sale and want to continue without the AI review.",
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Record staff override" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "override could not be saved",
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Record staff override" }),
  );
  await waitFor(() => expect(respond).toBeTypeOf("function"));
  expect(
    screen.getByRole("button", { name: "Saving override…" }),
  ).toBeDisabled();
  expect(
    screen.queryByText("Please wait while AI checks the sale…"),
  ).not.toBeInTheDocument();
  const first = JSON.parse(fetcher.mock.calls[0][1].body),
    second = JSON.parse(fetcher.mock.calls[1][1].body);
  expect(second).toEqual(first);
  expect(first).toMatchObject({
    expectedRevision: 1,
    confirm: true,
    reason: "Manually checked the paperwork",
  });
  expect(
    fetcher.mock.calls.every((call) =>
      String(call[0]).endsWith("/override-final-review"),
    ),
  ).toBe(true);
  await act(async () => respond(Response.json(staffOverride())));
  expect(await screen.findByText("Staff override")).toBeInTheDocument();
  expect(
    screen.getByText("Recorded by Alex Staff: Manually checked the paperwork"),
  ).toBeInTheDocument();
  expect(screen.queryByText("Checks passed")).not.toBeInTheDocument();
  expect(onSaved).toHaveBeenCalledWith(staffOverride().sale);
});
it("never overwrites a newer saved deal with an in-flight check response", async () => {
  let respond!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          respond = resolve;
        }),
    ),
  );
  const onSaved = vi.fn(),
    view = render(
      <SaleFinalReview canReview sale={sale()} onSaved={onSaved} />,
    );
  fireEvent.click(screen.getByRole("button", { name: "Run final checks" }));
  await waitFor(() => expect(respond).toBeTypeOf("function"));
  view.rerender(<SaleFinalReview canReview sale={sale(3)} onSaved={onSaved} />);
  await act(async () => respond(Response.json(checked("passed"))));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "sale changed while the checks were running",
  );
  expect(onSaved).not.toHaveBeenCalled();
  expect(screen.queryByText("Checks passed")).not.toBeInTheDocument();
});
it("keeps the draft and offers retry after network failure or an invalid review revision", async () => {
  const fetcher = vi
    .fn()
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce(
      Response.json({
        ...checked("passed"),
        sale: { ...checked("passed").sale, revision: 5 },
      }),
    );
  vi.stubGlobal("fetch", fetcher);
  const onSaved = vi.fn();
  render(<SaleFinalReview canReview sale={sale()} onSaved={onSaved} />);
  fireEvent.click(screen.getByRole("button", { name: "Run final checks" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Your saved deal is kept",
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry checks" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Your saved deal is kept",
  );
  expect(onSaved).not.toHaveBeenCalled();
});
it("preserves unsaved edits introduced while the saved deal is being checked", async () => {
  let respond!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          respond = resolve;
        }),
    ),
  );
  const onSaved = vi.fn(),
    view = render(
      <SaleFinalReview canReview sale={sale()} onSaved={onSaved} />,
    );
  fireEvent.click(screen.getByRole("button", { name: "Run final checks" }));
  await waitFor(() => expect(respond).toBeTypeOf("function"));
  view.rerender(
    <SaleFinalReview canReview sale={sale()} onSaved={onSaved} disabled />,
  );
  await act(async () => respond(Response.json(checked("passed"))));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "deal has unsaved changes",
  );
  expect(onSaved).not.toHaveBeenCalled();
});
it("aborts an outstanding display request when switching to another deal", async () => {
  let respond!: (response: Response) => void, signal: AbortSignal | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn((_url, init) => {
      signal = init.signal;
      return new Promise<Response>((resolve) => {
        respond = resolve;
      });
    }),
  );
  const onSaved = vi.fn(),
    view = render(
      <SaleFinalReview canReview sale={sale()} onSaved={onSaved} />,
    );
  fireEvent.click(screen.getByRole("button", { name: "Run final checks" }));
  await waitFor(() => expect(respond).toBeTypeOf("function"));
  view.rerender(
    <SaleFinalReview
      canReview
      sale={{ ...sale(), id: "another-sale" }}
      onSaved={onSaved}
    />,
  );
  expect(signal?.aborted).toBe(true);
  expect(screen.getByRole("status")).toHaveTextContent("Final checks");
  await act(async () => respond(Response.json(checked("passed"))));
  expect(onSaved).not.toHaveBeenCalled();
  expect(screen.queryByText("Checks passed")).not.toBeInTheDocument();
});
