import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi, afterEach } from "vitest";
import { defaultInvoiceSettings } from "@workspace/vehicle-meta";
import { SalesPaperworkSettings } from "./sales-paperwork-settings";
afterEach(() => vi.unstubAllGlobals());
it('saves the suggested deposit in pence and preferred share alongside verified instructions', async () => {
  const data = { revision: 7, saleTerms: '', reservationTerms: '', invoiceSettings: { ...defaultInvoiceSettings, paymentInstructions: 'Quote your reference.' }, paymentDefaults: { suggestedDepositPence: null, preferredShare: 'email' } };
  const writes: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_input, init) => {
    if (init?.method !== 'PUT') return Response.json(data);
    const body = JSON.parse(init.body);
    writes.push(body);
    return Response.json({ ...body, revision: 8 });
  }));
  render(<SalesPaperworkSettings />);
  fireEvent.change(await screen.findByLabelText('Suggested deposit (£)'), { target: { value: '350.50' } });
  fireEvent.change(screen.getByLabelText('Preferred sharing method'), { target: { value: 'whatsapp' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save document settings' }));
  await screen.findByRole('status');
  expect(writes).toEqual([expect.objectContaining({ expectedRevision: 7, paymentDefaults: { suggestedDepositPence: 35050, preferredShare: 'whatsapp' }, invoiceSettings: data.invoiceSettings })]);
});
it("saves wording with version checks and preserves existing numbering/design values", async () => {
  const options = {
    ...defaultInvoiceSettings,
    referencePrefix: "MCM",
    startingSequence: 700,
    logoSize: "large" as const,
  };
  const data = {
    revision: 4,
    saleTerms: "Approved terms",
    reservationTerms: "Deposit terms",
    invoiceSettings: options,
  };
  const writes: any[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input, init) => {
      if (init?.method === "PUT") {
        const body = JSON.parse(init.body);
        writes.push(body);
        return Response.json({ ...data, ...body, revision: 5 });
      }
      return Response.json(data);
    }),
  );
  render(<SalesPaperworkSettings />);
  expect(
    await screen.findByText(/may not contain the dealership’s complete terms/i),
  ).toBeInTheDocument();
  expect(
    await screen.findByLabelText("Deposit and reservation terms"),
  ).toHaveAccessibleDescription(/agreed deposit and refund policy/i);
  fireEvent.change(
    await screen.findByLabelText("Terms and conditions of sale"),
    { target: { value: "Updated approved terms" } },
  );
  expect(screen.getByText(/accountant handles correction paperwork/i)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Instructions for staff (optional)"), {
    target: { value: "Ask the manager to contact our accountant." },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save document settings" }),
  );
  await screen.findByText(
    "Document settings saved. Existing invoices, payment records and numbering stay unchanged.",
  );
  expect(writes).toEqual([
    {
      expectedRevision: 4,
      saleTerms: "Updated approved terms",
      reservationTerms: "Deposit terms",
      invoiceSettings: options,
      correctionSettings: { handling: "accountant", instructions: "Ask the manager to contact our accountant." },
    },
  ]);
  expect(screen.queryByLabelText("Design style")).not.toBeInTheDocument();
  expect(
    screen.queryByLabelText("Starting sequence (minimum)"),
  ).not.toBeInTheDocument();
});
it("retains oversized historical wording for staff to shorten rather than truncate automatically", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        revision: 1,
        saleTerms: "x".repeat(601),
        reservationTerms: "",
        invoiceSettings: defaultInvoiceSettings,
      }),
    ),
  );
  render(<SalesPaperworkSettings />);
  expect(
    await screen.findByLabelText("Terms and conditions of sale"),
  ).toHaveValue("x".repeat(601));
  expect(
    screen.getByRole("button", { name: "Save document settings" }),
  ).toBeDisabled();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Nothing has been removed automatically",
  );
});
it("keeps wording after a failed save and shows an actionable error", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input, init) =>
      init?.method === "PUT"
        ? Response.json({ error: "Conflict" }, { status: 409 })
        : Response.json({
            revision: 1,
            saleTerms: "Old",
            reservationTerms: "",
            invoiceSettings: defaultInvoiceSettings,
          }),
    ),
  );
  render(<SalesPaperworkSettings />);
  fireEvent.change(
    await screen.findByLabelText("Terms and conditions of sale"),
    { target: { value: "Keep this draft" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Save document settings" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Could not save");
  expect(screen.getByLabelText("Terms and conditions of sale")).toHaveValue(
    "Keep this draft",
  );
});
