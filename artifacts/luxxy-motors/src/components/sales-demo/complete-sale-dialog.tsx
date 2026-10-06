import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { SaleDraft } from "./model";
import { saleMoney } from "./sales-controls";
export function CompleteSaleDialog({
  draft,
  total,
  balance,
  terms,
  busy,
  problem,
  onClose,
  onComplete,
}: {
  draft: SaleDraft;
  total: number;
  balance: number;
  terms: string;
  busy: boolean;
  problem: string;
  onClose: () => void;
  onComplete: () => void;
}) {
  const [acknowledge, setAcknowledge] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="portal-action-dialog sales-action-dialog">
        <DialogHeader>
          <DialogTitle>Complete sale</DialogTitle>
          <DialogDescription>
            Issue the invoice and document pack, mark the car sold and remove it
            from public stock. Collection or delivery can be recorded
            afterwards.
          </DialogDescription>
        </DialogHeader>
        <dl className="sales-completion-summary">
          <dt>Customer</dt>
          <dd>{draft.customer}</dd>
          <dt>Vehicle</dt>
          <dd>
            {draft.vehicle}
            {draft.registration && ` · ${draft.registration}`}
          </dd>
          <dt>Total due</dt>
          <dd>{saleMoney(total)}</dd>
          <dt>Outstanding</dt>
          <dd>{saleMoney(balance)}</dd>
          <dt>Handover</dt>
          <dd>
            {draft.fulfilment?.method === "delivery"
              ? `Delivery · ${draft.fulfilment.address || "Address required"}`
              : "Showroom collection"}
          </dd>
        </dl>
        {terms ? (
          <details>
            <summary>Review terms included in the pack</summary>
            <p className="whitespace-pre-wrap max-h-48 overflow-auto text-sm">
              {terms}
            </p>
          </details>
        ) : (
          <p role="alert">
            Add your approved terms in Settings → API integrations → Sales
            paperwork.
          </p>
        )}
        {balance !== 0 && (
          <p role="alert">
            Record the remaining payment or resolve any customer credit first.
          </p>
        )}
        <label className="sales-confirm-check">
          <input
            type="checkbox"
            checked={acknowledge}
            onChange={(e) => setAcknowledge(e.target.checked)}
          />
          I have reviewed the customer, vehicle, received payments and terms.
        </label>
        {problem && (
          <p role="alert" className="sales-action-error">
            {problem}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            Back
          </Button>
          <Button
            disabled={busy || !acknowledge || !terms || balance !== 0}
            onClick={onComplete}
          >
            {busy ? "Completing…" : "Complete sale & issue pack"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
