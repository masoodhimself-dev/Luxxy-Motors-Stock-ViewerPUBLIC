import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { SaleWorkspaceError, type SaleWorkspaceDocument, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';

export function attachInvoiceVerification(document: SaleWorkspaceDocument, saleId: string, origin: string) {
  const base = new URL(origin);
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new SaleWorkspaceError('Configure this dealership’s website origin before issuing a verified invoice.');
  const token = randomBytes(32).toString('hex');
  document.verification = {
    url: `${base.origin}/verify-invoice/${saleId}/${document.id}/${token}`,
    tokenHash: createHash('sha256').update(token).digest('hex'),
  };
}

/** Minimal, explicit proof. This does not return the customer, PDF or the staff sale record. */
export function invoiceVerificationView(record: SaleWorkspaceRecord | undefined, documentId: string, token: string) {
  const unavailable = () => new SaleWorkspaceError('This invoice could not be verified. Check the QR code or contact the dealership.', 404);
  if (!/^[a-f0-9]{64}$/.test(token)) throw unavailable();
  const doc = record?.documents.find(d => d.id === documentId && d.type === 'invoice');
  const stored = doc?.verification?.tokenHash;
  if (!doc || !stored || !/^[a-f0-9]{64}$/.test(stored)) throw unavailable();
  const expected = Buffer.from(stored, 'hex');
  const actual = createHash('sha256').update(token).digest();
  if (!timingSafeEqual(expected, actual)) throw unavailable();
  const sameKind = record!.documents.filter(d => d.type === 'invoice' && d.invoiceKind === doc.invoiceKind);
  const latest = sameKind.at(-1);
  return {
    verified: true as const, number: doc.number, title: doc.title, issuedAt: doc.issuedAt,
    dealer: doc.snapshot.branding.identity.name, vehicle: doc.snapshot.draft.vehicle,
    registration: doc.snapshot.draft.registration,
    saleTotalPence: doc.snapshot.totals.totalDue, paymentsReceivedPence: doc.snapshot.totals.confirmedPaid,
    balanceAtIssuePence: doc.balanceAtIssue, paymentCount: doc.snapshot.payments.filter(p => p.status === 'confirmed').length,
    supersededBy: latest && latest.id !== doc.id ? latest.number : null,
  };
}
