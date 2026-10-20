import { SaleWorkspaceError, type SaleWorkspaceDocument } from '@workspace/vehicle-meta';
import { roadTaxGuidePdfBytes } from '@workspace/vehicle-meta/sale-document-pdf';

/** The guide is transient: only the issued invoice is archived. All vehicle,
 * VIN and recipient details come from that invoice's immutable snapshot. */
export function invoiceEmailAttachments(document: SaleWorkspaceDocument, invoiceContent: string, input: {
  reference?: unknown; fileId: string; createdAt: string;
}) {
  const attachments = [{ filename: document.number + '.pdf', content: invoiceContent }];
  if (document.type !== 'invoice' || document.invoiceKind !== 'full' || !document.snapshot.draft.roadTaxGuide) return attachments;
  if (typeof input.reference !== 'string' || !/^\d{12}$/.test(input.reference)) throw new SaleWorkspaceError('Enter the 12-digit green slip reference to email the invoice with its tax guide.');
  const draft = document.snapshot.draft;
  const bytes = roadTaxGuidePdfBytes({ registration: draft.registration, vin: draft.vin ?? '', vehicle: draft.vehicle, reference: input.reference,
    dealerName: document.snapshot.branding.identity.name, fileId: input.fileId, createdAt: input.createdAt });
  attachments.push({ filename: 'road-tax-guide.pdf', content: Buffer.from(bytes).toString('base64') });
  return attachments;
}
