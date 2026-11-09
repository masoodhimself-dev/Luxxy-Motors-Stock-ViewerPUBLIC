import { useRef } from "react";
import { it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from "@testing-library/react";
const state = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: unknown[]) => state.fetch(...args),
}));
import { ReplyPresence } from "./reply-presence";
const id = "099249e8-39f7-4cdb-8a10-03c6dadb14a6";
function Case({ enquiryId = id }: { enquiryId?: string } = {}) {
  const scope = useRef<HTMLElement>(null);
  return (
    <section ref={scope}>
      <div className="enquiry-reply-desk">
        <label>
          Reply
          <input />
        </label>
      </div>
      <ReplyPresence enquiryId={enquiryId} scope={scope} enabled />
    </section>
  );
}
beforeEach(() => {
  state.fetch.mockReset();
  state.fetch.mockImplementation(
    async (_url: string, options?: { method?: string; body?: string }) => ({
      presence: {
        name: "Sam",
        mine:
          options?.method === "POST" &&
          JSON.parse(options.body ?? "{}").takeover === true,
        expiresAt: new Date(Date.now() + 90_000).toISOString(),
      },
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("shows another staff member and requires explicit confirmation before taking over", async () => {
  render(<Case />);
  await screen.findByText("Sam");
  expect(screen.getByText(/does not lock/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Take over" }));
  expect(
    state.fetch.mock.calls.filter(([, o]) => o?.method === "POST"),
  ).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Confirm take over" }));
  await screen.findByText(/You are preparing a reply/);
  expect(
    state.fetch.mock.calls.filter(([, o]) => o?.method === "POST"),
  ).toHaveLength(1);
});
it("throttles input heartbeats and never silently sends a customer message", async () => {
  render(<Case />);
  await screen.findByText("Sam");
  fireEvent.focus(screen.getByRole("textbox", { name: "Reply" }));
  for (let i = 0; i < 12; i++)
    fireEvent.input(screen.getByRole("textbox", { name: "Reply" }), {
      target: { value: String(i) },
    });
  await waitFor(() =>
    expect(
      state.fetch.mock.calls.filter(([, o]) => o?.method === "POST"),
    ).toHaveLength(1),
  );
  expect(
    state.fetch.mock.calls.every(([url]) => url.includes("/presence/")),
  ).toBe(true);
});
it("reports unavailable awareness without blocking or pretending the reply is reserved", async () => {
  state.fetch.mockRejectedValue(Error("offline"));
  render(<Case />);
  await screen.findByText(/Staff reply status is unavailable/);
  expect(screen.getByRole("textbox", { name: "Reply" })).toBeEnabled();
  expect(screen.queryByText(/You are preparing/)).not.toBeInTheDocument();
});

it("ignores a late takeover result after switching to another enquiry", async () => {
  const other = "83bbd600-d843-43a6-8689-8ae87839d433";
  let complete!: (value: unknown) => void;
  state.fetch.mockImplementation(
    (url: string, options?: { method?: string }) =>
      options?.method === "POST"
        ? new Promise((resolve) => {
            complete = resolve;
          })
        : Promise.resolve({
            presence: {
              name: url.includes(other) ? "Mara" : "Sam",
              mine: false,
              expiresAt: new Date(Date.now() + 90000).toISOString(),
            },
          }),
  );
  const view = render(<Case />);
  await screen.findByText("Sam");
  fireEvent.click(screen.getByRole("button", { name: "Take over" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm take over" }));
  view.rerender(<Case enquiryId={other} />);
  await screen.findByText("Mara");
  await act(async () =>
    complete({
      presence: {
        name: "Sam",
        mine: true,
        expiresAt: new Date(Date.now() + 90000).toISOString(),
      },
    }),
  );
  expect(screen.getByText("Mara")).toBeVisible();
  expect(screen.queryByText("Sam")).not.toBeInTheDocument();
  expect(screen.queryByText(/You are preparing/)).not.toBeInTheDocument();
});
