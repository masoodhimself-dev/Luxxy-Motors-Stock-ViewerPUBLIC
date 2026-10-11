import { jsPDF } from 'jspdf';
import { customerSaleDocument } from './customer-sale.ts';
import { invoicePalette } from './invoice-palette.ts';
import { saleWorkspacePence, type SaleWorkspaceDocument } from './sale-workspace.ts';

/** One renderer for draft previews, newly issued archives, downloads and email attachments.
 * It reads only the supplied snapshot and never requests a logo or another remote asset.
 */
export function saleDocumentPdfBytes(input: SaleWorkspaceDocument, options: { fileId?: string; draft?: boolean } = {}): Uint8Array {
  const document = customerSaleDocument(input);
  const { draft, branding, vehicle, totals } = document.snapshot;
  const design = branding.invoiceSettings;
  const palette = invoicePalette(branding.presentation?.linkColour);
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: false });
  const left = 18, right = 192, width = right - left, bottom = 265;
  const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const accent = rgb(palette.strong), ink = rgb(palette.ink), tint = rgb(palette.tint);
  const muted = [91, 105, 115], rule = [222, 228, 233];
  const clean = (value: unknown) => String(value ?? '').replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').replace(/[\u2010-\u2015]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"');
  const supplied = (value: unknown) => {
    const text = clean(value).trim();
    return /^(unknown|n\/a|not supplied|not provided|your dealership|your address|enter .+|\[.+\])$/i.test(text) ? '' : text;
  };
  const money = (value: number) => Number.isSafeInteger(value) ? new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value / 100) : 'Check amount';
  const date = (value: string) => {
    const parsed = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
    return Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric' }) : supplied(value);
  };
  const colour = (value: number[]) => pdf.setTextColor(value[0], value[1], value[2]);
  const font = (size = 10, bold = false, value = ink) => { pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size); colour(value); };
  const split = (text: unknown, maxWidth = width, size = 10, bold = false) => { font(size, bold); return pdf.splitTextToSize(clean(text), maxWidth) as string[]; };
  const fittedAmount = (amount: number, x: number, at: number, maxWidth: number, size = 13, align: 'left' | 'right' = 'left', value = ink) => {
    const text = money(amount); font(size, true, value);
    const measured = pdf.getTextWidth(text);
    if (measured > maxWidth) font(Math.max(8, size * maxWidth / measured), true, value);
    pdf.text(text, x, at, { align });
  };
  const dealerName = supplied(branding.identity.name) || supplied(branding.identity.logoText);
  let y = 0;
  pdf.setProperties({ title: `${document.title} ${document.number}`, author: dealerName, creator: 'Dealer sales documents' });
  pdf.setCreationDate(new Date(document.issuedAt));
  if (options.fileId) pdf.setFileId(options.fileId);
  else {
    // A portable deterministic id also keeps client-generated draft bytes stable.
    let hash = 2166136261;
    for (const character of document.id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    pdf.setFileId((hash >>> 0).toString(16).padStart(8, '0').repeat(4));
  }

  function heading(continued = false) {
    pdf.setFillColor(accent[0], accent[1], accent[2]);
    pdf.rect(left, 11, width, design?.inkSaving || design?.style === 'classic' ? 0.7 : 1.8, 'F');
    if (continued) {
      font(10, true); pdf.text(dealerName, left, 22);
      font(9, false, muted); pdf.text(`${document.number}  |  ${document.title}`, right, 22, { align: 'right' });
      y = 33; return;
    }
    let dealerY = 26;
    // Only snapshot-embedded raster logos can be immutable. URL logos use the wordmark.
    const logo = design?.showLogo !== false ? branding.identity.logoAsset : '';
    if (/^data:image\/(?:png|jpe?g);base64,[A-Za-z0-9+/=]+$/.test(logo) && logo.length < 1_500_000) {
      try {
        const properties = pdf.getImageProperties(logo);
        const maxWidth = design?.logoSize === 'small' ? 28 : design?.logoSize === 'large' ? 48 : 38;
        const imageHeight = Math.min(14, maxWidth * properties.height / properties.width);
        const imageWidth = imageHeight * properties.width / properties.height;
        pdf.addImage(logo, properties.fileType, left, 19, imageWidth, imageHeight);
        dealerY = 39;
      } catch { /* Invalid embedded logo falls back to the saved dealer name. */ }
    }
    font(17, true); const names = split(dealerName, 88, 17, true);
    pdf.text(names, left, dealerY); dealerY += names.length * 6 + 1;
    const dealerAddress = [branding.address.street, branding.address.city, branding.address.region, branding.address.postcode].map(supplied).filter(Boolean).join(', ');
    font(8.5, false, muted);
    const addressRows = split(dealerAddress, 88, 8.5);
    if (dealerAddress) { pdf.text(addressRows, left, dealerY); dealerY += addressRows.length * 4; }
    const contacts = [supplied(branding.contact.phone), supplied(branding.contact.email)].filter(Boolean);
    for (const contact of contacts) { font(8.5, false, muted); const rows = split(contact, 88, 8.5); pdf.text(rows, left, dealerY); dealerY += rows.length * 4; }
    font(22, true, accent);
    const titleRows = split(document.title, 78, 22, true);
    pdf.text(titleRows, right, 26, { align: 'right' });
    let titleY = 26 + titleRows.length * 8;
    font(9, true); pdf.text(document.number, right, titleY, { align: 'right' }); titleY += 5;
    font(9, false, muted); pdf.text(date(document.issuedAt), right, titleY, { align: 'right' });
    if (options.draft) { titleY += 5; font(8, true, muted); pdf.text('DRAFT - not issued', right, titleY, { align: 'right' }); }
    y = Math.max(dealerY, titleY) + 10;
    pdf.setDrawColor(rule[0], rule[1], rule[2]); pdf.line(left, y - 5, right, y - 5);
  }
  const ensure = (height = 6) => { if (y + height > bottom) { pdf.addPage(); heading(true); } };
  const line = (text: unknown, size = 10, bold = false, value = ink) => {
    if (!supplied(text)) return;
    const rows = split(text, width, size, bold);
    for (const row of rows) {
      ensure(size * 0.43 + 1); font(size, bold, value); pdf.text(row, left, y); y += size * 0.43 + 1;
    }
  };
  const paragraph = (text: string, size = 9.5) => {
    for (const block of text.split('\n')) { if (block.trim()) line(block, size); else { ensure(3); y += 3; } }
  };
  const section = (title: string) => {
    ensure(15); y += 3; font(9, true, accent); pdf.text(title.toUpperCase(), left, y); y += 3;
    pdf.setDrawColor(rule[0], rule[1], rule[2]); pdf.line(left, y, right, y); y += 7;
  };
  const pair = (label: string, value: string, column = left, columnWidth = width) => {
    const rows = split(value, columnWidth - 31, 9);
    font(8.5, false, muted); pdf.text(label, column, y);
    font(9); pdf.text(rows, column + 31, y); y += Math.max(5.5, rows.length * 4.2);
  };
  const parties = () => {
    const customerRows = [supplied(draft.customer), supplied(draft.address), ...[draft.email, draft.phone].map(supplied).filter(Boolean)].filter(Boolean);
    const vehicleRows = [supplied(draft.vehicle), draft.registration ? `Registration  ${draft.registration}` : '', [vehicle?.year, supplied(vehicle?.colour), supplied(vehicle?.fuel), supplied(vehicle?.transmission)].filter(Boolean).join('  |  '), typeof vehicle?.mileage === 'number' && Number.isFinite(vehicle.mileage) ? `${vehicle.mileage.toLocaleString('en-GB')} miles` : ''].filter(Boolean);
    const block = (label: string, rows: string[], x: number) => {
      let blockY = y;
      font(8.5, true, accent); pdf.text(label, x, blockY); blockY += 6;
      rows.forEach((row, index) => { const textRows = split(row, 82, index === 0 ? 11 : 9, index === 0); font(index === 0 ? 11 : 9, index === 0, index === 0 ? ink : muted); pdf.text(textRows, x, blockY); blockY += textRows.length * (index === 0 ? 5 : 4.4) + 1; });
      return blockY;
    };
    // Very long addresses use flowing rows rather than a fixed-height two-column panel.
    const heightOf = (rows: string[]) => rows.reduce((sum, row, index) => sum + split(row, 82, index === 0 ? 11 : 9, index === 0).length * (index === 0 ? 5 : 4.4) + 1, 6);
    if (Math.max(heightOf(customerRows), heightOf(vehicleRows)) > 65) {
      section('Customer'); customerRows.forEach((row, i) => line(row, i === 0 ? 11 : 9, i === 0));
      section('Vehicle'); vehicleRows.forEach((row, i) => line(row, i === 0 ? 11 : 9, i === 0)); y += 4;
    } else {
      ensure(Math.max(heightOf(customerRows), heightOf(vehicleRows)) + 6);
      const end = Math.max(block('CUSTOMER', customerRows, left), block('VEHICLE', vehicleRows, 110)); y = end + 8;
    }
  };
  const amountRow = (label: string, amount: number, bold = false) => {
    const rows = split(label, 132, 10, bold), height = Math.max(8, rows.length * 4.6 + 3);
    ensure(height + 1); font(10, bold); pdf.text(rows, left + 2, y);
    fittedAmount(amount, right - 2, y, 36, 10, 'right');
    y += height; pdf.setDrawColor(rule[0], rule[1], rule[2]); pdf.line(left, y - 3, right, y - 3);
  };
  const balance = () => {
    ensure(31); y += 2;
    if (!design?.inkSaving) { pdf.setFillColor(tint[0], tint[1], tint[2]); pdf.roundedRect(left, y - 3, width, 24, 2, 2, 'F'); }
    font(8.5, false, muted); pdf.text('TOTAL DUE', left + 6, y + 3); pdf.text('PAYMENTS RECEIVED', 85, y + 3);
    pdf.text(document.balanceAtIssue < 0 ? 'CUSTOMER CREDIT' : 'BALANCE REMAINING', right - 6, y + 3, { align: 'right' });
    fittedAmount(totals.totalDue, left + 6, y + 12, 54);
    fittedAmount(totals.confirmedPaid, 85, y + 12, 42);
    fittedAmount(Math.abs(document.balanceAtIssue), right - 6, y + 12, 54, 17, 'right', accent); y += 29;
  };
  const arrangements = () => {
    const fulfilment = draft.fulfilment;
    if (!fulfilment || ![fulfilment.address, fulfilment.scheduledDate, fulfilment.timeWindow, fulfilment.completedAt].some(Boolean)) return;
    section(fulfilment.method === 'delivery' ? 'Delivery arrangements' : 'Collection arrangements');
    const dateAndTime = [fulfilment.scheduledDate ? date(fulfilment.scheduledDate) : '', supplied(fulfilment.timeWindow)].filter(Boolean).join('  |  ');
    if (dateAndTime) line(dateAndTime, 9);
    if (fulfilment.method === 'delivery' && fulfilment.address) paragraph(fulfilment.address, 9);
    if (fulfilment.recipient) line(`Recipient: ${fulfilment.recipient}`, 9);
    if (fulfilment.completedAt) line(`Completed ${date(fulfilment.completedAt)}${fulfilment.completedRecipient ? ` - ${fulfilment.completedRecipient}` : ''}`, 9);
  };
  heading(); parties();

  if (document.type === 'receipt') {
    const payment = document.snapshot.payments.find(item => item.id === document.paymentId);
    const received = document.paymentAmountPence ?? payment?.signedAmountPence;
    if (typeof received === 'number') {
      ensure(33);
      if (!design?.inkSaving) { pdf.setFillColor(accent[0], accent[1], accent[2]); pdf.roundedRect(left, y, width, 27, 2, 2, 'F'); }
      font(9, true, design?.inkSaving ? accent : [255, 255, 255]); pdf.text(received < 0 ? 'AMOUNT REFUNDED / REVERSED' : 'PAYMENT RECEIVED', left + 6, y + 8);
      font(26, true, design?.inkSaving ? ink : [255, 255, 255]); pdf.text(money(Math.abs(received)), left + 6, y + 20); y += 37;
    }
    if (payment) {
      for (const [label, value] of [['Payment date', date(payment.date)], ['Method', payment.method], ['Reference', payment.reference], ['Payment type', payment.kind.replaceAll('-', ' ')]]) {
        if (value) { ensure(9); pair(label, supplied(value)); }
      }
    }
    y += 4; balance();
    line('This receipt records this payment only. It does not confirm completion of the vehicle sale.', 9, false, muted);
  } else if (document.type === 'invoice' || document.type === 'statement') {
    section('Agreed sale');
    font(8.5, true, muted); pdf.text('DESCRIPTION', left + 2, y); pdf.text('AMOUNT', right - 2, y, { align: 'right' }); y += 8;
    amountRow('Vehicle price', totals.price);
    for (const adjustment of draft.adjustments ?? []) amountRow(adjustment.description, saleWorkspacePence(adjustment.amount) * (adjustment.kind === 'discount' ? -1 : 1));
    for (const exchange of draft.exchanges ?? (draft.partExchange ? [{ registration: draft.pxRegistration, description: draft.pxDescription, value: draft.pxValue }] : [])) amountRow(`Part-exchange allowance - ${exchange.registration}${exchange.description ? ` - ${exchange.description}` : ''}`, -saleWorkspacePence(exchange.value));
    y += 5; balance();
    if (totals.pending > 0) line(`Payments awaiting confirmation: ${money(totals.pending)}. These have not reduced the balance.`, 9, false, muted);
    if (document.type === 'statement') {
      section('Payment history');
      if (!document.snapshot.payments.length) line('No payments recorded.', 9, false, muted);
      for (const payment of document.snapshot.payments) {
        const amount = payment.status === 'confirmed' ? payment.signedAmountPence : payment.amountPence;
        const description = `${date(payment.date)} - ${payment.method} - ${payment.kind.replaceAll('-', ' ')} (${payment.status})${payment.reference ? ` - ${payment.reference}` : ''}`;
        amountRow(description, amount);
      }
    }
    arrangements();
    if (document.type === 'invoice') line('Separate receipts record payments. Terms and vehicle disclosures are provided with the sale documents.', 8.5, false, muted);
  } else {
    if (document.type === 'vehicle-details') {
      section('Supplied vehicle details');
      const facts: Array<[string, unknown]> = [['Year', vehicle?.year], ['Fuel', vehicle?.fuel], ['Transmission', vehicle?.transmission], ['Mileage', typeof vehicle?.mileage === 'number' ? `${vehicle.mileage.toLocaleString('en-GB')} miles` : ''], ['Colour', vehicle?.colour], ['Previous keepers', vehicle?.owners], ['Service history', vehicle?.serviceHistory], ['Write-off category', vehicle?.writeOffCategory]];
      for (const [label, value] of facts) if (supplied(value)) { const text = `${label}: ${value}`; line(text, 9.5); }
      if (vehicle?.description) { section('Vehicle description'); paragraph(vehicle.description); }
      if (draft.notes) { section('Agreed disclosures'); paragraph(draft.notes); }
    }
    if (document.content) { section(document.type === 'terms' ? 'Terms of sale' : document.title); paragraph(document.content); }
    if (document.type === 'reservation') balance();
    if (document.type === 'handover' || document.type === 'reservation') arrangements();
    if (['terms', 'reservation', 'handover'].includes(document.type)) {
      ensure(25); y += 9; font(9, false, muted);
      pdf.text('Customer signature', left, y); pdf.text('Dealer signature', 110, y); y += 10;
      pdf.setDrawColor(rule[0], rule[1], rule[2]); pdf.line(left, y, 96, y); pdf.line(110, y, right, y); y += 8;
      pdf.text('Date', left, y); pdf.text('Date', 110, y); y += 7;
    }
  }
  if (design?.paymentInstructions && ['invoice', 'statement', 'reservation'].includes(document.type)) { section('Payment instructions'); paragraph(design.paymentInstructions, 9); }
  if (design?.footer) { y += 3; paragraph(design.footer, 9); }
  const legal = [supplied(branding.legal.companyName), branding.legal.companyNumber ? `Company ${branding.legal.companyNumber}` : '', branding.legal.vatNumber ? `VAT registration ${branding.legal.vatNumber}` : ''].filter(Boolean).join('  |  ');
  if (legal) { y += 4; line(legal, 8, false, muted); }

  const pageCount = pdf.getNumberOfPages();
  for (let page = 1; page <= pageCount; page++) {
    pdf.setPage(page); pdf.setDrawColor(rule[0], rule[1], rule[2]); pdf.line(left, 276, right, 276);
    font(8, false, muted); pdf.text(`${document.number}  |  ${draft.id}`, left, 282);
    pdf.text(`${page} / ${pageCount}`, right, 282, { align: 'right' });
    if (options.draft) { font(8, true, muted); pdf.text('DRAFT - reference allocated when issued', left, 287); }
  }
  return new Uint8Array(pdf.output('arraybuffer'));
}
