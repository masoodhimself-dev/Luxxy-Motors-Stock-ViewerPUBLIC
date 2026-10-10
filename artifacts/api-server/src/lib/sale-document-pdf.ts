import { createHash } from 'node:crypto';
import { jsPDF } from 'jspdf';
import { customerSaleDocument, invoicePalette, type SaleWorkspaceDocument } from '@workspace/vehicle-meta';

/** The archive reads only the immutable issued snapshot. No remote assets or current settings. */
export function saleDocumentPdf(input: SaleWorkspaceDocument): Buffer {
  const d = customerSaleDocument(input), { draft, totals: t, branding: b } = d.snapshot;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  pdf.setProperties({ title: `${d.title} ${d.number}`, author: b.identity.name, creator: 'Dealer sales documents' });
  pdf.setCreationDate(new Date(d.issuedAt));
  // Stable PDF document id makes archived/downloaded copies deterministic.
  pdf.setFileId(createHash('sha256').update(d.id).digest('hex').slice(0, 32));
  const palette = invoicePalette(b.presentation?.linkColour);
  const design = b.invoiceSettings;
  const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const accent = rgb(palette.strong);
  const tint = rgb(palette.tint);
  const ink = rgb(palette.ink);
  const colour = (rgb: number[]) => pdf.setTextColor(rgb[0], rgb[1], rgb[2]);
  let y = 18;
  const pageHeading = (continued = false) => {
    pdf.setFillColor(accent[0], accent[1], accent[2]); pdf.rect(0, 0, 210, design?.inkSaving || design?.style === 'classic' ? 1 : design?.style === 'premium' ? 8 : 5, 'F');
    if (continued) {
      pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); colour(ink);
      pdf.text(b.identity.name || b.identity.logoText || 'Vehicle showroom', 18, 16);
      pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9);
      pdf.text(`${d.number} | Continued`, 192, 16, { align: 'right' }); y = 27;
    }
  };
  pageHeading();
  const ensure = (height = 6) => { if (y + height > 267) { pdf.addPage(); pageHeading(true); } };
  const section = (title: string) => {
    ensure(17); y += 3;
    if (!design?.inkSaving) { pdf.setFillColor(tint[0], tint[1], tint[2]); pdf.roundedRect(18, y - 4, 174, 9, 1, 1, 'F'); }
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10); colour(accent); pdf.text(title.toUpperCase(), 21, y + 2); y += 12;
  };
  const amountRow = (label: string, value: number, highlight = false) => {
    pdf.setFont('helvetica', highlight ? 'bold' : 'normal'); pdf.setFontSize(highlight ? 12 : 10);
    const rows = pdf.splitTextToSize(label, 123) as string[];
    const height = Math.max(9, rows.length * 5 + 3); ensure(height + 2); pdf.setFont('helvetica', highlight ? 'bold' : 'normal'); pdf.setFontSize(highlight ? 12 : 10);
    if (highlight && !design?.inkSaving) { const fill = label === 'Balance remaining at issue' && value === 0 ? [35, 87, 71] : accent; pdf.setFillColor(fill[0], fill[1], fill[2]); pdf.roundedRect(18, y - 4, 174, height, 1, 1, 'F'); pdf.setTextColor(255, 255, 255); } else colour(ink);
    pdf.text(rows, 21, y + 1); pdf.text(money(value), 189, y + 1, { align: 'right' }); y += height + 2; colour(ink);
  };
  const money = (p: number) => 'GBP ' + (p / 100).toFixed(2);
  const line = (text: string, size = 10, bold = false) => {
    pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size);
    const rows = pdf.splitTextToSize(String(text ?? '').replace(/[\u0000-\u001f]/g, ' '), 174) as string[];
    for (const row of rows) { ensure(size > 12 ? 8 : 5.5); pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size); colour(ink); pdf.text(row, 18, y); y += size > 12 ? 8 : 5.5; }
  };
  line(b.identity.name || b.identity.logoText || 'Vehicle showroom', 20, true);
  line([b.address.street, b.address.city, b.address.region, b.address.postcode].filter(Boolean).join(', '));
  line([b.contact.phone, b.contact.email].filter(Boolean).join(' | ')); y += 5;
  line(d.title, 17, true); line(`${d.number} | Issued ${new Date(d.issuedAt).toLocaleDateString('en-GB', { timeZone: 'Europe/London' })}`); y += 4;
  section('Customer'); line(draft.customer, 12, true); if (draft.address) line(draft.address); line([draft.email, draft.phone].filter(Boolean).join(' | ')); y += 4;
  section('Vehicle'); line(draft.vehicle, 12, true); if (draft.registration) line('Registration: ' + draft.registration);
  const v = d.snapshot.vehicle;
  if (v) line([v.year, v.fuel, v.transmission, typeof v.mileage === 'number' ? `${v.mileage.toLocaleString('en-GB')} miles` : ''].filter(Boolean).join(' | ')); y += 5;
  if (d.content) { line(d.title, 12, true); for (const paragraph of d.content.split('\n')) line(paragraph); y += 5; }
  if (d.type === 'vehicle-details') for (const [key, value] of Object.entries(v ?? {})) if (key !== 'id' && value != null && value !== '') line(`${key}: ${value}`);
  if (draft.notes) { section('Agreed notes'); for (const paragraph of draft.notes.split('\n')) line(paragraph); }
  section('Sale breakdown'); amountRow('Vehicle price', t.price);
  for (const a of draft.adjustments ?? []) amountRow(a.description, Math.round(Number(a.amount) * 100) * (a.kind === 'discount' ? -1 : 1));
  for (const px of draft.exchanges ?? []) amountRow(`Part exchange ${px.registration} ${px.description}`, -Math.round(Number(px.value) * 100));
  amountRow('Total due after allowances', t.totalDue, true); y += 4;
  section('Payments at issue');
  for (const p of d.snapshot.payments) line(`${p.date} | ${p.kind.replaceAll('-', ' ')} | ${p.method} | ${p.status} | ${money(p.signedAmountPence)}`);
  if (!d.snapshot.payments.length) line('No payments recorded at issue.');
  amountRow('Confirmed payments received', t.confirmedPaid); amountRow(d.balanceAtIssue < 0 ? 'Customer credit at issue' : 'Balance remaining at issue', Math.abs(d.balanceAtIssue), true);
  if (typeof d.paymentAmountPence === 'number') amountRow('This receipt', d.paymentAmountPence, true);
  const f = draft.fulfilment;
  if (f && (f.scheduledDate || f.timeWindow || f.address || f.completedAt)) { y += 5; line(f.method === 'delivery' ? 'Delivery arrangements' : 'Collection arrangements', 12, true); line([f.scheduledDate, f.timeWindow].filter(Boolean).join(' | ')); if (f.address) line(f.address); if (f.completedAt) line(`Completed ${f.completedAt.slice(0, 10)} | ${f.completedRecipient ?? ''}`); }
  if (['terms', 'reservation'].includes(d.type)) { y += 8; line('Customer signature: ____________________  Date: __________'); line('Dealer signature: ____________________  Date: __________'); }
  if (design?.paymentInstructions) { section('Payment instructions'); for (const paragraph of design.paymentInstructions.split('\n')) line(paragraph); }
  if (design?.footer) { y += 4; for (const paragraph of design.footer.split('\n')) line(paragraph, 9); }
  y += 5; line([b.legal.companyName, b.legal.companyNumber ? `Company ${b.legal.companyNumber}` : '', b.legal.vatNumber ? `VAT ${b.legal.vatNumber}` : ''].filter(Boolean).join(' | '), 9);
  const pageCount = pdf.getNumberOfPages();
  for (let page = 1; page <= pageCount; page++) {
    pdf.setPage(page); pdf.setDrawColor(220, 227, 232); pdf.line(18, 276, 192, 276);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(88, 105, 118);
    pdf.text(`${d.number} | ${draft.id}`, 18, 282);
    pdf.text(`Page ${page} of ${pageCount}`, 192, 282, { align: 'right' });
    pdf.text('Saved document at issue. Separate receipts record payments received.', 18, 287);
  }
  return Buffer.from(pdf.output('arraybuffer'));
}
export function archiveSaleDocument(document: SaleWorkspaceDocument) {
  const bytes = saleDocumentPdf(document);
  return { content: bytes.toString('base64'), sha256: createHash('sha256').update(bytes).digest('hex') };
}
