import type { SaleWorkspaceDocument } from '@workspace/vehicle-meta';

/** Only the immutable, already-issued PDF is attached. */
export function invoiceEmailAttachments(document: SaleWorkspaceDocument, invoiceContent: string) {
  return [{filename: document.number + '.pdf', content: invoiceContent}];
}
