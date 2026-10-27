import {
  saleWorkspaceFingerprint,
  type SaleWorkspaceDocument,
  type SaleWorkspaceDraft,
  type SaleWorkspacePayment,
} from '@workspace/vehicle-meta';

type InvoiceDraft = Omit<SaleWorkspaceDraft, 'payments'>;

function invoiceDraft(draft: InvoiceDraft) {
  const { handover: _handover, fulfilment, ...details } = draft;
  if (!fulfilment) return details;
  // Recording receipt of the car creates separate handover evidence. It does
  // not invalidate the invoice that already records the agreed sale and money.
  const { completedAt: _at, completedBy: _by, completedRecipient: _recipient, ...arrangements } = fulfilment;
  return { ...details, fulfilment: arrangements };
}

export function saleInvoiceIsCurrent(
  document: SaleWorkspaceDocument,
  draft: InvoiceDraft,
  payments: SaleWorkspacePayment[],
) {
  return saleWorkspaceFingerprint({ draft: invoiceDraft(document.snapshot.draft), payments: document.snapshot.payments }) ===
    saleWorkspaceFingerprint({ draft: invoiceDraft(draft), payments });
}
