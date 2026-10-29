import { useEffect, useRef, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Enquiry } from "@workspace/api-client-react";

const state = vi.hoisted(() => ({
  emailMounts: vi.fn(),
  noteMounts: vi.fn(),
  send: vi.fn(),
}));
type EditorProps = {
  entry: Pick<Enquiry, "id" | "customerName" | "reference">;
  inline?: boolean;
  channel?: "email" | "whatsapp";
  customerPhone?: string | null;
  insertion?: { id: number; text: string };
  onClose: (result?: "sent" | "draft") => void;
  onBusyChange?: (busy: boolean) => void;
  onChooseEmail?: () => void;
};
vi.mock("./enquiry-email-composer", () => ({
  EnquiryEmailComposer: ({
    entry,
    channel,
    inline,
    insertion,
    customerPhone,
    onClose,
    onBusyChange,
    onChooseEmail,
  }: EditorProps) => {
    const [message, setMessage] = useState("");
    const inserted = useRef<number | undefined>(undefined);
    useEffect(() => {
      state.emailMounts(entry.id);
    }, []);
    useEffect(() => {
      onBusyChange?.(false);
    }, [onBusyChange]);
    useEffect(() => {
      if (!insertion || inserted.current === insertion.id) return;
      inserted.current = insertion.id;
      setMessage((value) =>
        [value, insertion.text].filter(Boolean).join("\n\n"),
      );
    }, [insertion]);
    return (
      <section
        aria-label="Mock customer reply editor"
        data-inline={String(inline)}
      >
        <p>
          {entry.customerName} · {entry.id}
        </p>
        <p>Editor channel: {channel}</p>
        <p>Phone: {customerPhone}</p>
        <label>
          Customer reply text
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
        </label>
        <button type="button" onClick={() => onBusyChange?.(true)}>
          Begin email submission
        </button>
        <button type="button" onClick={() => onBusyChange?.(false)}>
          Finish email operation
        </button>
        {channel === "whatsapp" && (
          <button type="button" onClick={() => onChooseEmail?.()}>
            Use internal email fallback
          </button>
        )}
        <button type="button" onClick={() => onClose("draft")}>
          Keep mock draft
        </button>
        <button
          type="button"
          onClick={() => {
            state.send(entry.id, message);
            onClose("sent");
          }}
        >
          Confirm mock email sent
        </button>
      </section>
    );
  },
}));
vi.mock("./enquiry-conversation", () => ({
  ConversationEditor: ({
    entry,
    inline,
    onSaved,
  }: {
    entry: Enquiry;
    inline?: boolean;
    onSaved: (entry: Enquiry) => void | Promise<void>;
  }) => {
    const [note, setNote] = useState("");
    useEffect(() => {
      state.noteMounts(entry.id);
    }, []);
    return (
      <section
        aria-label="Mock private note editor"
        data-inline={String(inline)}
      >
        <label>
          Private note text
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <button
          type="button"
          onClick={() => void onSaved({ ...entry, staffNote: note })}
        >
          Save mock private note
        </button>
      </section>
    );
  },
}));
import { EnquiryReplyDesk } from "./enquiry-reply-desk";

const entry = {
  id: "customer-one",
  customerName: "Alex Smith",
  reference: "ENQ-ONE",
  phone: "07700900123",
} as Enquiry;
const props = () => ({ entry, onSaved: vi.fn() });
const channel = (name: string) =>
  screen.getByRole("button", { name });
const message = () => screen.getByLabelText("Customer reply text");
const note = () => screen.getByLabelText("Private note text");

beforeEach(() => {
  state.emailMounts.mockClear();
  state.noteMounts.mockClear();
  state.send.mockClear();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
});
afterEach(() => vi.unstubAllGlobals());

it("mounts inline editors only after staff open a channel and never sends implicitly", () => {
  render(<EnquiryReplyDesk {...props()} />);
  expect(
    screen.queryByLabelText("Customer reply text"),
  ).not.toBeInTheDocument();
  expect(state.emailMounts).not.toHaveBeenCalled();
  expect(state.noteMounts).not.toHaveBeenCalled();
  fireEvent.click(channel("Email"));
  expect(
    screen.getByRole("region", { name: "Mock customer reply editor" }),
  ).toHaveAttribute("data-inline", "true");
  expect(message()).toBeVisible();
  expect(note()).not.toBeVisible();
  expect(screen.getByText("Phone: 07700900123")).toBeVisible();
  expect(state.send).not.toHaveBeenCalled();
});

