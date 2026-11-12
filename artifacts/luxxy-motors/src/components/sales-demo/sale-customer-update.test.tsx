import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  changeSaleWorkspace, createSaleWorkspace, saleCustomerUpdates, saleWorkspaceBranding,
  type SaleWorkspaceContext, type SaleWorkspaceRecord,
} from "@workspace/vehicle-meta";
import { dealerConfig } from "@/config/dealer";
import { SaleCustomerUpdate } from "./sale-customer-update";

const state = vi.hoisted(() => ({ api: vi.fn(), email: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({ customFetch: (...args: unknown[]) => state.api(...args) }));
vi.mock("@/lib/dealer-settings-context", () => ({ useDealerSettings: () => ({ settings: { identity: { name: "Fixture Motors" } } }) }));
vi.mock("@/components/internal-share-email", () => ({ InternalShareEmail: (props: unknown) => { state.email(props); return <div>Reviewed email handoff</div>; } }));
const now = "2026-11-12T12:00:00Z";
let next = 0;
const context: SaleWorkspaceContext = {
  now, actor: "Fixture Staff", nextId: () => `test-${++next}`, nextNumber: kind => `${kind}-${++next}`,
  branding: saleWorkspaceBranding(dealerConfig),
};
const open = () => createSaleWorkspace({
  requestId: "create-update-sale", draft: {
    customer: "Jamie Patel", email: "jamie@example.test", phone: "07700900123", address: "10 Example Road",
    vehicle: "Ford Focus", registration: "AB20XYZ", vehicleId: "car-1", price: "10000",
  },
}, context, "SALE-1001").sale;
const update = (sale: SaleWorkspaceRecord, command: Parameters<typeof changeSaleWorkspace>[1]) =>
  changeSaleWorkspace(sale, command, { requestId: `update-sale-${++next}`, expectedRevision: sale.revision }, context).sale;
const deposit = () => update(open(), {
  action: "take-deposit", payment: {
    amount: "400", kind: "deposit", status: "confirmed", method: "Bank transfer", date: "2026-11-12",
    reference: "Fixture deposit", reserveConfirmed: true,
  },
});
const options = (sale: SaleWorkspaceRecord) => saleCustomerUpdates(sale, "Fixture Motors", new Date(now));

beforeEach(() => { state.api.mockReset(); state.email.mockReset(); });
afterEach(() => vi.restoreAllMocks());

it("offers an update only once a deposit has actually been recorded and the stock is reserved", () => {
  expect(options(open())).toEqual([]);
  const reserved = deposit();
  const [message] = options(reserved);
  expect(message).toMatchObject({ kind: "deposit", subject: "Deposit received for your Ford Focus" });
  expect(message.message).toContain("£400.00 recorded towards your deposit");
  expect(message.message).toContain("Ford Focus (AB20 XYZ) is reserved");
  expect(message.message).toContain("£9,600.00 left to pay");
  expect(options({ ...reserved, stockActionBlock: "another-sale" })).toEqual([]);
  expect(options({ ...reserved, lifecycle: { ...reserved.lifecycle!, status: "released" } })).toEqual([]);
  const refunded = update(reserved, { action: "reverse", paymentId: reserved.payments[0].id, amount: "400", date: "2026-11-12", reason: "Fixture refund", kind: "refund" });
  expect(options(refunded)).toEqual([]);
});

it("uses saved handover facts and keeps an outstanding sale balance clear", () => {
  const invoiced = update(deposit(), { action: "issue-invoice", kind: "full", acknowledge: true });
  const sold = update(invoiced, { action: "finish-invoice-sale", acknowledge: true, acknowledgeOutstanding: true, reviewedInvoiceId: invoiced.documents.at(-1)!.id });
  sold.draft.fulfilment = { method: "delivery", viewed: "viewed", address: "12 Example Road",
    recipient: "Jamie Patel", phone: "07700900123", scheduledDate: "2026-11-14", timeWindow: "10am to noon",
    instructions: "Internal driver note", stage: "booked" };
  const [booking, completedSale] = options(sold);
  expect(booking.message).toContain("Saturday 14 November, 10am to noon");
  expect(booking.message).toContain("Delivery address: 12 Example Road");
  expect(booking.message).not.toContain("Internal driver note");
  expect(completedSale.message).toContain("£9,600.00 left to pay");
  const preSale = open();
  preSale.draft.fulfilment = { ...sold.draft.fulfilment };
  expect(options(preSale).map(item => item.kind)).toEqual(["handover-booked"]);
  const recordedForRefund = { ...deposit().payments[0], stockConflictReconciliation: true as const };
  preSale.payments = [recordedForRefund];
  expect(options(preSale)).toEqual([]);
  preSale.payments.push({ ...recordedForRefund, id: "refund-test", kind: "refund",
    signedAmountPence: -recordedForRefund.amountPence, reversesPaymentId: recordedForRefund.id,
    stockConflictReconciliation: undefined });
  expect(options(preSale).map(item => item.kind)).toEqual(["handover-booked"]);
  sold.draft.fulfilment.stage = "unsuccessful";
  expect(options(sold).map(item => item.kind)).toEqual(["sale-complete"]);
  sold.draft.fulfilment.completedAt = "2026-11-14T11:07:00Z";
  expect(options(sold)[0].message).toContain("was delivered on Saturday 14 November");
  sold.draft.fulfilment.method = "collection";
  sold.draft.fulfilment.completedRecipient = "Different recipient";
  expect(options(sold)[0].message).toContain("Your Ford Focus (AB20 XYZ) was collected");
  expect(options(sold)[0].message).not.toContain("You collected");
  sold.corrections = [{ id: "correction", description: "Review paperwork", reference: "", recordedAt: now, recordedBy: "Staff" }];
  const corrected = options(sold).find(item => item.kind === "sale-complete")!;
  expect(corrected.message).toContain("We’ll confirm the balance with you separately.");
  expect(corrected.message).not.toContain("£");
});

it("reviews the wording, copies it manually and prepares only for the saved customer", async () => {
  const sale = deposit();
  state.api.mockResolvedValue({ sale });
  const writeText = vi.fn().mockResolvedValue(undefined);
  const oldClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  try {
    render(<SaleCustomerUpdate sale={sale} canEmail />);
    fireEvent.click(screen.getByRole("button", { name: "Customer update" }));
    const dialog = screen.getByRole("dialog", { name: "Customer update" });
    const message = within(dialog).getByRole("region", { name: "Deposit received" }).querySelector("p")!;
    expect(message).toHaveTextContent("£400.00");
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Copy for WhatsApp" })); });
    expect(writeText).toHaveBeenCalledWith(message.textContent);
    expect(state.api).toHaveBeenCalledExactlyOnceWith(`/api/sale-workspace/${sale.id}`);
    state.api.mockClear();
    fireEvent.click(within(dialog).getByRole("button", { name: "Review email" }));
    expect(state.email.mock.lastCall?.[0]).toMatchObject({
      saleId: sale.id, fixedRecipient: "jamie@example.test",
      saleUpdate: { saleId: sale.id, revision: sale.revision, kind: "deposit" },
    });
    expect(state.api).not.toHaveBeenCalled();
    state.api.mockResolvedValue({ sale: { ...sale, revision: sale.revision + 1, draft: { ...sale.draft, email: "new@example.test" } } });
    await expect(state.email.mock.lastCall?.[0].verifyBeforePrepare()).rejects.toThrow(/sale changed/i);
    expect(state.api).toHaveBeenCalledWith(`/api/sale-workspace/${sale.id}`);
  } finally {
    if (oldClipboard) Object.defineProperty(navigator, "clipboard", oldClipboard);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
});

it("prints only the reviewed text and disables old channels when the sale changes", async () => {
  const sale = deposit();
  state.api.mockResolvedValue({ sale });
  const printDoc = document.implementation.createHTMLDocument("");
  const print = vi.fn();
  vi.spyOn(window, "open").mockReturnValue({ document: printDoc, focus: vi.fn(), print } as unknown as Window);
  const view = render(<SaleCustomerUpdate sale={sale} canEmail={false} />);
  fireEvent.click(screen.getByRole("button", { name: "Customer update" }));
  expect(screen.getByRole("button", { name: "Review email" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Print update" }));
  await waitFor(() => expect(print).toHaveBeenCalledOnce());
  expect(printDoc.body.textContent).toContain("£9,600.00 left to pay");
  expect(state.api).toHaveBeenCalledExactlyOnceWith(`/api/sale-workspace/${sale.id}`);
  view.rerender(<SaleCustomerUpdate sale={{ ...sale, revision: sale.revision + 1 }} canEmail />);
  expect(screen.getByRole("alert")).toHaveTextContent("The sale changed");
  expect(screen.getByRole("button", { name: "Copy for WhatsApp" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Print update" })).toBeDisabled();
});

it("blocks stale WhatsApp copy and closes the blank print window before it receives any text", async () => {
  const sale = deposit();
  state.api.mockResolvedValue({ sale: { ...sale, revision: sale.revision + 1 } });
  const printDoc = document.implementation.createHTMLDocument("");
  const print = vi.fn(), close = vi.fn();
  vi.spyOn(window, "open").mockReturnValue({ document: printDoc, focus: vi.fn(), print, close } as unknown as Window);
  render(<SaleCustomerUpdate sale={sale} canEmail />);
  fireEvent.click(screen.getByRole("button", { name: "Customer update" }));
  fireEvent.click(screen.getByRole("button", { name: "Copy for WhatsApp" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("The sale changed");
  expect(screen.queryByText("Message copied.")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Print update" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(print).not.toHaveBeenCalled();
  expect(printDoc.body.textContent).toBe("");
});
