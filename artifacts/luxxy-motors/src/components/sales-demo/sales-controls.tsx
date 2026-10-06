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
import { FileText, WalletCards, Truck, CheckCircle2 } from "lucide-react";
import { pence, saleStaffLabel, type SaleDraft } from "./model";
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
  const paid = (draft.payments ?? [])
    .filter((p) => p.status === "confirmed")
    .reduce((sum, p) => sum + (p.signedAmountPence ?? 0), 0);
  const price =
    pence(draft.price) +
    (draft.adjustments ?? []).reduce(
      (sum, a) => sum + pence(a.amount) * (a.kind === "fee" ? 1 : -1),
      0,
    ) -
    (draft.exchanges ?? []).reduce((sum, e) => sum + pence(e.value), 0);
  return paid > 0 && paid === price
    ? "Paid in full"
    : paid > 0
      ? "Part paid"
      : "Awaiting payment";
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
  initialKind?: 'deposit' | 'part-payment' | 'final-payment';
}) {
  const [form, setForm] = useState<SaleWorkspacePaymentInput>({
    amount: pending?.amount ?? (initialKind === 'final-payment' ? (balance / 100).toFixed(2) : ''),
    method: pending?.method ?? "Bank transfer",
    date: pending ? todayLondon() : todayLondon(),
    reference: pending?.reference ?? "",
    kind: initialKind ?? (
      pending?.kind === "deposit"
        ? "deposit"
        : hasPayments
          ? "part-payment"
          : "deposit"),
    status: pending ? 'pending' : 'confirmed',
  });
  const confirmed = form.status === "confirmed";
  const valid =
    pence(form.amount) > 0 &&
    pence(form.amount) <= balance &&
    Boolean(form.date) &&
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
              <span>{balance < 0 ? "Customer credit" : "Outstanding balance"}</span>
              <strong>{saleMoney(Math.abs(balance))}</strong>
            </div>
            <label>
              Payment amount (£)
              <Input
                autoFocus
                inputMode="decimal"
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
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              </label>
            </div>
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
                      kind: e.target.value as SaleWorkspacePaymentInput["kind"],
                    })
                  }
                >
                  <option value="deposit">Deposit</option>
                  <option value="part-payment">Part payment</option>
                  <option value="final-payment">Final payment</option>
                </select>
              </label>
            )}
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
            {pence(form.amount) > balance && (
              <p role="alert">The payment exceeds the outstanding balance.</p>
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
                disabled={!valid}
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
  availablePence,
  busy,
  problem,
  onClose,
  onSave,
}: {
  payment: SaleWorkspacePayment;
  availablePence: number;
  busy: boolean;
  problem: string;
  onClose: () => void;
  onSave: (input: {
    reason: string;
    date: string;
    amount: string;
    kind: "refund" | "reversal";
  }) => void;
}) {
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState((availablePence / 100).toFixed(2));
  const [kind, setKind] = useState<"refund" | "reversal">("refund");
  const pending = payment.status === "pending";
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
              : "Keep the original receipt and add a separate adjustment to the payment history. This records a refund or correction; it does not send money."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSave({ reason, date: todayLondon(), amount, kind });
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
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
                <p className="sales-panel-note">
                  Available to refund or correct: {saleMoney(availablePence)}
                </p>
              </>
            )}
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
                disabled={
                  !reason.trim() ||
                  (!pending &&
                    !(pence(amount) > 0 && pence(amount) <= availablePence))
                }
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
}: {
  entries: SaleWorkspacePayment[];
  documents: SaleWorkspaceDocument[];
  busy: boolean;
  onRecord: () => void;
  onDocument: (id: string) => void;
  onConfirm: (payment: SaleWorkspacePayment) => void;
  onReverse: (payment: SaleWorkspacePayment) => void;
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
          disabled={busy}
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
                      <FileText size={15} />
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
          Add an agreed delivery charge under Payments → Fees and
          discounts. It is included once in the sale total.
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
          {!saleCompleted ? "Complete the sale before recording handover" : delivery ? "Mark delivered" : "Mark collected"}
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
}: {
  draft: SaleDraft;
  balance: number;
  busy: boolean;
  problem: string;
  onClose: () => void;
  onSave: (recipient: string, acknowledge: boolean) => void;
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
                onChange={(e) => setRecipient(e.target.value)}
              />
            </label>
            <div className="sales-dialog-balance">
              <span>{balance < 0 ? "Customer credit" : "Outstanding balance"}</span>
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
