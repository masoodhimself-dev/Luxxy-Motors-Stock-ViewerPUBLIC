import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Enquiry } from "@workspace/api-client-react";

const state = vi.hoisted(() => ({ save: vi.fn(), close: vi.fn() }));
vi.mock("@workspace/api-client-react", async original => ({
  ...await original<object>(),
  useChangeStaffFollowUp: () => ({ mutateAsync: state.save, isPending: false }),
  useUpdateEnquiryWorkspace: () => ({ mutateAsync: state.save, isPending: false }),
  useLogEnquiryConversation: () => ({ mutateAsync: state.save, isPending: false }),
  useGetStaffDirectory: () => ({ data: { members: [], currentUserId: "staff" } }),
}));
import { FollowUpEditor } from "./enquiry-follow-up";
import { WorkspaceEditor } from "./enquiry-workspace-tools";
import { ConversationEditor } from "./enquiry-conversation";

const entry = { id: "popup-enquiry", customerName: "Alex Example", phone: "07700900123", vehicleTitle: "Ford Focus", workspaceRevision: 2 } as Enquiry;
function mount(content: React.ReactNode) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{content}</QueryClientProvider>);
}
beforeEach(() => { state.save.mockReset().mockResolvedValue(entry); state.close.mockReset(); });

it("closes an unchanged follow-up directly, but keeps changed notes until staff discard them", () => {
  const view = mount(<FollowUpEditor entry={entry} onClose={state.close} onSaved={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(state.close).toHaveBeenCalledOnce();
  state.close.mockReset();
  const note = screen.getByLabelText("Follow-up note (optional)");
  fireEvent.change(note, { target: { value: "Call about delivery" } });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(state.close).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("Discard your changes?");
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(note).toHaveValue("Call about delivery");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(state.close).toHaveBeenCalledOnce();
  view.unmount();
});

it("puts focus on the follow-up date when the time is missing and makes no request", () => {
  mount(<FollowUpEditor entry={entry} onClose={state.close} onSaved={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Save follow-up" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Choose a date and time in the future.");
  expect(screen.getByLabelText("Follow-up date and time")).toHaveFocus();
  expect(state.save).not.toHaveBeenCalled();
});

it("lets staff keep editing after validation and discard review without losing their note", async () => {
  mount(<FollowUpEditor entry={entry} onClose={state.close} onSaved={() => {}} />);
  fireEvent.change(screen.getByLabelText("Follow-up note (optional)"), { target: { value: "Call Alex about collection" } });
  fireEvent.click(screen.getByRole("button", { name: "Save follow-up" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  fireEvent.change(screen.getByLabelText("Follow-up date and time"), { target: { value: "2099-11-05T10:00" } });
  expect(screen.getByLabelText("Follow-up date and time")).not.toHaveAttribute("aria-invalid");
  fireEvent.click(screen.getByRole("button", { name: "Save follow-up" }));
  await waitFor(() => expect(state.save).toHaveBeenCalledOnce());
  expect(state.save.mock.calls[0][0].data).toMatchObject({ action: "schedule", followUpNote: "Call Alex about collection" });
  expect(state.close).not.toHaveBeenCalled();
});

it("locks dismissal and repeat saves until both the follow-up write and its completion callback finish", async () => {
  let finishWrite!: (value: Enquiry) => void;
  let finishCallback!: () => void;
  state.save.mockReturnValue(new Promise<Enquiry>(resolve => { finishWrite = resolve; }));
  const afterSaved = vi.fn(() => new Promise<void>(resolve => { finishCallback = resolve; }));
  mount(<FollowUpEditor entry={entry} onClose={state.close} onSaved={afterSaved} />);
  fireEvent.change(screen.getByLabelText("Follow-up date and time"), { target: { value: "2099-11-05T10:00" } });
  fireEvent.click(screen.getByRole("button", { name: "Save follow-up" }));
  expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(state.close).not.toHaveBeenCalled();
  expect(state.save).toHaveBeenCalledOnce();
  await act(async () => { finishWrite(entry); });
  expect(afterSaved).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
  expect(screen.getByLabelText("Follow-up date and time")).toBeDisabled();
  await act(async () => { finishCallback(); });
  expect(screen.getByRole("button", { name: "Close" })).toBeEnabled();
});

it("protects changed assignment notes on Escape and permits explicit discard without writing", async () => {
  mount(<WorkspaceEditor entry={entry} onClose={state.close} />);
  fireEvent.change(screen.getByLabelText("Internal note"), { target: { value: "Customer asked for a call" } });
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(await screen.findByRole("alert")).toHaveTextContent("Discard your changes?");
  expect(state.close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(state.close).toHaveBeenCalledOnce();
  expect(state.save).not.toHaveBeenCalled();
});

it("refocuses an existing discard prompt on another close attempt and removes it when the edits are reverted", () => {
  mount(<WorkspaceEditor entry={entry} onClose={state.close} />);
  const note = screen.getByLabelText("Internal note");
  fireEvent.change(note, { target: { value: "Unsaved callback note" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("alert")).toHaveFocus();
  note.focus();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("alert")).toHaveFocus();
  fireEvent.change(note, { target: { value: "" } });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(state.close).toHaveBeenCalledOnce();
});

it("retains edited workspace notes after a failed save and re-enables the form", async () => {
  state.save.mockRejectedValue({ data: { error: "Another staff member updated this enquiry." } });
  mount(<WorkspaceEditor entry={entry} onClose={state.close} />);
  fireEvent.change(screen.getByLabelText("Internal note"), { target: { value: "Keep this note" } });
  fireEvent.submit(screen.getByRole("button", { name: "Save changes" }).closest("form")!);
  expect(await screen.findByRole("alert")).toHaveTextContent("Another staff member updated this enquiry.");
  expect(screen.getByLabelText("Internal note")).toHaveValue("Keep this note");
  expect(screen.getByLabelText("Internal note")).toBeEnabled();
  expect(state.close).not.toHaveBeenCalled();
});

it("keeps an unsaved conversation on Cancel and blocks closure throughout the save callback", async () => {
  let finish!: () => void;
  const onSaved = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  mount(<ConversationEditor entry={entry} onClose={state.close} onSaved={onSaved} />);
  fireEvent.change(screen.getByLabelText("Conversation note"), { target: { value: "Discussed service records" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Discard your changes?");
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  fireEvent.click(screen.getByRole("button", { name: "Save conversation" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
  expect(screen.getByLabelText("Conversation note")).toBeDisabled();
  expect(state.close).not.toHaveBeenCalled();
  await act(async () => { finish(); });
  expect(screen.getByRole("button", { name: "Close" })).toBeEnabled();
  expect(state.save).toHaveBeenCalledOnce();
});
