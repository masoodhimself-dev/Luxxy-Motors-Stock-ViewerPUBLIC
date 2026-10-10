import { createHash } from 'node:crypto';
import { jsPDF } from 'jspdf';
import { customerSaleDocument, type SaleWorkspaceDocument } from '@workspace/vehicle-meta';

/** The archive reads only the immutable issued snapshot. No remote assets or current settings. */
export function saleDocumentPdf(input: SaleWorkspaceDocument): Buffer {
  const d = customerSaleDocument(input), { draft, totals: t, branding: b } = d.snapshot;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  pdf.setProperties({ title: `${d.title} ${d.number}`, author: b.identity.name, creator: 'Dealer sales documents' });
  pdf.setCreationDate(new Date(d.issuedAt));
  // Stable PDF document id makes archived/downloaded copies deterministic.
  pdf.setFileId(createHash('sha256').update(d.id).digest('hex').slice(0, 32));
  let y = 18;
  const money = (p: number) => 'GBP ' + (p / 100).toFixed(2);
  const line = (text: string, size = 10, bold = false) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size);
    const rows = pdf.splitTextToSize(String(text ?? '').replace(/[\u0000-\u001f]/g, ' '), 174) as string[];
    for (const row of rows) { if (y > 272) { pdf.addPage(); y = 18; } pdf.text(row, 18, y); y += size > 12 ? 8 : 5.5; }
  };
  line(b.identity.name || b.identity.logoText || 'Vehicle showroom', 20, true);
  line([b.address.street, b.address.city, b.address.region, b.address.postcode].filter(Boolean).join(', '));
  line([b.contact.phone, b.contact.email].filter(Boolean).join(' | ')); y += 5;
  line(d.title, 17, true); line(`${d.number} | Issued ${new Date(d.issuedAt).toLocaleDateString('en-GB', { timeZone: 'Europe/London' })}`); y += 4;
  line(draft.customer, 12, true); if (draft.address) line(draft.address); line([draft.email, draft.phone].filter(Boolean).join(' | ')); y += 4;
  line(draft.vehicle, 12, true); if (draft.registration) line('Registration: ' + draft.registration);
  const v = d.snapshot.vehicle;
  if (v) line([v.year, v.fuel, v.transmission, typeof v.mileage === 'number' ? `${v.mileage.toLocaleString('en-GB')} miles` : ''].filter(Boolean).join(' | ')); y += 5;
  if (d.content && d.type !== 'invoice') { line(d.title, 12, true); for (const paragraph of d.content.split('\n')) line(paragraph); y += 5; }
  if (d.type === 'vehicle-details') for (const [key, value] of Object.entries(v ?? {})) if (key !== 'id' && value != null && value !== '') line(`${key}: ${value}`);
  if (draft.notes && d.type === 'vehicle-details') line(draft.notes);
  line('Sale breakdown', 12, true); line('Vehicle price: ' + money(t.price));
  for (const a of draft.adjustments ?? []) line(`${a.description}: ${money(Number(a.amount) * 100 * (a.kind === 'discount' ? -1 : 1))}`);
  for (const px of draft.exchanges ?? []) line(`Part exchange ${px.registration} ${px.description}: -${money(Number(px.value) * 100)}`);
  line('Total due: ' + money(t.totalDue), 11, true); y += 4;
  line('Payment ledger at issue', 12, true);
  for (const p of d.snapshot.payments) line(`${p.date} | ${p.kind.replaceAll('-', ' ')} | ${p.method} | ${p.status} | ${money(p.signedAmountPence)}`);
  if (!d.snapshot.payments.length) line('No payments recorded at issue.');
  line('Confirmed paid: ' + money(t.confirmedPaid)); line((d.balanceAtIssue < 0 ? 'Customer credit at issue: ' : 'Balance at issue: ') + money(Math.abs(d.balanceAtIssue)), 13, true);
  if (typeof d.paymentAmountPence === 'number') line('This receipt: ' + money(d.paymentAmountPence), 12, true);
  const f = draft.fulfilment;
  if (f) { y += 5; line(f.method === 'delivery' ? 'Delivery arrangements' : 'Collection arrangements', 12, true); line([f.scheduledDate, f.timeWindow].filter(Boolean).join(' | ')); if (f.address) line(f.address); if (f.completedAt) line(`Completed ${f.completedAt.slice(0, 10)} | ${f.completedRecipient ?? ''}`); }
  if (['terms', 'reservation'].includes(d.type)) { y += 8; line('Customer signature: ____________________  Date: __________'); line('Dealer signature: ____________________  Date: __________'); }
  if (d.type === 'invoice' && d.content) { y += 5; line('Terms of sale', 12, true); for (const paragraph of d.content.split('\n')) line(paragraph, 9); }
  y += 5; line([b.legal.companyName, b.legal.companyNumber ? `Company ${b.legal.companyNumber}` : '', b.legal.vatNumber ? `VAT ${b.legal.vatNumber}` : ''].filter(Boolean).join(' | '), 9);
  return Buffer.from(pdf.output('arraybuffer'));
}
export function archiveSaleDocument(document: SaleWorkspaceDocument) {
  const bytes = saleDocumentPdf(document);
  return { content: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') };
}
