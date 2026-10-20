import {
  fireEvent,
  render,
  screen,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: unknown[]) => state.fetch(...args),
}));
vi.mock("./enquiry-workspace-tools", () => ({
  workspaceError: (error: { data?: { error?: string } }) =>
    error?.data?.error || "Could not save. Reload and try again.",
}));
import {
  VehicleDescriptionEditor,
  type DescriptionView,
} from "./vehicle-description-editor";
const draft =
  "A Ford Focus with a petrol engine, manual gearbox, air conditioning and Bluetooth connectivity.";
const initial: DescriptionView = {
  version: "a".repeat(64),
  current: "",
  originals: ["Original advert. Category S repaired after accident."],
  disclosures: ["Category S repaired after accident."],
  draft: "",
  generationStatus: null,
  draftStale: false,
  aiAvailable: true,
  facts: {
    facts: { title: "Ford Focus", mileage: 74200 },
    features: ["Air conditioning", "Bluetooth"],
  },
};
function mount(writable = true) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <VehicleDescriptionEditor vehicleId="car-one" writable={writable} />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  state.fetch.mockReset().mockResolvedValue(initial);
});
afterEach(cleanup);
it("loads only on request, generates into editor and never publishes automatically", async () => {
  mount();
  expect(state.fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Write description" }));
  const generate = await screen.findByRole("button", {
    name: "Generate AI description",
  });
  state.fetch.mockResolvedValue({
    ...initial,
    version: "b".repeat(64),
    draft,
    generationStatus: "ready",
  });
  fireEvent.click(generate);
  expect(
    await screen.findByRole("textbox", { name: "Website description" }),
  ).toBeVisible();
  await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue(draft));
  expect(
    screen.getByRole("button", { name: "Publish description" }),
  ).toBeDisabled();
  expect(
    state.fetch.mock.calls.filter((call) => call[1]?.method === "PUT"),
  ).toHaveLength(0);
  expect(
    screen.getByText("Category S repaired after accident.", {
      selector: ".vehicle-copy-disclosures p",
    }),
  ).toBeVisible();
});
it("requires review again after edits and publishes exact staff text with revision", async () => {
  state.fetch.mockResolvedValue({ ...initial, draft });
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Write description" }));
  await screen.findByRole("textbox");
  const review = screen.getByRole("checkbox");
  fireEvent.click(review);
  expect(
    screen.getByRole("button", { name: "Publish description" }),
  ).toBeEnabled();
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: `${draft} Edited.` },
  });
  expect(review).not.toBeChecked();
  fireEvent.click(review);
  state.fetch.mockResolvedValue({
    ...initial,
    version: "b".repeat(64),
    current: `${draft} Edited.`,
  });
  fireEvent.click(screen.getByRole("button", { name: "Publish description" }));
  await screen.findByText("Description published to your website.");
  const call = state.fetch.mock.calls.find((call) => call[1]?.method === "PUT");
  expect(JSON.parse(call![1].body)).toEqual({
    action: "publish",
    expectedVersion: initial.version,
    description: `${draft} Edited.`,
    reviewed: true,
  });
});
it("allows saving without publishing, preserves edits on conflict and keeps originals visible", async () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Write description" }));
  await screen.findByRole("textbox");
  fireEvent.change(screen.getByRole("textbox"), { target: { value: draft } });
  state.fetch.mockRejectedValue({
    data: { error: "This car changed. Reload its latest details." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This car changed.",
  );
  expect(screen.getByRole("textbox")).toHaveValue(draft);
  expect(
    screen.getByText("Original advert. Category S repaired after accident."),
  ).toBeInTheDocument();
});
it("prevents writes in read-only access and shows manual editing when AI is unavailable", async () => {
  const page = mount(false);
  expect(
    screen.getByRole("button", { name: "Write description" }),
  ).toBeDisabled();
  page.unmount();
  state.fetch.mockResolvedValue({ ...initial, aiAvailable: false });
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Write description" }));
  expect(
    await screen.findByRole("button", { name: "Generate AI description" }),
  ).toBeDisabled();
  expect(screen.getByRole("textbox")).toBeEnabled();
});