it("keeps email, WhatsApp and private-note edits mounted while staff switch channels", () => {
  render(<EnquiryReplyDesk {...props()} />);
  fireEvent.click(channel("Email"));
  fireEvent.change(message(), {
    target: { value: "Please see the car details." },
  });
  fireEvent.click(channel("WhatsApp"));
  expect(message()).toHaveValue("Please see the car details.");
  expect(screen.getByText("Editor channel: whatsapp")).toBeVisible();
  fireEvent.click(channel("Call / private note"));
  fireEvent.change(note(), { target: { value: "Asked for a call tomorrow." } });
  fireEvent.click(channel("Email"));
  expect(message()).toHaveValue("Please see the car details.");
  expect(note()).toHaveValue("Asked for a call tomorrow.");
  fireEvent.click(channel("Call / private note"));
  expect(note()).toBeVisible();
  expect(state.emailMounts).toHaveBeenCalledTimes(1);
  expect(state.noteMounts).toHaveBeenCalledTimes(1);
  expect(state.send).not.toHaveBeenCalled();
});

it("opens an editable email for inserted check text without losing the private note or reinserting it", async () => {
  const input = props();
  const { rerender } = render(<EnquiryReplyDesk {...input} />);
  fireEvent.click(channel("Call / private note"));
  fireEvent.change(note(), { target: { value: "Internal price discussion." } });
  rerender(
    <EnquiryReplyDesk
      {...input}
      insertion={{ id: 1, text: "Estimated delivery: £57.40." }}
    />,
  );
  await waitFor(() =>
    expect(channel("Email")).toHaveAttribute("aria-pressed", "true"),
  );
  expect(message()).toHaveValue("Estimated delivery: £57.40.");
  expect(note()).toHaveValue("Internal price discussion.");
  fireEvent.change(message(), {
    target: { value: "Hello Alex. Estimated delivery: £57.40." },
  });
  fireEvent.click(channel("Call / private note"));
  rerender(
    <EnquiryReplyDesk
      {...input}
      insertion={{ id: 1, text: "Estimated delivery: £57.40." }}
    />,
  );
  expect(channel("Call / private note")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(message()).toHaveValue("Hello Alex. Estimated delivery: £57.40.");
  expect(state.send).not.toHaveBeenCalled();
});

it("switches WhatsApp fallback to internal email while preserving the editable message", () => {
  render(<EnquiryReplyDesk {...props()} />);
  fireEvent.click(channel("WhatsApp"));
  fireEvent.change(message(), {
    target: { value: "Your test drive is at 11:00." },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Use internal email fallback" }),
  );
  expect(channel("Email")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText("Editor channel: email")).toBeVisible();
  expect(message()).toHaveValue("Your test drive is at 11:00.");
  expect(state.emailMounts).toHaveBeenCalledTimes(1);
  expect(state.send).not.toHaveBeenCalled();
});

it("prevents channel switching during submission and does not rewind a consumed focus request afterwards", () => {
  const input = props();
  const { rerender } = render(
    <EnquiryReplyDesk {...input} focusRequest={1} requestedChannel="email" />,
  );
  expect(message()).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Begin email submission" }),
  );
  for (const name of ["Email", "WhatsApp", "Call / private note"])
    expect(channel(name)).toBeDisabled();
  fireEvent.click(channel("Call / private note"));
  expect(channel("Email")).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(
    screen.getByRole("button", { name: "Finish email operation" }),
  );
  fireEvent.click(channel("Call / private note"));
  rerender(
    <EnquiryReplyDesk {...input} focusRequest={1} requestedChannel="email" />,
  );
  expect(channel("Call / private note")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(note()).toBeVisible();
  expect(state.send).not.toHaveBeenCalled();
});

it("reports submission state so surrounding check-insertion actions can be disabled, then clears it for a new customer", () => {
  const input = props();
  const busy = vi.fn();
  const { rerender } = render(<EnquiryReplyDesk {...input} onBusyChange={busy} />);
  expect(busy).toHaveBeenLastCalledWith(false);
  fireEvent.click(channel("Email"));
  fireEvent.click(screen.getByRole("button", { name: "Begin email submission" }));
  expect(busy).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole("button", { name: "Finish email operation" }));
  expect(busy).toHaveBeenLastCalledWith(false);
  fireEvent.click(screen.getByRole("button", { name: "Begin email submission" }));
  rerender(<EnquiryReplyDesk {...input} entry={{ ...entry, id: "customer-two" }} onBusyChange={busy} />);
  expect(busy).toHaveBeenLastCalledWith(false);
  expect(channel("Email")).toBeEnabled();
  expect(state.send).not.toHaveBeenCalled();
});

it("honours a new explicit focus request once, without replacing either editor draft", () => {
  const input = props();
  const { rerender } = render(
    <EnquiryReplyDesk {...input} focusRequest={1} requestedChannel="note" />,
  );
  fireEvent.change(note(), { target: { value: "Keep the private context." } });
  rerender(
    <EnquiryReplyDesk
      {...input}
      focusRequest={2}
      requestedChannel="whatsapp"
    />,
  );
  expect(channel("WhatsApp")).toHaveAttribute("aria-pressed", "true");
  expect(note()).toHaveValue("Keep the private context.");
  expect(state.send).not.toHaveBeenCalled();
});

it("keeps a saved email draft in its existing editor without treating it as sent", () => {
  render(<EnquiryReplyDesk {...props()} />);
  fireEvent.click(channel("Email"));
  fireEvent.change(message(), {
    target: { value: "Review this wording first." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Keep mock draft" }));
  expect(screen.getByRole("status")).toHaveTextContent(
    "Saved draft kept with this enquiry",
  );
  expect(message()).toHaveValue("Review this wording first.");
  expect(state.emailMounts).toHaveBeenCalledTimes(1);
  expect(state.send).not.toHaveBeenCalled();
});

it("refreshes only the saved private-note editor, preserving a prepared customer reply", async () => {
  const input = props();
  render(<EnquiryReplyDesk {...input} />);
  fireEvent.click(channel("Email"));
  fireEvent.change(message(), {
    target: { value: "Your details are attached." },
  });
  fireEvent.click(channel("Call / private note"));
  fireEvent.change(note(), {
    target: { value: "Customer called about finance." },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save mock private note" }),
  );
  await waitFor(() =>
    expect(input.onSaved).toHaveBeenCalledWith({
      ...entry,
      staffNote: "Customer called about finance.",
    }),
  );
  await waitFor(() => expect(note()).toHaveValue(""));
  expect(screen.getByRole("status")).toHaveTextContent(
    "Conversation saved to this enquiry",
  );
  expect(message()).toHaveValue("Your details are attached.");
  expect(state.emailMounts).toHaveBeenCalledTimes(1);
  expect(state.send).not.toHaveBeenCalled();
});

it("clears a completed sent reply without replaying its inserted text or losing a private-note draft", async () => {
  render(
    <EnquiryReplyDesk
      {...props()}
      insertion={{ id: 3, text: "MOT details reviewed." }}
    />,
  );
  await waitFor(() => expect(message()).toHaveValue("MOT details reviewed."));
  fireEvent.click(channel("Call / private note"));
  fireEvent.change(note(), { target: { value: "Follow up tomorrow." } });
  fireEvent.click(channel("Email"));
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm mock email sent" }),
  );
  expect(state.send).toHaveBeenCalledExactlyOnceWith(
    "customer-one",
    "MOT details reviewed.",
  );
  await waitFor(() => expect(message()).toHaveValue(""));
  expect(screen.getByRole("status")).toHaveTextContent("Email submitted");
  expect(note()).toHaveValue("Follow up tomorrow.");
  expect(state.emailMounts).toHaveBeenCalledTimes(2);
});

it("isolates both editor buffers when the selected customer key changes", () => {
  const input = props();
  const { rerender } = render(<EnquiryReplyDesk {...input} />);
  fireEvent.click(channel("Email"));
  fireEvent.change(message(), {
    target: { value: "Private to Alex's enquiry." },
  });
  fireEvent.click(channel("Call / private note"));
  fireEvent.change(note(), { target: { value: "Alex's internal note." } });
  rerender(
    <EnquiryReplyDesk
      {...input}
      entry={{ ...entry, id: "customer-two", customerName: "Sam Jones" }}
    />,
  );
  expect(
    screen.queryByLabelText("Customer reply text"),
  ).not.toBeInTheDocument();
  fireEvent.click(channel("Email"));
  expect(message()).toHaveValue("");
  expect(note()).toHaveValue("");
  expect(screen.getByText("Sam Jones · customer-two")).toBeVisible();
  expect(
    screen.queryByText("Alex Smith · customer-one"),
  ).not.toBeInTheDocument();
  expect(state.send).not.toHaveBeenCalled();
});
