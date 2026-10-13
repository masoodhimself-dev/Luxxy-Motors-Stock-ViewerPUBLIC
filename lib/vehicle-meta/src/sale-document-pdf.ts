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
  const left = 17, right = 193, width = right - left, bottom = 265;
  const rgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const accent = rgb(palette.strong), ink = rgb(palette.ink), tint = rgb(palette.tint), soft = rgb(palette.soft);
  const muted = rgb(palette.muted), rule = rgb(palette.rule), white = [255, 255, 255];
  const plain = design?.inkSaving || design?.style === 'classic';
  // Preserve the supported three-car PX and ordinary fees on one A4 invoice.
  // Dense statements and genuinely long supplied content still flow to more pages.
  const exchangeRows = draft.exchanges ?? (draft.partExchange ? [{ registration: draft.pxRegistration, description: draft.pxDescription, value: draft.pxValue }] : []);
  const compactInvoice = document.type === 'invoice' && 1 + (draft.adjustments?.length ?? 0) + exchangeRows.length >= 5;
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
  const fill = (value: number[]) => pdf.setFillColor(value[0], value[1], value[2]);
  const stroke = (value = rule) => pdf.setDrawColor(value[0], value[1], value[2]);
  const font = (size = 10, bold = false, value = ink) => { pdf.setFont('helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size); colour(value); };
  const split = (text: unknown, maxWidth = width, size = 10, bold = false) => { font(size, bold); return pdf.splitTextToSize(clean(text), maxWidth) as string[]; };
  const splitReference = (text: string, maxWidth: number, size: number, bold: boolean) => {
    font(size, bold);
    const rows: string[] = [];
    let row = '';
    // A supplied reference is one identifier. Prefer its existing separators
    // over breaking labels such as INVOICE in the middle of a word.
    for (const part of clean(text).match(/[^-]+-?|-/g) ?? []) {
      if (row && pdf.getTextWidth(row + part) > maxWidth) { rows.push(row); row = ''; }
      const fragments = pdf.splitTextToSize(part, maxWidth) as string[];
      for (const [index, fragment] of fragments.entries()) {
        if (index) { rows.push(row); row = ''; }
        row += fragment;
      }
    }
    if (row) rows.push(row);
    return rows;
  };
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
    if (continued) {
      stroke(accent); pdf.setLineWidth(plain ? 0.35 : 0.7); pdf.line(left, 14, right, 14);
      const nameRows = split(dealerName, 92, 10, true);
      const referenceRows = splitReference(`${document.number}  |  ${document.title}`, 80, 8, false);
      font(10, true); pdf.text(nameRows, left, 24);
      font(8, false, muted); pdf.text(referenceRows, right, 24, { align: 'right' });
      y = 24 + Math.max(nameRows.length * 4.2, referenceRows.length * 3.4) + 8;
      return;
    }
    const headerTop = 14;
    let dealerY = headerTop + 16;
    const dealerText: Array<{ text: string; size: number; bold?: boolean }> = [];
    dealerText.push({ text: dealerName, size: 18, bold: true });
    const dealerAddress = [branding.address.street, branding.address.city, branding.address.region, branding.address.postcode].map(supplied).filter(Boolean).join(', ');
    if (dealerAddress) dealerText.push({ text: dealerAddress, size: 8.4 });
    for (const contact of [supplied(branding.contact.phone), supplied(branding.contact.email)].filter(Boolean)) dealerText.push({ text: contact, size: 8.4 });
    let embeddedLogo: { asset: string; fileType: string; width: number; height: number } | undefined;
    // Only snapshot-embedded raster logos can be immutable. URL logos use the wordmark.
    const logo = design?.showLogo !== false ? branding.identity.logoAsset : '';
    if (/^data:image\/(?:png|jpe?g);base64,[A-Za-z0-9+/=]+$/.test(logo) && logo.length < 1_500_000) {
      try {
        const properties = pdf.getImageProperties(logo);
        const maxWidth = design?.logoSize === 'small' ? 28 : design?.logoSize === 'large' ? 48 : 38;
        const maxHeight = design?.logoSize === 'small' ? 9 : design?.logoSize === 'large' ? 16 : 12;
        const imageHeight = Math.min(maxHeight, maxWidth * properties.height / properties.width);
        const imageWidth = imageHeight * properties.width / properties.height;
        embeddedLogo = { asset: logo, fileType: properties.fileType, width: imageWidth, height: imageHeight };
        dealerY += imageHeight + 5;
      } catch { /* Invalid embedded logo falls back to the saved dealer name. */ }
    }
    const documentLabel = document.invoiceKind === 'deposit' ? 'Deposit invoice' : document.invoiceKind === 'full' ? 'Sales invoice' : document.type === 'invoice' ? 'Invoice' : document.type === 'receipt' ? 'Payment receipt' : document.type === 'statement' ? 'Statement' : document.title;
    const titleSize = ['invoice', 'receipt', 'statement'].includes(document.type) ? (design?.style === 'premium' ? 28 : 26) : 18;
    const titleRows = split(documentLabel, 67, titleSize, true);
    // White stationery gives the dealer identity, reference and date room to
    // breathe. Brand colour is concentrated in a rule and the money summary.
    if (!plain) { fill(accent); pdf.rect(left, headerTop, width, design?.style === 'premium' ? 2.6 : 1.4, 'F'); }
    else { stroke(accent); pdf.setLineWidth(0.35); pdf.line(left, headerTop, right, headerTop); }
    if (embeddedLogo) {
      const logoTop = headerTop + 8;
      pdf.addImage(embeddedLogo.asset, embeddedLogo.fileType, left, logoTop, embeddedLogo.width, embeddedLogo.height);
    }
    for (const row of dealerText) {
      const rows = split(row.text, 87, row.size, row.bold);
      font(row.size, row.bold, row.bold ? ink : muted);
      pdf.text(rows, left, dealerY);
      dealerY += rows.length * row.size * 0.42 + (row.bold ? 3 : 1.2);
    }
    font(titleSize, true); pdf.text(titleRows, right, headerTop + 16, { align: 'right' });
    let referenceY = headerTop + 16 + (titleRows.length - 1) * titleSize * 0.42 + 8;
    font(7.3, true, muted); pdf.text('DOCUMENT NO.', right, referenceY, { align: 'right' });
    referenceY += 5;
    const referenceRows = splitReference(document.number, 67, 10, true);
    font(10, true, accent); pdf.text(referenceRows, right, referenceY, { align: 'right' });
    referenceY += referenceRows.length * 4.2 + 3;
    font(8.3, false, muted); pdf.text(`${options.draft ? 'PREVIEW DATE' : 'ISSUED ON'}  ${date(document.issuedAt)}`, right, referenceY, { align: 'right' });
    if (options.draft) { referenceY += 6; font(7.5, true, accent); pdf.text('DRAFT', right, referenceY, { align: 'right' }); }
    y = Math.max(dealerY, referenceY + 4) + (document.invoiceKind ? 0 : 6);
    stroke(); pdf.setLineWidth(0.2); pdf.line(left, y, right, y); y += 8;
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
    stroke(); pdf.line(left, y, right, y); y += 7;
  };
  const pair = (label: string, value: string, column = left, columnWidth = width) => {
    const rows = split(value, columnWidth - 31, 9);
    const height = Math.max(5.5, rows.length * 4.2);
    ensure(height + 2);
    font(8.5, false, muted); pdf.text(label, column, y);
    font(9); pdf.text(rows, column + 31, y); y += height;
  };
  const parties = () => {
    const customerRows = [supplied(draft.customer), supplied(draft.address), ...[draft.email, draft.phone].map(supplied).filter(Boolean)].filter(Boolean);
    const vehicleRows = [supplied(draft.vehicle), draft.registration ? `Registration  ${draft.registration}` : '', [vehicle?.year, supplied(vehicle?.colour), supplied(vehicle?.fuel), supplied(vehicle?.transmission)].filter(Boolean).join('  |  '), typeof vehicle?.mileage === 'number' && Number.isFinite(vehicle.mileage) ? `${vehicle.mileage.toLocaleString('en-GB')} miles` : ''].filter(Boolean);
    const rowsHaveRegistration = Boolean(draft.registration);
    const rowStyle = (index: number, vehicleBlock: boolean) => ({ size: index === 0 ? (vehicleBlock ? 12 : 11) : vehicleBlock && index === 1 && rowsHaveRegistration ? 10 : 9, bold: index === 0 || vehicleBlock && index === 1 && rowsHaveRegistration });
    const block = (label: string, rows: string[], x: number, vehicleBlock = false) => {
      let blockY = y + 6;
      font(7.7, true, accent); pdf.text(label, x + 5, blockY); blockY += 6;
      rows.forEach((row, index) => { const style = rowStyle(index, vehicleBlock); const textRows = split(row, 75, style.size, style.bold); font(style.size, style.bold, style.bold ? ink : muted); pdf.text(textRows, x + 5, blockY); blockY += textRows.length * style.size * 0.42 + 1.5; });
      return blockY;
    };
    // Very long addresses use flowing rows rather than a fixed-height two-column panel.
    const heightOf = (rows: string[], vehicleBlock = false) => rows.reduce((sum, row, index) => { const style = rowStyle(index, vehicleBlock); return sum + split(row, 75, style.size, style.bold).length * style.size * 0.42 + 1.5; }, 15);
    if (Math.max(heightOf(customerRows), heightOf(vehicleRows, true)) > 65) {
      section('Customer'); customerRows.forEach((row, i) => line(row, i === 0 ? 11 : 9, i === 0));
      section('Vehicle'); vehicleRows.forEach((row, i) => line(row, i === 0 ? 11 : 9, i === 0)); y += 4;
    } else {
      const panelHeight = Math.max(heightOf(customerRows), heightOf(vehicleRows, true));
      ensure(panelHeight + 8);
      if (!plain) { fill(tint); pdf.rect(108, y, 85, panelHeight, 'F'); fill(accent); pdf.rect(108, y, 1, panelHeight, 'F'); }
      else { stroke(); pdf.rect(left, y, 85, panelHeight); pdf.rect(108, y, 85, panelHeight); }
      const end = Math.max(block('CUSTOMER', customerRows, left), block('VEHICLE', vehicleRows, 108, true)); y = Math.max(y + panelHeight, end) + 8;
    }
  };
  const invoiceParties = () => {
    font(7.5, true, accent); pdf.text('BILLED TO', left, y); y += 6;
    line(draft.customer, 11, true);
    if (draft.address) paragraph(draft.address, 9);
    const contact = [supplied(draft.email), supplied(draft.phone)].filter(Boolean).join('  |  ');
    if (contact) line(contact, 9, false, muted);
    y += 1;
    const suppliedFacts: Array<[string, unknown]> = [
      ['Year', vehicle?.year], ['Mileage', typeof vehicle?.mileage === 'number' ? `${vehicle.mileage.toLocaleString('en-GB')} miles` : ''],
      ['Fuel', vehicle?.fuel], ['Transmission', vehicle?.transmission], ['Engine', vehicle?.engineSize], ['Colour', vehicle?.colour],
      ['Body type', vehicle?.bodyType], ['Previous keepers', vehicle?.owners], ['Emissions standard', vehicle?.emissionClass],
      ['Service history', vehicle?.serviceHistory], ['Doors / seats', [vehicle?.doors ? `${vehicle.doors} doors` : '', vehicle?.seats ? `${vehicle.seats} seats` : ''].filter(Boolean).join(' / ')],
      ['Write-off category', vehicle?.writeOffCategory],
    ];
    const presentFacts = suppliedFacts.filter(row => Boolean(supplied(row[1])));
    const facts = presentFacts.filter(([, value]) => split(value, 49, 9, true).length <= 3);
    const extendedFacts = presentFacts.filter(([, value]) => split(value, 49, 9, true).length > 3);
    const titleRows = split(draft.vehicle || vehicle?.title || '', 112, 15, true);
    const registrationRows = draft.registration ? split(`Registration  ${draft.registration}`, 112, 10.5, true) : [];
    const headerHeight = Math.max(30, 18 + (titleRows.length - 1) * 6.5 + registrationRows.length * 5 + 6);
    const rowHeights = Array.from({length: Math.ceil(facts.length / 3)}, (_, row) => Math.max(10.3, ...facts.slice(row * 3, row * 3 + 3).map(([, value]) => 6 + split(value, 49, 9, true).length * 4.3)));
    const panelHeight = headerHeight + rowHeights.reduce((sum, h) => sum + h, 0) + 2;
    ensure(panelHeight + 8);
    if (!plain) { fill(tint); pdf.rect(left, y, width, panelHeight, 'F'); fill(accent); pdf.rect(left, y, 1.2, panelHeight, 'F'); }
    else { stroke(); pdf.rect(left, y, width, panelHeight); }
    const top = y;
    font(7.5, true, accent); pdf.text('YOUR VEHICLE', left + 6, top + 8);
    font(15, true); pdf.text(titleRows, left + 6, top + 17);
    if (draft.registration) { font(10.5, true, muted); pdf.text(registrationRows, left + 6, top + 18 + titleRows.length * 6.5); }
    const photo = vehicle?.photoDataUrl;
    if (photo && /^data:image\/(?:png|jpe?g);base64,[A-Za-z0-9+/=]+$/.test(photo) && photo.length < 2_800_000) {
      try {
        const properties = pdf.getImageProperties(photo);
        const photoWidth = Math.min(43, 22 * properties.width / properties.height);
        const photoHeight = Math.min(22, 43 * properties.height / properties.width);
        pdf.addImage(photo, properties.fileType, right - 49 + (43 - photoWidth) / 2, top + 7 + (22 - photoHeight) / 2, photoWidth, photoHeight);
      } catch { /* A missing/invalid photograph never creates a fabricated placeholder. */ }
    }
    y = top + headerHeight;
    facts.forEach(([label, value], index) => {
      const x = left + 6 + (index % 3) * 56;
      font(7.2, false, muted); pdf.text(label.toUpperCase(), x, y);
      const textRows = split(value, 49, 9, true); font(9, true); pdf.text(textRows, x, y + 5);
      if (index % 3 === 2 || index === facts.length - 1) y += rowHeights[Math.floor(index / 3)];
    });
    y = top + panelHeight + 5;
    if (extendedFacts.length) { section('Additional vehicle details'); for (const [label,value] of extendedFacts) line(`${label}: ${value}`, 9); }
  };
  const amountRow = (label: string, amount: number, bold = false) => {
    const rows = split(label, 126, 9.5, bold), height = Math.max(compactInvoice ? 8.5 : 10, rows.length * 4.4 + (compactInvoice ? 4 : 5));
    ensure(height + 1);
    font(9.5, bold); pdf.text(rows, left + 4, y);
    fittedAmount(amount, right - 4, y, 36, 10, 'right', amount < 0 ? accent : ink);
    y += height; stroke(); pdf.line(left, y - 5, right, y - 5);
  };
  const balance = () => {
    const height = compactInvoice || document.invoiceKind ? 29 : 32, after = document.invoiceKind ? 31 : compactInvoice ? 35 : 39;
    ensure(after); y += 2;
    const summaryWidth = 104, balanceX = left + summaryWidth + 4, balanceWidth = width - summaryWidth - 4;
    // One strong amount anchors an invoice. Receipts keep the spotlight on
    // their individual payment rather than competing with a second dark block.
    const strongBalance = !plain && document.type !== 'receipt';
    if (!plain) { fill(strongBalance ? accent : tint); pdf.rect(balanceX, y, balanceWidth, height, 'F'); if (!strongBalance) { fill(accent); pdf.rect(balanceX, y, 1.2, height, 'F'); } }
    else { stroke(); pdf.rect(left, y, summaryWidth, height); pdf.rect(balanceX, y, balanceWidth, height); }
    font(8.3, false, muted); pdf.text('Sale total', left + 5, y + 9);
    fittedAmount(totals.totalDue, left + summaryWidth - 5, y + 9, 48, 12, 'right');
    font(8.3, false, muted); pdf.text(document.invoiceKind === 'deposit' ? 'Balance remaining' : 'Payments received', left + 5, y + (compactInvoice ? 20 : 22));
    fittedAmount(document.invoiceKind === 'deposit' ? document.balanceAtIssue : totals.confirmedPaid, left + summaryWidth - 5, y + (compactInvoice ? 20 : 22), 48, 12, 'right');
    stroke(); pdf.setLineWidth(0.15); pdf.line(left + 5, y + (compactInvoice ? 13.5 : 15), left + summaryWidth - 5, y + (compactInvoice ? 13.5 : 15));
    font(7.5, true, strongBalance ? white : accent); pdf.text(document.invoiceKind === 'deposit' ? 'PAYMENTS RECEIVED' : document.balanceAtIssue < 0 ? 'CUSTOMER CREDIT' : 'BALANCE REMAINING', balanceX + 5, y + 7);
    fittedAmount(document.invoiceKind === 'deposit' ? totals.confirmedPaid : Math.abs(document.balanceAtIssue), balanceX + 5, y + 20, balanceWidth - 10, 24, 'left', strongBalance ? white : ink);
    if (document.balanceAtIssue === 0 && totals.totalDue > 0 && totals.confirmedPaid >= totals.totalDue) { font(7.5, true, strongBalance ? white : accent); pdf.text('Paid in full', balanceX + 5, y + (compactInvoice ? 25 : 28)); }
    y += after;
  };
  const arrangements = () => {
    const fulfilment = draft.fulfilment;
    if (!fulfilment && draft.collection) { line(`Collection: ${date(draft.collection)}`, 9); return; }
    if (!fulfilment || ![fulfilment.address, fulfilment.scheduledDate, fulfilment.timeWindow, fulfilment.completedAt].some(Boolean)) return;
    if (document.type === 'invoice' && fulfilment.method === 'collection') {
      const details = [fulfilment.scheduledDate ? date(fulfilment.scheduledDate) : '', supplied(fulfilment.timeWindow)].filter(Boolean).join('  |  ');
      if (details) line(`Collection: ${details}`, 9);
      if (fulfilment.recipient) line(`Recipient: ${fulfilment.recipient}`, 9);
      if (fulfilment.completedAt) line(`Completed ${date(fulfilment.completedAt)}${fulfilment.completedRecipient ? ` - ${fulfilment.completedRecipient}` : ''}`, 9);
      return;
    }
    section(fulfilment.method === 'delivery' ? 'Delivery arrangements' : 'Collection arrangements');
    const dateAndTime = [fulfilment.scheduledDate ? date(fulfilment.scheduledDate) : '', supplied(fulfilment.timeWindow)].filter(Boolean).join('  |  ');
    if (dateAndTime) line(dateAndTime, 9);
    if (fulfilment.method === 'delivery' && fulfilment.address) paragraph(fulfilment.address, 9);
    if (fulfilment.recipient) line(`Recipient: ${fulfilment.recipient}`, 9);
    if (fulfilment.completedAt) line(`Completed ${date(fulfilment.completedAt)}${fulfilment.completedRecipient ? ` - ${fulfilment.completedRecipient}` : ''}`, 9);
  };
  heading(); if (document.invoiceKind) invoiceParties(); else parties();

  if (document.type === 'receipt') {
    const payment = document.snapshot.payments.find(item => item.id === document.paymentId);
    const received = document.paymentAmountPence ?? payment?.signedAmountPence;
    if (typeof received === 'number') {
      ensure(37);
      if (!plain) { fill(accent); pdf.rect(left, y, width, 31, 'F'); }
      else { stroke(); pdf.rect(left, y, width, 31); }
      font(8, true, plain ? accent : white); pdf.text(received < 0 ? 'AMOUNT REFUNDED / REVERSED' : 'PAYMENT RECEIVED', left + 6, y + 8);
      fittedAmount(Math.abs(received), left + 6, y + 23, width - 12, 30, 'left', plain ? ink : white); y += 40;
    }
    if (payment) {
      for (const [label, value] of [['Payment date', date(payment.date)], ['Method', payment.method], ['Reference', payment.reference], ['Payment type', payment.kind.replaceAll('-', ' ')]]) {
        if (value) { ensure(9); pair(label, supplied(value)); }
      }
    }
    y += 4; balance();
  } else if (document.type === 'invoice' || document.type === 'statement') {
    ensure(22); y += 3;
    if (!plain) { fill(soft); pdf.rect(left, y - 5, width, 9, 'F'); }
    font(8, true, muted); pdf.text('DESCRIPTION', left + 4, y + 1); pdf.text('AMOUNT', right - 4, y + 1, { align: 'right' }); y += document.invoiceKind ? 9 : 12;
    amountRow('Vehicle price', totals.price, true);
    for (const adjustment of draft.adjustments ?? []) amountRow(adjustment.description, saleWorkspacePence(adjustment.amount) * (adjustment.kind === 'discount' ? -1 : 1));
    for (const exchange of exchangeRows) amountRow(`Part-exchange allowance - ${exchange.registration}${exchange.description ? ` - ${exchange.description}` : ''}`, -saleWorkspacePence(exchange.value));
    if (document.invoiceKind) {
      section('Payments received');
      const payments = document.snapshot.payments.filter(payment => payment.status === 'confirmed');
      if (!payments.length) line('No payments received at the invoice date.', 9, false, muted);
      for (const payment of payments) {
        const detail = `${date(payment.date)}  |  ${payment.method}  |  ${payment.kind.replaceAll('-', ' ')}${payment.reference ? `  |  ${payment.reference}` : ''}`;
        const rows = split(detail, 126, 8.5); const height = Math.max(8, rows.length * 4.2 + 3);
        ensure(height + 2); font(8.5, false, muted); pdf.text(rows, left + 4, y);
        fittedAmount(payment.signedAmountPence, right - 4, y, 36, 9.5, 'right', payment.signedAmountPence < 0 ? accent : ink);
        y += height; stroke(); pdf.line(left, y - 3, right, y - 3);
      }
    }
    y += compactInvoice || document.invoiceKind ? 3 : 5; balance();
    if (totals.pending > 0) line(`Awaiting confirmation: ${money(totals.pending)}. These have not reduced the balance.`, 9, false, muted);
    if (document.type === 'statement') {
      section('Payment history');
      if (!document.snapshot.payments.length) line('No payments recorded.', 9, false, muted);
      for (const payment of document.snapshot.payments) {
        const amount = payment.status === 'confirmed' ? payment.signedAmountPence : payment.amountPence;
        const description = `${date(payment.date)} - ${payment.method} - ${payment.kind.replaceAll('-', ' ')} (${payment.status})${payment.reference ? ` - ${payment.reference}` : ''}`;
        amountRow(description, amount);
      }
    }
    if (!document.invoiceKind) arrangements();
    if (document.invoiceKind && document.content) { section(document.invoiceKind === "deposit" ? "Deposit terms" : "Terms of sale"); paragraph(document.content, 8.5); }
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
    const footerRows = split(`${dealerName}  |  ${document.number}`, 146, 7.5).slice(0, 2);
    font(7.5, false, muted); pdf.text(footerRows, left, 281.5);
    pdf.text(`${page} / ${pageCount}`, right, 281.5, { align: 'right' });
    if (options.draft) { font(7.5, false, muted); pdf.text('DRAFT - not issued', left, 290); }
  }
  return new Uint8Array(pdf.output('arraybuffer'));
}
