import type { SaleWorkspaceRecord, SaleWorkspaceDocument } from '@workspace/vehicle-meta';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Link2, Mail, Download, ShieldCheck, CarFront } from 'lucide-react';
import { HistoryLinks } from '@/components/portal/history-links';

export function SalesConnections({ record, busy, customerUrl, onLink, onRevoke, onEmailLink, onLifecycle }: {
  record: SaleWorkspaceRecord | null; busy: boolean; customerUrl: string; onLink: () => void; onRevoke: () => void; onEmailLink: () => void; onLifecycle: (status: 'reserved' | 'sold' | 'released') => void;
}) {
  const access = record?.customerAccess;
  const status = record?.lifecycle?.status ?? 'draft';
  const active = Boolean(access && !access.revokedAt && Date.parse(access.expiresAt) > Date.now());
  return <div className="sales-connected-panels">
    {record && <section className="sales-form-panel"><div className="sales-panel-heading"><h2>Related records</h2><p>See this buyer’s other enquiries and purchases, or everyone interested in this vehicle.</p></div><HistoryLinks vehicleId={record.draft.vehicleId} recordType="sale" recordId={record.id} vehicle={Boolean(record.draft.vehicleId || record.draft.vehicle)} /></section>}
    <section className="sales-form-panel"><div className="sales-panel-heading"><h2><CarFront size={18} /> Vehicle availability</h2><p>Taking a deposit reserves this car. Complete sale issues the invoice and removes it from public stock. Release a reservation only after recording its refund.</p></div>
      <p className="sales-connection-status">Sale stock status: <strong>{status === 'draft' ? 'Not reserved by this sale' : status}</strong></p>
      <div className="sales-document-issue-actions"><Button variant="outline" disabled={busy || status === 'reserved' || status === 'sold'} onClick={() => onLifecycle('reserved')}>Reserve for this customer</Button>{status === 'reserved' && <Button variant="outline" disabled={busy} onClick={() => onLifecycle('released')}>Release reservation</Button>}</div>
    </section>
    <section className="sales-form-panel"><div className="sales-panel-heading"><h2><ShieldCheck size={18} /> Private customer page</h2><p>One secure link to their vehicle, payments, balance, appointment, collection or delivery and issued documents. Links last 30 days.</p></div>
      <p className="sales-connection-status">{active ? `Access available until ${new Date(access!.expiresAt).toLocaleDateString('en-GB')}.` : 'No active customer link.'}</p>
      <div className="sales-document-issue-actions"><Button variant="outline" disabled={busy} onClick={onLink}><Link2 size={16} />{active ? 'Replace customer link' : 'Create customer link'}</Button>{active && <Button variant="outline" disabled={busy} onClick={onRevoke}>Revoke access</Button>}</div>
      {customerUrl && active && <div className="sales-customer-link"><label>Customer link<Input value={customerUrl} readOnly onFocus={e => e.target.select()} /></label><Button variant="outline" onClick={() => void navigator.clipboard?.writeText(customerUrl)}>Copy link</Button><a href={customerUrl} target="_blank" rel="noreferrer">Open customer page</a><Button variant="outline" disabled={busy || !record?.draft.email} onClick={onEmailLink}><Mail size={16} />{record?.customerLinkEmail?.status === "sent" ? "Resend customer link email" : "Prepare / send customer link"}</Button></div>}
      {record?.customerLinkEmail && <p className="sales-panel-note" role="status">{record.customerLinkEmail.status === "sent" ? "Customer link email sent." : record.customerLinkEmail.status === "prepared" ? "Customer link email prepared · enable Resend in API settings to send." : record.customerLinkEmail.status === "sending" ? "Customer link delivery awaiting provider confirmation." : record.customerLinkEmail.error || "Customer link email failed."}</p>}
      {active && !customerUrl && <p className="sales-panel-note">For privacy, the full link is shown only when created. Create a replacement to share it again.</p>}
    </section>
  </div>;
}

export function DocumentDelivery({ record, document, busy, onEmail, onDownload }: { record: SaleWorkspaceRecord | null; document?: SaleWorkspaceDocument; busy: boolean; onEmail: () => void; onDownload: () => void }) {
  if (!document) return <p className="sales-panel-note">Issue a document to download its archived PDF or prepare its email.</p>;
  const delivery = [...(record?.emailDeliveries ?? [])].reverse().find(row => row.documentId === document.id);
  return <section className="sales-document-delivery"><h3>Document delivery</h3><p>The saved PDF uses this issued document’s details.</p><div className="sales-document-issue-actions"><Button variant="outline" disabled={busy} onClick={onDownload}><Download size={16} />Download saved PDF</Button><Button variant="outline" disabled={busy || !document.snapshot.draft.email} onClick={onEmail}><Mail size={16} />{delivery?.status === 'sent' ? 'Resend document email' : 'Prepare / send email'}</Button></div>
    {document.snapshot.draft.email ? <p className="sales-panel-note">To: {document.snapshot.draft.email}</p> : <p className="sales-panel-note">Add the customer email and issue an updated document before emailing.</p>}
    {delivery && <p className="sales-panel-note" role="status">{delivery.status === 'sent' ? `Sent ${new Date(delivery.sentAt!).toLocaleString('en-GB')}` : delivery.status === 'sending' ? 'Delivery awaiting provider confirmation.' : delivery.status === 'prepared' ? 'Prepared · add and enable Resend in API settings to send.' : delivery.error || 'Delivery failed. You can retry.'}</p>}
  </section>;
}
