import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Receipt, WalletCards, Truck, CheckCircle2 } from "@/components/icons";
import { pence, saleStaffLabel, totals, type SaleDraft } from "./model";
import type {
  SaleWorkspacePayment,
  SaleWorkspacePaymentInput,
  SaleWorkspaceFulfilment,
  SaleWorkspaceDocument,
} from "@workspace/vehicle-meta";

export const saleMoney = (value: number) =>
  Number.isFinite(value)
    ? new Intl.NumberFormat("en-GB", {
        style: "currency",
        currency: "GBP",
      }).format((value || 0) / 100)
    : "—";
export function todayLondon() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  return ["year", "month", "day"]
    .map((key) => parts.find((part) => part.type === key)!.value)
    .join("-");
}
export function salePaymentState(draft: SaleDraft) {
  const amount = totals(draft);
  if (!Number.isSafeInteger(amount.balance)) return "Check amounts";
  if (amount.balance < 0) return "Customer credit";
  if (amount.totalDue === 0 && amount.price > 0) return "Balance settled";
  return amount.confirmedPaid > 0 && amount.balance === 0
    ? "Paid in full"
    : amount.confirmedPaid > 0
      ? "Part paid"
      : "Awaiting payment";
}

function validPaymentDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

/** A small, expandable calculation keeps the payable amount visible on phones. */
export function SaleFinancialSummary({ draft }: { draft: SaleDraft }) {
  const amount = totals(draft);
  return (
    <details className="sales-total-breakdown">
      <summary>
        <span>Agreed total to pay</span>
        <strong>{saleMoney(amount.totalDue)}</strong>
      </summary>
      <dl>
        <div>
          <dt>Vehicle price</dt>
          <dd>{saleMoney(amount.price)}</dd>
        </div>
        {(draft.adjustments ?? []).map((row, index) => (
          <div key={index}>
            <dt>
              {row.description.trim() ||
                (row.kind === "discount" ? "Discount" : "Fee")}
            </dt>
            <dd>
              {saleMoney(
                pence(row.amount) * (row.kind === "discount" ? -1 : 1),
              )}
            </dd>
          </div>
        ))}
        {amount.allowance !== 0 && (
          <div>
            <dt>Part-exchange allowance</dt>
            <dd>{saleMoney(-amount.allowance)}</dd>
          </div>
        )}
        <div className="sales-total-breakdown-total">
          <dt>Total to pay</dt>
          <dd>{saleMoney(amount.totalDue)}</dd>
        </div>
        {amount.confirmedPaid !== 0 && (
          <div>
            <dt>Money received, less refunds</dt>
            <dd>{saleMoney(amount.confirmedPaid)}</dd>
          </div>
        )}
        {amount.confirmedPaid !== 0 && (
          <div>
            <dt>{amount.balance < 0 ? "Customer credit" : "Balance to pay"}</dt>
            <dd>{saleMoney(Math.abs(amount.balance))}</dd>
          </div>
        )}
      </dl>
      {amount.pending > 0 && (
        <p>
          {saleMoney(amount.pending)} pending. This has not reduced the balance.
        </p>
      )}
    </details>
  );
}

