import { createHash } from 'node:crypto';
import { saleDocumentPdfBytes } from '@workspace/vehicle-meta/sale-document-pdf';
import type { SaleWorkspaceDocument } from '@workspace/vehicle-meta';

/** New archives use the same renderer as the draft preview. Existing stored archives stay intact. */
export function saleDocumentPdf(document: SaleWorkspaceDocument): Buffer {
  return Buffer.from(saleDocumentPdfBytes(document, {
    fileId: createHash('sha256').update(document.id).digest('hex').slice(0, 32),
  }));
}

export function archiveSaleDocument(document: SaleWorkspaceDocument) {
  const bytes = saleDocumentPdf(document);
  return { content: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') };
}
