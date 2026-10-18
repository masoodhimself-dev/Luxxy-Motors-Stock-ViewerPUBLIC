import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ fetch: vi.fn(), enabled: true }));
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: unknown[]) => state.fetch(...args),
}));
vi.mock("./enquiry-email-composer", () => ({
  EnquiryEmailComposer: ({ initialContent, sendBlockedReason }: any) => (
    <section aria-label="Prepared declaration email">
      <p>{initialContent.subject}</p>
      <p>{initialContent.message}</p>
      <textarea aria-label="Prepared message" defaultValue={initialContent.message} />
      {sendBlockedReason && <p role="status">{sendBlockedReason}</p>}
    </section>
  ),
}));
import { TestDriveDeclarations } from "./test-drive-declarations";
const booking = {
  id: "entry-one",
  vehicleId: "car-one",
  customerName: "Alex Taylor",
  vehicleTitle: "2022 Ford Fiesta",
  reference: "ENQ-001",
  appointmentAt: "2099-10-20T10:00:00Z",
  appointmentStatus: "confirmed",
  appointmentRevision: 1,
} as any;
const record = {
  id: "declaration-one",
  status: "pending",
  revision: 0,
  createdAt: "2026-10-18T10:00:00Z",
  expiresAt: "2099-10-20T12:00:00Z",
  signedAt: null,
  signerName: null,
  statement: "Recorded statement",
  statementVersion: "v1",
  statementHash: "b".repeat(64),
  revokedAt: null,
  snapshot: {
    vehicle: { title: "2022 Ford Fiesta", registration: "AB22 CDE" },
    appointmentAt: booking.appointmentAt,
  },
  staffChecks: {
    licenceChecked: false,
    insuranceChecked: false,
    checkedAt: null,
  },
};
let records: any[];
beforeEach(() => {
  records = [];
  state.enabled = true;
  state.fetch.mockReset().mockImplementation(async (path, options) => {
    if (path === "/api/features")
      return {
        features: {
          testDriveDeclarations: state.enabled,
          customerEmails: true,
        },
        evaluatedAt: "2026-10-18T10:00:00Z",
      };
    if (!options?.method)
      return { declarations: records, currentAppointmentRevision: 1 };
    if (path.endsWith("/revoke")) {
      records = records.map((row) => ({ ...row, status: "revoked" }));
      return { revoked: true };
    }
    if (path.endsWith("/checks")) {
      const input = JSON.parse(options.body);
      records = [
        {
          ...records[0],
          revision: 1,
          staffChecks: { ...records[0].staffChecks, ...input },
        },
      ];
      return { declaration: records[0] };
    }
    const input = JSON.parse(options.body);
    records = [{ ...record }];
    return {
      declaration: records[0],
      url: `/test-drive-declaration/${input.token}`,
      replayed: false,
    };
  });
});
function mount(entry = booking) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <TestDriveDeclarations booking={entry} canEmail onClose={() => {}} />
    </QueryClientProvider>,
  );
  return { ...view, client };
}
it("creates only on request, provides QR/link, and prepares an unsent email", async () => {
  mount();
  const create = await screen.findByRole("button", {
    name: "Create signing link",
  });
  await waitFor(() => expect(create).toBeEnabled());
  expect(
    state.fetch.mock.calls.some((call) => call[1]?.method === "POST"),
  ).toBe(false);
  fireEvent.click(create);
  await screen.findByRole("region", { name: "Share declaration" });
  const calls = state.fetch.mock.calls.filter(
    (call) => call[1]?.method === "POST",
  );
  expect(calls).toHaveLength(1);
  expect(JSON.parse(calls[0][1].body).token).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.parse(calls[0][1].body)).toMatchObject({ expectedAppointmentRevision: booking.appointmentRevision, expectedVehicleId: booking.vehicleId });
  expect(
    screen.getByRole("textbox", { name: "Private signing link" }),
  ).toHaveValue(
    `${window.location.origin}/test-drive-declaration/${JSON.parse(calls[0][1].body).token}`,
  );
  fireEvent.click(screen.getByRole("button", { name: "Prepare email" }));
  expect(
    await screen.findByRole("region", { name: "Prepared declaration email" }),
  ).toHaveTextContent("Your test-drive declaration");
  expect(
    state.fetch.mock.calls.filter((call) => call[1]?.method === "POST"),
  ).toHaveLength(1);
});
it.each(['signed', 'revoked'] as const)('keeps an edited composer open when a declaration refresh changes pending to %s, and blocks its stale link', async status => {
  const { client } = mount();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Create signing link' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Create signing link' }));
  await screen.findByRole('region', { name: 'Share declaration' });
  fireEvent.click(screen.getByRole('button', { name: 'Prepare email' }));
  const editor = await screen.findByRole('textbox', { name: 'Prepared message' });
  fireEvent.change(editor, { target: { value: 'Keep my unsaved explanation about this visit.' } });
  records = records.map(row => ({ ...row, status, ...(status === 'signed' ? { signedAt: '2026-10-18T11:00:00Z', signerName: 'Alex Taylor' } : { revokedAt: '2026-10-18T11:00:00Z' }) }));
  // Refresh the same query used by the twenty-second poll; no provider or live write is involved.
  await act(async () => { await client.refetchQueries({ queryKey: ['test-drive-declarations', booking.id] }); });
  expect(await screen.findByRole('status')).toHaveTextContent('This declaration link is no longer awaiting a signature.');
  expect(screen.getByRole('region', { name: 'Prepared declaration email' })).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Prepared message' })).toBe(editor);
  expect(editor).toHaveValue('Keep my unsaved explanation about this visit.');
  expect(state.fetch.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(1);
});
it("keeps history readable but prevents new links when platform control is off", async () => {
  records = [
    {
      ...record,
      status: "signed",
      signedAt: "2026-10-18T11:00:00Z",
      signerName: "Alex Taylor",
    },
  ];
  state.enabled = false;
  mount();
  expect(await screen.findByText("Signed")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Create signing link" }),
  ).toBeDisabled();
  expect(screen.getByText(/switched off by platform/)).toBeVisible();
  expect(
    state.fetch.mock.calls.some((call) => call[1]?.method === "POST"),
  ).toBe(false);
});
it("does not allow a link for a pending or cancelled appointment", async () => {
  mount({ ...booking, appointmentStatus: "pending" });
  expect(
    await screen.findByRole("button", { name: "Create signing link" }),
  ).toBeDisabled();
  expect(
    screen.getByText(/Confirm an appointment and select its car/),
  ).toBeVisible();
});
it("revokes the unsigned link and removes the share controls without deleting history", async () => {
  mount();
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Create signing link" }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Create signing link" }));
  await screen.findByRole("region", { name: "Share declaration" });
  fireEvent.click(screen.getByRole("button", { name: "Revoke link" }));
  await screen.findByText("Link revoked");
  expect(
    screen.queryByRole("region", { name: "Share declaration" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("Recorded statement")).not.toBeVisible();
});
it("records a licence check using the current revision and never marks insurance automatically", async () => {
  records = [
    {
      ...record,
      status: "signed",
      signedAt: "2026-10-18T11:00:00Z",
      signerName: "Alex Taylor",
    },
  ];
  mount();
  fireEvent.click(
    await screen.findByRole("checkbox", { name: "Driving licence checked" }),
  );
  await waitFor(() =>
    expect(
      state.fetch.mock.calls.some((call) => call[0].endsWith("/checks")),
    ).toBe(true),
  );
  const call = state.fetch.mock.calls.find((call) =>
    call[0].endsWith("/checks"),
  );
  expect(JSON.parse(call![1].body)).toEqual({
    expectedRevision: 0,
    licenceChecked: true,
    insuranceChecked: false,
  });
});
it("keeps an old signature visible without offering checks for a different appointment", async () => {
  records = [
    {
      ...record,
      status: "signed",
      current: false,
      signedAt: "2026-10-18T11:00:00Z",
      signerName: "Alex Taylor",
    },
  ];
  mount();
  expect(await screen.findByText("Signed")).toBeVisible();
  expect(screen.getByText(/Historical signature/)).toBeVisible();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});
