import {
  saleInvoiceMatchesSale,
  type SaleWorkspaceDocument,
  type SaleWorkspaceDraft,
  type SaleWorkspacePayment,
} from '@workspace/vehicle-meta';

export function saleInvoiceIsCurrent(
  document: SaleWorkspaceDocument,
  draft: SaleWorkspaceDraft,
  payments: SaleWorkspacePayment[],
  documents?: readonly SaleWorkspaceDocument[],
) {
  return saleInvoiceMatchesSale(document, draft, payments, documents);
}