export function PaymentDialog({
  balance,
  hasPayments,
  busy,
  problem,
  onClose,
  onSave,
  pending,
  initialKind,
}: {
  balance: number;
  hasPayments: boolean;
  busy: boolean;
  problem: string;
  onClose: () => void;
  onSave: (payment: SaleWorkspacePaymentInput) => void;
  pending?: SaleWorkspacePayment;
  initialKind?: "deposit" | "part-payment" | "final-payment";
}) {
  const [form, setForm] = useState<SaleWorkspacePaymentInput>({
    amount:
      pending?.amount ??
      (initialKind === "final-payment" ? (balance / 100).toFixed(2) : ""),
    method: pending?.method ?? "Bank transfer",
    date: todayLondon(),
    reference: pending?.reference ?? "",
    kind:
      initialKind ??
      (pending
        ? (pending.kind as SaleWorkspacePaymentInput["kind"])
        : hasPayments
          ? "part-payment"
          : "deposit"),
    status: "pending",
  });
  const confirmed = form.status === "confirmed";
  const paymentAmount = pence(form.amount);
  const localProblem =
    form.amount && (!Number.isSafeInteger(paymentAmount) || paymentAmount <= 0)
      ? "Enter an amount greater than zero, with no more than two decimal places."
      : Number.isSafeInteger(paymentAmount) && paymentAmount > balance
        ? "The payment exceeds the outstanding balance."
        : paymentAmount > 0 &&
            form.kind === "final-payment" &&
            paymentAmount !== balance
          ? "A final payment must settle the balance. Choose part payment for a smaller amount."
          : !validPaymentDate(form.date)
            ? "Choose a valid payment date."
            : confirmed && form.date > todayLondon()
              ? "Money received cannot have a future date."
              : "";
  const valid =
    Number.isSafeInteger(paymentAmount) &&
    paymentAmount > 0 &&
    !localProblem &&
    Boolean(form.method.trim()) &&
    (!pending || confirmed);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="portal-action-dialog sales-action-dialog"
        onEscapeKeyDown={(e) => {
          if (busy) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {pending ? "Confirm payment received" : "Record payment"}
          </DialogTitle>
          <DialogDescription>
            {pending
              ? "Check the funds have arrived. This payment will count towards the balance and receive its own receipt."
              : "Record one payment at a time. Only money confirmed as received reduces the balance."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && !busy) onSave(form);
          }}
        >
          <fieldset disabled={busy} className="sales-dialog-fields">
            <div className="sales-dialog-balance">
              <span>
                {balance < 0 ? "Customer credit" : "Outstanding balance"}
              </span>
              <strong>{saleMoney(Math.abs(balance))}</strong>
            </div>
            <label>
              Payment amount (£)
              <Input
                autoFocus
                inputMode="decimal"
                maxLength={16}
                value={form.amount}
                readOnly={Boolean(pending)}
                onChange={(e) =>
                  setForm({
                    ...form,
                    amount: e.target.value,
                    kind:
                      pence(e.target.value) === balance
                        ? "final-payment"
                        : hasPayments
                          ? "part-payment"
                          : "deposit",
                  })
                }
              />
            </label>
            <div className="sales-field-grid">
              <label>
                Payment method
                <select
                  value={form.method}
                  disabled={Boolean(pending)}
                  onChange={(e) => setForm({ ...form, method: e.target.value })}
                >
                  {["Bank transfer", "Cash", "Card", "Other"].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label>
                Payment date
                <Input
                  type="date"
                  max={confirmed ? todayLondon() : undefined}
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              </label>
            </div>
            <details
              className="sales-payment-options"
              open={pending?.reference ? true : undefined}
            >
              <summary>Payment reference &amp; type</summary>
              <label>
                Payment reference
                <Input
                  value={form.reference}
                  readOnly={Boolean(pending)}
                  onChange={(e) =>
                    setForm({ ...form, reference: e.target.value })
                  }
                />
              </label>
              {!pending && (
                <label>
                  Payment type
                  <select
                    value={form.kind}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        kind: e.target
                          .value as SaleWorkspacePaymentInput["kind"],
                      })
                    }
                  >
                    <option value="deposit">Deposit</option>
                    <option value="part-payment">Part payment</option>
                    <option value="final-payment">Final payment</option>
                  </select>
                </label>
              )}
            </details>
            <label className="sales-confirm-check">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) =>
                  setForm({
                    ...form,
                    status: e.target.checked ? "confirmed" : "pending",
                  })
                }
              />
              <span>
                Money received
                <small>
                  I have checked that these funds have been received.
                </small>
              </span>
            </label>
            {!confirmed && (
              <p className="sales-panel-note">
                Pending payments have no receipt and do not reduce the balance.
              </p>
            )}
            {valid && confirmed && (
              <div className="sales-payment-outcome" role="status">
                <span>Balance after this payment</span>
                <strong>{saleMoney(balance - paymentAmount)}</strong>
                <p>
                  {form.kind === "deposit"
                    ? "A receipt will be issued and the car reserved for this customer."
                    : "A receipt will be issued. Complete the sale separately to mark the car sold."}
                </p>
              </div>
            )}
            {localProblem && (
              <p role="alert" className="sales-action-error">
                {localProblem}
              </p>
            )}
            {problem && (
              <p role="alert" className="sales-action-error">
                {problem}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={busy || !valid}
                className="sales-primary-action"
              >
                {busy
                  ? "Saving…"
                  : pending
                    ? "Confirm & view receipt"
                    : confirmed
                      ? "Save & view receipt"
                      : "Save pending payment"}
              </Button>
            </DialogFooter>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ReversePaymentDialog({
  payment,
  invoiceOnly = false,
  availablePence,
  busy,
  problem,
  onClose,
  onSave,
}: {
  payment: SaleWorkspacePayment;
  invoiceOnly?: boolean;
  availablePence: number;
  busy: boolean;
  problem: string;
  onClose: () => void;
  onSave: (input: {
    reason: string;
    date: string;
    amount: string;
    kind: "refund" | "reversal";
    method: string;
  }) => void;
}) {
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState((availablePence / 100).toFixed(2));
  const [kind, setKind] = useState<"refund" | "reversal">("refund");
  const [date, setDate] = useState(todayLondon());
  const [method, setMethod] = useState(payment.method);
  const [refundConfirmed, setRefundConfirmed] = useState(false);
  const pending = payment.status === "pending";
  const correctionPence = pence(amount);
  const valid =
    Boolean(reason.trim()) && Boolean(date) && date <= todayLondon() && (pending || date >= payment.date) &&
    (pending ||
      (Boolean(method.trim()) && (kind !== "refund" || refundConfirmed) && Number.isSafeInteger(correctionPence) &&
        correctionPence > 0 &&
        correctionPence <= availablePence));
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="portal-action-dialog sales-action-dialog"
        onEscapeKeyDown={(e) => {
          if (busy) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {pending ? "Cancel pending payment" : "Refund or correct payment"}
          </DialogTitle>
          <DialogDescription>
            {pending
              ? "The pending entry stays in the history, marked cancelled."
              : invoiceOnly ? "Existing invoices stay unchanged. This adds an adjustment to the payment history; it does not send money. Check with your manager or accountant what further paperwork is appropriate." : "Keep the original receipt and add a separate adjustment to the payment history. This records a refund or correction; it does not send money."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && !busy)
              onSave({ reason, date, amount, kind, method });
          }}
        >
          <fieldset disabled={busy} className="sales-dialog-fields">
            <p>
              {payment.method} · {saleMoney(payment.amountPence)} ·{" "}
              {payment.date}
            </p>
            {!pending && (
              <>
                <label>
                  Action
                  <select
                    value={kind}
                    onChange={(e) =>
                      setKind(e.target.value as "refund" | "reversal")
                    }
                  >
                    <option value="refund">Record a refund</option>
                    <option value="reversal">Correct a mistaken entry</option>
                  </select>
                </label>
                <label>
                  Refund / correction amount (£)
                  <Input
                    inputMode="decimal"
                    maxLength={16}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
                <p className="sales-panel-note">
                  Available to refund or correct: {saleMoney(availablePence)}
                </p>
                <label>
                  {kind === "refund" ? "Refund method" : "Correction method"}
                  <Input value={method} maxLength={100} onChange={(e) => setMethod(e.target.value)} />
                </label>
                {kind === "refund" && (
                  <label>
                    <input type="checkbox" checked={refundConfirmed} onChange={(e) => setRefundConfirmed(e.target.checked)} />
                    {" "}I confirm the money has already been refunded. This only records it.
                  </label>
                )}
              </>
            )}
            <label>
              {pending ? "Cancellation date" : kind === "refund" ? "Refund date" : "Correction date"}
              <Input type="date" value={date} max={todayLondon()} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label>
              Reason
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            {problem && (
              <p role="alert" className="sales-action-error">
                {problem}
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" type="button" onClick={onClose}>
                Back
              </Button>
              <Button
                type="submit"
                className="sales-primary-action"
                disabled={busy || !valid}
              >
                {busy
                  ? "Saving…"
                  : pending
                    ? "Cancel payment entry"
                    : "Save adjustment"}
              </Button>
            </DialogFooter>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PaymentLedger({
  entries,
  documents,
  busy,
  onRecord,
  onDocument,
  onConfirm,
  onReverse,
  canRecord = true,
}: {
  entries: SaleWorkspacePayment[];
  documents: SaleWorkspaceDocument[];
  busy: boolean;
  onRecord: () => void;
  onDocument: (id: string) => void;
  onConfirm: (payment: SaleWorkspacePayment) => void;
  onReverse: (payment: SaleWorkspacePayment) => void;
  canRecord?: boolean;
}) {
  return (
    <section className="sales-payment-section">
      <div className="sales-ledger-heading">
        <div className="sales-panel-heading">
          <h2>Payments & receipts</h2>
          <p>
            Each confirmed payment has a permanent receipt. Pending entries are
            kept separate.
          </p>
        </div>
        <Button
          onClick={onRecord}
          disabled={busy || !canRecord}
          className="sales-primary-action"
        >
          <WalletCards size={16} />
          Record payment
        </Button>
      </div>
      {!entries.length ? (
        <div className="sales-entry-empty">
          <WalletCards size={23} />
          <div>
            <h3>No payments recorded</h3>
            <p>
              Record a deposit, part payment or full payment when the customer
              pays.
            </p>
          </div>
        </div>
      ) : (
        <ol className="sales-payment-ledger">
          {entries.map((entry) => {
            const remaining =
              entry.amountPence +
              entries
                .filter((p) => p.reversesPaymentId === entry.id)
                .reduce((sum, p) => sum + p.signedAmountPence, 0);
            const doc = documents.find((d) => d.id === entry.receiptId);
            return (
              <li
                key={entry.id}
                data-status={entry.status}
                data-testid={`payment-${entry.id}`}
              >
                <div className="sales-payment-entry-summary">
                  <div>
                    <strong>
                      {entry.kind === "deposit"
                        ? "Deposit"
                        : entry.kind === "final-payment"
                          ? "Final payment"
                          : entry.kind === "refund"
                            ? "Refund"
                            : entry.kind === "reversal"
                              ? "Correction"
                              : entry.kind === "refund-correction"
                                ? "Refund correction"
                                : "Part payment"}
                    </strong>
                    <span>
                      {entry.status === "pending" ? "Expected " : ""}
                      {entry.date} · {entry.method}
                    </span>
                    {entry.reference && <small>{entry.reference}</small>}
                    {entry.reason && <small>Reason: {entry.reason}</small>}
                    <small>
                      Recorded by {saleStaffLabel(entry.recordedBy)}
                    </small>
                  </div>
                  <div>
                    <strong>{saleMoney(entry.signedAmountPence)}</strong>
                    <span
                      className="sales-status-tag"
                      data-status={entry.status}
                    >
                      {entry.status === "confirmed"
                        ? "Confirmed"
                        : entry.status === "cancelled"
                          ? "Cancelled"
                          : "Pending"}
                    </span>
                  </div>
                </div>
                <div className="sales-payment-entry-actions">
                  {doc && (
                    <Button
                      variant="outline"
                      onClick={() => onDocument(doc.id)}
                    >
                      <Receipt size={15} />
                      View receipt
                    </Button>
                  )}
                  {entry.status === "pending" && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => onConfirm(entry)}
                    >
                      Confirm received
                    </Button>
                  )}
                  {entry.status === "pending" ? (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => onReverse(entry)}
                    >
                      Cancel pending
                    </Button>
                  ) : (
                    entry.status === "confirmed" &&
                    entry.signedAmountPence > 0 &&
                    entry.kind !== "refund-correction" &&
                    remaining > 0 && (
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() => onReverse(entry)}
                      >
                        Refund / correct
                      </Button>
                    )
                  )}
                  {doc && <small>{doc.number}</small>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export function DeliveryPanel({
  saleCompleted = false,
  draft,
  busy,
  onChange,
  onComplete,
  onReview,
}: {
  draft: SaleDraft;
  saleCompleted?: boolean;
  busy: boolean;
  onChange: (value: SaleWorkspaceFulfilment) => void;
  onComplete: () => void;
  onReview: (key: "preparation" | "documents", checked: boolean) => void;
}) {
  const value = draft.fulfilment ?? {
    method: "collection",
    viewed: "not-yet-viewed",
    address: "",
    recipient: "",
    phone: "",
    scheduledDate: draft.collection,
    timeWindow: "",
    instructions: "",
  };
  const update = (key: keyof SaleWorkspaceFulfilment, next: string) =>
    onChange({ ...value, [key]: next });
  const delivery = value.method === "delivery";
  return (
    <div className="sales-form-panel">
      <div className="sales-panel-heading">
        <h2>Collection or delivery</h2>
        <p>
          Arrange the handover whether the customer has visited or is buying
          remotely.
        </p>
      </div>
      {value.completedAt && (
        <div className="sales-completion-notice" role="status">
          <CheckCircle2 size={21} />
          <div>
            <strong>{delivery ? "Delivered" : "Collected"}</strong>
            <p>
              {new Date(value.completedAt).toLocaleString("en-GB", {
                timeZone: "Europe/London",
              })}{" "}
              · {value.completedRecipient} · Recorded by{" "}
              {saleStaffLabel(value.completedBy)}
            </p>
          </div>
        </div>
      )}
      <fieldset
        disabled={busy || Boolean(value.completedAt)}
        className="sales-dialog-fields"
      >
        <div
          className="sales-fulfilment-choice"
          role="group"
          aria-label="Handover method"
        >
          {(["collection", "delivery"] as const).map((method) => (
            <button
              type="button"
              key={method}
              aria-pressed={value.method === method}
              onClick={() => update("method", method)}
            >
              {method === "delivery" ? (
                <Truck size={19} />
              ) : (
                <CheckCircle2 size={19} />
              )}
              {method === "delivery" ? "Delivery" : "Collection"}
            </button>
          ))}
        </div>
        <label className="sales-confirm-check">
          <input
            type="checkbox"
            checked={value.viewed === "viewed"}
            onChange={(e) =>
              update("viewed", e.target.checked ? "viewed" : "not-yet-viewed")
            }
          />
          <span>
            Customer has viewed the car
            <small>
              A visit or test drive is optional. Customers can arrange delivery
              without viewing.
            </small>
          </span>
        </label>
        <div className="sales-field-grid">
          <label>
            Planned date
            <Input
              type="date"
              value={value.scheduledDate}
              onChange={(e) => update("scheduledDate", e.target.value)}
            />
          </label>
          <label>
            Time window
            <Input
              value={value.timeWindow}
              onChange={(e) => update("timeWindow", e.target.value)}
              placeholder="For example, 10am–12pm"
            />
          </label>
          <label>
            Recipient
            <Input
              value={value.recipient}
              onChange={(e) => update("recipient", e.target.value)}
            />
          </label>
          <label>
            Handover contact
            <Input
              type="tel"
              value={value.phone}
              onChange={(e) => update("phone", e.target.value)}
            />
          </label>
        </div>
        <Button
          variant="outline"
          type="button"
          onClick={() =>
            onChange({
              ...value,
              recipient: draft.customer,
              phone: draft.phone,
            })
          }
        >
          Use customer contact details
        </Button>
        {delivery && (
          <>
            <label>
              Delivery address
              <Textarea
                rows={3}
                value={value.address}
                onChange={(e) => update("address", e.target.value)}
              />
            </label>
            <Button
              variant="outline"
              type="button"
              disabled={!draft.address.trim()}
              onClick={() => update("address", draft.address)}
            >
              Use customer address
            </Button>
          </>
        )}
        <label>
          {delivery ? "Delivery instructions" : "Collection notes"}
          <Textarea
            value={value.instructions}
            onChange={(e) => update("instructions", e.target.value)}
          />
        </label>
        <p className="sales-panel-note">
          Add an agreed delivery charge under Deal details → Fees & discounts.
          It is included once in the sale total.
        </p>
        <div className="sales-handover-checklist">
          {(["preparation", "documents"] as const).map((key) => (
            <label className="sales-handover-check" key={key}>
              <input
                type="checkbox"
                checked={draft[key]}
                onChange={(e) => onReview(key, e.target.checked)}
              />
              {key === "preparation"
                ? "Vehicle preparation reviewed"
                : "Documents reviewed with customer"}
            </label>
          ))}
        </div>
      </fieldset>
      {!value.completedAt && (
        <Button
          className="sales-primary-action mt-6"
          disabled={busy || !saleCompleted}
          onClick={onComplete}
        >
          {!saleCompleted
            ? "Complete the sale before recording handover"
            : delivery
              ? "Mark delivered"
              : "Mark collected"}
        </Button>
      )}
    </div>
  );
}

export function HandoverDialog({
  draft,
  balance,
  busy,
  problem,
  onClose,
  onSave,
  fixedRecipient = false,
}: {
  draft: SaleDraft;
  balance: number;
  busy: boolean;
  problem: string;
  onClose: () => void;
  onSave: (recipient: string, acknowledge: boolean) => void;
  fixedRecipient?: boolean;
}) {
  const [recipient, setRecipient] = useState(
    draft.fulfilment?.recipient || draft.customer,
  );
  const [acknowledge, setAcknowledge] = useState(false);
  const delivery = draft.fulfilment?.method === "delivery";
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="portal-action-dialog sales-action-dialog"
        onEscapeKeyDown={(e) => {
          if (busy) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {delivery ? "Confirm delivery" : "Confirm collection"}
          </DialogTitle>
          <DialogDescription>
            Only confirm after the vehicle has been handed over. The recipient
            and staff member are saved with the handover record.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave(recipient, acknowledge);
          }}
        >
          <fieldset disabled={busy} className="sales-dialog-fields">
            <label>
              Received by
              <Input
                autoFocus
                value={recipient}
                disabled={fixedRecipient}
                onChange={(e) => setRecipient(e.target.value)}
              />
            </label>
            <div className="sales-dialog-balance">
              <span>
                {balance < 0 ? "Customer credit" : "Outstanding balance"}
              </span>
              <strong>{saleMoney(Math.abs(balance))}</strong>
            </div>
            {balance > 0 && (
              <label className="sales-confirm-check sales-balance-warning">
                <input
                  type="checkbox"
                  checked={acknowledge}
                  onChange={(e) => setAcknowledge(e.target.checked)}
                />
                <span>
                  I acknowledge the outstanding balance
                  <small>
                    {saleMoney(balance)} remains due after this handover.
                  </small>
                </span>
              </label>
            )}
            {problem && (
              <p className="sales-action-error" role="alert">
                {problem}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!recipient.trim() || (balance > 0 && !acknowledge)}
                className="sales-primary-action"
              >
                {busy ? "Saving…" : "Confirm handover"}
              </Button>
            </DialogFooter>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}
