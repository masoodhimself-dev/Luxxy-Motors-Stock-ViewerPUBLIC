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
function mount(writable = true, vehicleId = "car-one", client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider
      client={client}
    >
      <VehicleDescriptionEditor vehicleId={vehicleId} writable={writable} />
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
  await waitFor(() =>
    expect(
      screen.getByRole("textbox", { name: "Website description" }),
    ).toHaveValue(draft),
  );
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
  await screen.findByRole("textbox", { name: "Website description" });
  const review = screen.getByRole("checkbox", {
    name: "I’ve checked the facts, equipment and important information.",
  });
  fireEvent.click(review);
  expect(
    screen.getByRole("button", { name: "Publish description" }),
  ).toBeEnabled();
  fireEvent.change(
    screen.getByRole("textbox", { name: "Website description" }),
    {
      target: { value: `${draft} Edited.` },
    },
  );
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
  await screen.findByRole("textbox", { name: "Website description" });
  fireEvent.change(
    screen.getByRole("textbox", { name: "Website description" }),
    { target: { value: draft } },
  );
  state.fetch.mockRejectedValue({
    data: { error: "This car changed. Reload its latest details." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This car changed.",
  );
  expect(
    screen.getByRole("textbox", { name: "Website description" }),
  ).toHaveValue(draft);
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
  expect(
    screen.getByRole("textbox", { name: "Website description" }),
  ).toBeEnabled();
});

it("keeps unsaved copy when saving separate-history options and a verified tax rate", async () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Write description" }));
  await screen.findByRole("textbox", { name: "Website description" });
  fireEvent.change(
    screen.getByRole("textbox", { name: "Website description" }),
    { target: { value: draft } },
  );
  fireEvent.change(screen.getByLabelText("History disclosure layout"), {
    target: { value: "separate" },
  });
  fireEvent.change(
    screen.getByLabelText("Confirmed full annual vehicle tax (£) · optional"),
    { target: { value: "195" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Save description options" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Confirm the current full annual tax rate",
  );
  expect(
    state.fetch.mock.calls.filter((call) => call[1]?.method === "PUT"),
  ).toHaveLength(0);
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "I checked today’s full annual rate for this car, including any applicable supplement.",
    }),
  );
  state.fetch.mockResolvedValue({
    ...initial,
    version: "c".repeat(64),
    context: {
      placement: "separate",
      tax: {
        annualPence: 19500,
        checkedAt: new Date().toISOString(),
        sourceUrl: "https://www.gov.uk/vehicle-tax-rate-tables",
      },
    },
    taxSummary:
      "Vehicle tax: £195.00 a year, approximately £17.06 a month by Direct Debit including the 5% surcharge.",
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save description options" }),
  );
  await screen.findByText(/Options saved/);
  expect(
    screen.getByRole("textbox", { name: "Website description" }),
  ).toHaveValue(draft);
  expect(
    screen.getByRole("button", { name: "Publish description" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("complementary", { name: "Verified tax preview" }),
  ).toHaveTextContent("£17.06");
  const payload = JSON.parse(
    state.fetch.mock.calls.find((call) => call[1]?.method === "PUT")![1].body,
  );
  expect(payload.action).toBe("save-context");
  expect(payload.context.placement).toBe("separate");
  expect(payload.context.annualTaxGbp).toBe(195);
});

it('keeps unsaved description and options across Cars navigation without saving or carrying review approval', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = mount(true, 'car-one', client);
  fireEvent.click(screen.getByRole('button', { name: 'Write description' }));
  const text = await screen.findByRole('textbox', { name: 'Website description' });
  fireEvent.change(text, { target: { value: draft } });
  fireEvent.change(screen.getByLabelText('History disclosure layout'), { target: { value: 'separate' } });
  fireEvent.change(screen.getByLabelText('Confirmed full annual vehicle tax (£) · optional'), { target: { value: '195' } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'I checked today’s full annual rate for this car, including any applicable supplement.' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'I’ve checked the facts, equipment and important information.' }));
  page.unmount();
  mount(true, 'car-one', client);
  expect(await screen.findByRole('textbox', { name: 'Website description' })).toHaveValue(draft);
  expect(screen.getByLabelText('History disclosure layout')).toHaveValue('separate');
  expect(screen.getByLabelText('Confirmed full annual vehicle tax (£) · optional')).toHaveValue(195);
  expect(screen.getByRole('checkbox', { name: 'I checked today’s full annual rate for this car, including any applicable supplement.' })).not.toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'I’ve checked the facts, equipment and important information.' })).not.toBeChecked();
  expect(screen.getByRole('button', { name: 'Publish description' })).toBeDisabled();
  expect(screen.getByText(/unsaved description edits were kept in this staff session/)).toBeVisible();
  expect(state.fetch.mock.calls.filter(([, options]) => options?.method)).toHaveLength(0);
});

it('scopes retained edits to the vehicle and clears them with the authenticated staff cache', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let page = mount(true, 'car-one', client);
  fireEvent.click(screen.getByRole('button', { name: 'Write description' }));
  fireEvent.change(await screen.findByRole('textbox', { name: 'Website description' }), { target: { value: draft } });
  page.unmount();
  page = mount(true, 'car-two', client);
  expect(screen.getByRole('button', { name: 'Write description' })).toBeEnabled();
  expect(screen.queryByRole('textbox', { name: 'Website description' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Write description' }));
  expect(await screen.findByRole('textbox', { name: 'Website description' })).toHaveValue('');
  page.unmount();
  client.clear(); // The app does this on staff identity changes.
  mount(true, 'car-one', client);
  expect(screen.getByRole('button', { name: 'Write description' })).toBeEnabled();
  expect(screen.queryByRole('textbox', { name: 'Website description' })).toBeNull();
  expect(state.fetch.mock.calls.filter(([, options]) => options?.method)).toHaveLength(0);
});

it('keeps recovered wording but blocks stale-version writes until staff explicitly reload', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let page = mount(true, 'car-one', client);
  fireEvent.click(screen.getByRole('button', { name: 'Write description' }));
  fireEvent.change(await screen.findByRole('textbox', { name: 'Website description' }), { target: { value: draft } });
  page.unmount();
  state.fetch.mockResolvedValue({ ...initial, version: 'z'.repeat(64), draft: 'A newer saved description from another staff member.' });
  page = mount(true, 'car-one', client);
  await screen.findByText(/saved car details changed while you were editing/);
  expect(screen.getByRole('textbox', { name: 'Website description' })).toHaveValue(draft);
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Publish description' })).toBeDisabled();
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  fireEvent.click(screen.getByRole('button', { name: 'Reload latest details' }));
  expect(screen.getByRole('textbox', { name: 'Website description' })).toHaveValue(draft);
  confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Reload latest details' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Website description' })).toHaveValue('A newer saved description from another staff member.'));
  confirm.mockRestore();
  expect(state.fetch.mock.calls.filter(([, options]) => options?.method)).toHaveLength(0);
  page.unmount();
  mount(true, 'car-one', client);
  expect(screen.queryByRole('textbox', { name: 'Website description' })).toBeNull();
});
