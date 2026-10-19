import { jsPDF } from 'jspdf';
import qrcode from 'qrcode-generator';
import { APPROVED_COLOURS, LAYOUT as L } from './layout.ts';
import type { InvoiceData, LayoutEvent, RenderOptions, ImageAsset, Party } from './types.ts';

const PT = 25.4 / 72;
type Weight = 'normal' | 'bold' | 'plate';
const present = (s: string | null | undefined): s is string => typeof s === 'string' && s.trim().length > 0;

/**
 * One renderer for preview and issue. Pure presentation: no fetch, persistence,
 * payment filtering, total calculation, status inference or invoice numbering.
 * Throws on invalid assets/unsupported plate glyphs instead of silently substituting.
 */
export function renderInvoice(data: InvoiceData, options: RenderOptions) {
  if (!present(data.number) || !present(data.issueDate)) throw new Error('Invoice number and issue date are required.');
  if (data.type !== 'Deposit Invoice' && data.type !== 'Sales Invoice') throw new Error('Unsupported invoice type.');
  for (const [name, amount] of Object.entries(data.totals)) if (!present(amount)) throw new Error(`Missing supplied total: ${name}`);
  for (const group of [data.saleLines, data.confirmedPayments]) {
    const seen = new Set<string>();
    for (const row of group) {
      if (!present(row.id) || seen.has(row.id)) throw new Error('Row IDs must be nonempty and unique within each table.');
      seen.add(row.id);
      if (!present(row.amount)) throw new Error(`Missing supplied amount for ${row.id}`);
    }
  }
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: false, putOnlyUsedFonts: true, precision: 5 });
  if (options.creationDate) doc.setCreationDate(options.creationDate);
  if (options.fileId) doc.setFileId(options.fileId);
  doc.setProperties({ title: `${data.type} ${data.number}`, subject: 'Vehicle invoice', creator: 'Classic ledger invoice renderer' });
  for (const [file, family, style, bytes] of [
    ['DejaVuSans.ttf', 'Ledger', 'normal', options.fonts.regularTtf],
    ['DejaVuSans-Bold.ttf', 'Ledger', 'bold', options.fonts.boldTtf],
    ['forecourt-plate-uk.ttf', 'ForecourtPlateUK', 'normal', options.fonts.plateTtf],
  ] as const) {
    if (!bytes || bytes.startsWith('data:')) throw new Error(`Supply plain base64 TTF bytes for ${file}.`);
    doc.addFileToVFS(file, bytes); doc.addFont(file, family, style);
  }
  const branding = options.branding ?? {};
  const colours = options.monochrome
    ? { ink: '#000000', accent: '#333333', muted: '#444444', rule: '#BBBBBB' }
    : { ink: branding.ink ?? APPROVED_COLOURS.ink, accent: branding.accent ?? APPROVED_COLOURS.accent,
        muted: branding.muted ?? APPROVED_COLOURS.muted, rule: branding.rule ?? APPROVED_COLOURS.rule };
  for (const c of Object.values(colours)) if (!/^#[\da-f]{6}$/i.test(c)) throw new Error('Colours must be six-digit hex values.');
  const events: LayoutEvent[] = [];
  let page = 1, y = 0;
  function font(size = L.bodyPt as number, weight: Weight = 'normal') {
    doc.setFont(weight === 'plate' ? 'ForecourtPlateUK' : 'Ledger', weight === 'bold' ? 'bold' : 'normal'); doc.setFontSize(size);
  }
  function width(s: string, size = L.bodyPt as number, weight: Weight = 'normal') { font(size, weight); return doc.getTextWidth(s); }
  function checkGlyphs(s: string, weight: Weight = 'normal') {
    font(9.2, weight);
    const m = doc.getFont().metadata as { cmap?: { unicode?: { codeMap?: Record<number, number> } } };
    const cmap = m.cmap?.unicode?.codeMap;
    if (!cmap) throw new Error('TTF font could not be registered.');
    for (const ch of s) if (!/\s/.test(ch) && !cmap[ch.codePointAt(0)!]) {
      throw new Error(`Unsupported ${weight === 'plate' ? 'registration' : 'body'} character U+${ch.codePointAt(0)!.toString(16).toUpperCase()}; supply appropriate content/font support, do not silently replace it.`);
    }
  }
  function wrap(s: string | null | undefined, w: number, size = L.bodyPt as number, weight: Weight = 'normal'): string[] {
    if (!present(s)) return [];
    checkGlyphs(s, weight);
    const out: string[] = [];
    for (const para of s.split(/\r?\n/)) {
      if (!para.trim()) { out.push(''); continue; }
      let line = '';
      for (const word of para.trim().split(/\s+/)) {
        const candidate = line ? `${line} ${word}` : word;
        if (width(candidate, size, weight) <= w + 0.001) { line = candidate; continue; }
        if (line) { out.push(line); line = ''; }
        let part = '';
        for (const ch of word) {
          if (width(ch, size, weight) > w) throw new Error('A character cannot fit the available column.');
          if (part && width(part + ch, size, weight) > w) { out.push(part); part = ch; } else part += ch;
        }
        line = part;
      }
      if (line) out.push(line);
    }
    return out;
  }
  function text(s: string, x: number, top: number, size = L.bodyPt as number, weight: Weight = 'normal', colour = colours.ink, align: 'left' | 'right' | 'center' = 'left') {
    if (!s) return;
    checkGlyphs(s, weight); font(size, weight); doc.setTextColor(colour);
    doc.text(s, x, top + size * PT * 0.8, { align });
    const w = doc.getTextWidth(s);
    events.push({ kind: 'text', page, x: align === 'right' ? x - w : align === 'center' ? x - w / 2 : x, y: top, width: w, height: size * PT, text: s, fontSize: size });
  }
  function lines(ss: string[], x: number, top: number, size = 9.2, weight: Weight = 'normal', colour = colours.ink, leading = 4) {
    ss.forEach((s, i) => text(s, x, top + i * leading, size, weight, colour));
    return top + ss.length * leading;
  }
  function rule(top: number, x = L.left as number, w = L.width as number, colour = colours.rule, stroke = 0.16) {
    doc.setDrawColor(colour); doc.setLineWidth(stroke); doc.line(x, top, x + w, top);
  }
  function label(s: string, x: number, top: number) { text(s.toUpperCase(), x, top, 8.5, 'bold', colours.accent); }
  function fitImage(asset: ImageAsset, x: number, top: number, boxW: number, boxH: number, align: 'left' | 'center' = 'left') {
    if (!/^data:image\/(png|jpeg);base64,/.test(asset.data)) throw new Error('Images must be preloaded PNG/JPEG data URLs.');
    const props = doc.getImageProperties(asset.data);
    const ratio = Math.min(boxW / props.width, boxH / props.height);
    const w = props.width * ratio, h = props.height * ratio;
    const xx = align === 'center' ? x + (boxW - w) / 2 : x;
    doc.addImage(asset.data, asset.format, xx, top, w, h);
    events.push({ kind: 'image', page, x: xx, y: top, width: w, height: h });
    return h;
  }
  let registration: string | null = null;
  if (present(data.vehicle.registration)) {
    const result = options.registrationFormatter ? options.registrationFormatter(data.vehicle.registration) : data.vehicle.registration;
    registration = present(result) ? result : null;
    if (registration) {
      if (/\r|\n/.test(registration)) throw new Error('Registration formatter must return a single line.');
      checkGlyphs(registration, 'plate');
    }
  }
  function plate(x: number, top: number) {
    if (!registration) { text(data.vehicle.registration || 'Registration not added', x + L.plateWidth, top + 2, 8.7, 'normal', colours.muted, 'right'); return; }
    const w = L.plateWidth, h = w / L.plateRatio, stroke = w / 190;
    doc.setFillColor('#FFFFFF'); doc.setDrawColor('#363636'); doc.setLineWidth(stroke);
    doc.roundedRect(x, top, w, h, stroke * 3, stroke * 3, 'FD');
    const approvedEm = (w - stroke * 2) * 0.206;
    let size = approvedEm / PT;
    size *= Math.min(1, (w - 2.4) / width(registration, size, 'plate'));
    // Uniform font scaling only. No horizontal stretch, badge, strip or raster lettering.
    font(size, 'plate'); doc.setTextColor('#000000');
    const baseline = top + h / 2 + size * PT * 0.395;
    doc.text(registration, x + w / 2, baseline, { align: 'center' });
    events.push({ kind: 'text', page, x: x + (w - width(registration, size, 'plate')) / 2, y: top + 0.8, width: width(registration, size, 'plate'), height: h - 1.6, text: registration, fontSize: size });
  }
  const footerLines = (data.footerLines ?? []).flatMap(s => wrap(s, L.width, 8.5));
  if (footerLines.length > 7) throw new Error('Repeated footer exceeds seven lines. Move extended dealer text to terms.');
  const footerRuleY = Math.min(L.footerRuleY, 282.5 - (footerLines.length + 1) * 3.6);
  const limit = Math.min(L.contentLimit, footerRuleY - 3);
  function header(continued = false) {
    const num = wrap(data.number, 84, 9.5, 'bold');
    const date = wrap('Issued ' + data.issueDate, 84, 9.2);
    text(data.type + (continued ? ' - continued' : ''), 196, 14.5, continued ? 12 : 14, 'bold', colours.ink, 'right');
    num.forEach((s, i) => text(s, 196, 22 + i * 4, 9.5, 'bold', colours.ink, 'right'));
    const dateTop = 22 + num.length * 4 + 1;
    date.forEach((s, i) => text(s, 196, dateTop + i * 4, 9.2, 'normal', colours.muted, 'right'));
    let leftEnd = 25;
    if (branding.logo) fitImage(branding.logo, 14, 10.5, branding.logoWidth ?? 49, branding.logoHeight ?? 13.07);
    else if (present(data.dealer.name)) leftEnd = lines(wrap(data.dealer.name, 90, 12.4, 'bold'), 14, 14.5, 12.4, 'bold', colours.ink, 5);
    const statusTop = Math.max(27, leftEnd + 2);
    const status = wrap([data.draft ? 'Draft - not issued' : '', data.settlementStatus].filter(present).join(' · '), 90, 9.1, 'bold');
    lines(status, 14, statusTop, 9.1, 'bold', colours.accent);
    const end = Math.max(33, dateTop + date.length * 4 + 2, statusTop + status.length * 4 + 2);
    if (end > 90) throw new Error('Invoice identification/status is too long for a repeated header.');
    rule(end, 14, 182, colours.accent, 0.4);
    y = end + 4;
    if (continued) {
      const identity = [data.customer?.name, registration ? `Registration ${registration}` : undefined].filter(present).join(' | ');
      const ls = wrap(identity, L.width, 9.2);
      lines(ls, 14, y, 9.2); y += ls.length * 4 + 4;
      if (y > limit - 25) throw new Error('Continuation identification leaves insufficient space for content.');
    }
  }
  function next() { doc.addPage(); page++; header(true); }
  function ensure(h: number) { if (y + h > limit + 0.001) next(); }
  function paragraph(s: string, x: number, w: number, size = 9.2, weight: Weight = 'normal', leading = 4) {
    const ls = wrap(s, w, size, weight);
    for (const line of ls) { ensure(leading); text(line, x, y, size, weight); y += leading; }
  }
  header();

  // Both address columns grow together. Arbitrarily long addresses can continue.
  function partyRows(who: Party | undefined) {
    const rows: { s: string; size: number; weight: Weight }[] = [];
    if (!who) return rows;
    for (const s of wrap(who.name, 86, 9.8, 'bold')) rows.push({ s, size: 9.8, weight: 'bold' });
    for (const entry of who.address ?? []) for (const s of wrap(entry, 86, 9.2)) rows.push({ s, size: 9.2, weight: 'normal' });
    for (const entry of who.contacts ?? []) for (const s of wrap(entry, 86, 8.7)) rows.push({ s, size: 8.7, weight: 'normal' });
    return rows;
  }
  const left = partyRows(data.dealer), right = partyRows(data.customer);
  if (left.length || right.length) {
    ensure(9); if (left.length) label('From', 14, y); if (right.length) label('Bill to', 110, y); y += 4.5;
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      if (y + 4.1 > limit) { next(); if (i < left.length) label('From - continued', 14, y); if (i < right.length) label('Bill to - continued', 110, y); y += 4.5; }
      if (left[i]) text(left[i].s, 14, y, left[i].size, left[i].weight);
      if (right[i]) text(right[i].s, 110, y, right[i].size, right[i].weight);
      y += 4.1;
    }
    y += 2;
  }

  // Reserve an ordinary vehicle block together, keeping its title and plate with the photo/facts.
  const v = data.vehicle;
  const detailX = v.photo ? 51 : 14, detailW = v.photo ? 145 : 182;
  const pairs = [...[['Year', v.year], ['Mileage', v.mileage], ['Fuel', v.fuel], ['Gearbox', v.gearbox], ['Colour', v.colour]], ...(v.details ?? []).map(p => [p.label, p.value])].filter((p): p is [string, string] => present(p[1]));
  const columns = pairs.length > 6 ? 4 : 3;
  const cw = detailW / columns;
  const rows: { cells: [string, string[]][]; height: number }[] = [];
  for (let i = 0; i < pairs.length; i += columns) {
    const cells = pairs.slice(i, i + columns).map(([k, value]): [string, string[]] => [k, wrap(value, cw - 3, 9.2, 'bold')]);
    rows.push({ cells, height: 3.6 + Math.max(...cells.map(c => c[1].length)) * 4 + 1 });
  }
  const vinLines = wrap(v.vin, detailW - 10, 9.0);
  const detailsHeight = rows.reduce((n, r) => n + r.height, 0) + (vinLines.length ? vinLines.length * 4 + 0.5 : 0);
  const vehicleHeaderHeight = 4.8 + Math.max(wrap(v.makeModel, 143, 12.4, 'bold').length * 5 + wrap(v.derivative, 143, 9.3).length * 4.1 + 3, present(v.derivative) ? 12 : 9);
  const vehicleBlockHeight = vehicleHeaderHeight + Math.max(detailsHeight, v.photo ? L.photoHeight : 0) + 4;
  ensure(Math.min(vehicleBlockHeight, Math.max(48, limit - 110))); label('Vehicle details', 14, y);
  plate(162, y + 2);
  y += 4.8;
  const titleStart = y;
  if (present(v.makeModel)) paragraph(v.makeModel, 14, 143, 12.4, 'bold', 5);
  if (present(v.derivative)) paragraph(v.derivative, 14, 143, 9.3, 'normal', 4.1);
  y = Math.max(y + 3, titleStart + (present(v.derivative) ? 12 : 9));
  ensure(Math.min(Math.max(detailsHeight, v.photo ? L.photoHeight : 0), 50));
  const photoPage = page, photoTop = y;
  const photoH = v.photo ? fitImage(v.photo, 14, y, L.photoWidth, L.photoHeight) : 0;
  for (const r of rows) {
    // Field values are measured and may span pages; their labels repeat with the field.
    let offset = 0; const n = Math.max(...r.cells.map(c => c[1].length));
    while (offset < n) {
      ensure(8.6);
      const count = Math.max(1, Math.min(n - offset, Math.floor((limit - y - 4.6) / 4)));
      r.cells.forEach(([k, ss], i) => { text(k + (offset ? ' (continued)' : ''), detailX + i * cw, y, 8.5, 'normal', colours.muted); lines(ss.slice(offset, offset + count), detailX + i * cw, y + 3.6, 9.2, 'bold'); });
      y += 3.6 + count * 4 + 1; offset += count;
      if (offset < n) next();
    }
  }
  if (vinLines.length) {
    for (let i = 0; i < vinLines.length; i++) { ensure(4); text(i ? 'VIN +' : 'VIN', detailX, y, 8.5, 'normal', colours.muted); text(vinLines[i], detailX + 10, y, 9); y += 4; }
    y += 0.5;
  }
  if (page === photoPage) y = Math.max(y, photoTop + photoH);
  y += 1.5; ensure(4); rule(y); y += 2;

  function table(title: string, suppliedColumns: readonly number[], heads: string[], input: { id: string; values: string[] }[], kind: 'payment' | 'sale-line', showCount = false) {
    // Financial values remain intact, even at the largest supported pence amount.
    const cols = [...suppliedColumns];
    const last = cols.length - 1;
    const amountWidth = Math.max(cols[last], ...input.map(row => width(row.values[last], 9.2) + 0.2));
    const extra = amountWidth - cols[last];
    cols[kind === 'payment' ? 1 : 0] -= extra; cols[last] = amountWidth;
    const starts = cols.map((_, i) => 14 + cols.slice(0, i).reduce((a, b) => a + b, 0));
    function tableHead(continued: boolean) {
      label(title + (continued ? ' - continued' : ''), 14, y);
      if (showCount) text(`${input.length} confirmed payments`, 196, y, 8.5, 'normal', colours.muted, 'right');
      y += 5.4;
      heads.forEach((h, i) => text(h, i === heads.length - 1 ? 196 : starts[i], y, 8.5, 'bold', colours.muted, i === heads.length - 1 ? 'right' : 'left'));
      y += 4.2; rule(y, 14, 182, colours.muted, 0.2);
    }
    // Sale breakdown has a single heading row, matching the approved ledger.
    function saleHead(continued: boolean) {
      label(title + (continued ? ' - continued' : ''), 14, y); text('Amount', 196, y, 8.5, 'normal', colours.muted, 'right'); y += 5;
    }
    const head = kind === 'payment' ? tableHead : saleHead;
    const headHeight = kind === 'payment' ? 9.6 : 5;
    const rowHeight = (values: string[]) => Math.max(5.1, Math.max(1, ...values.map((s, i) => wrap(s, cols[i] - (i === cols.length - 1 ? 0 : 2), 9.2).length)) * 4 + 1.1);
    // Keep the heading with the first measured row, including wrapped descriptions.
    const firstHeight = input[0] ? rowHeight(input[0].values) : 5.1;
    ensure(headHeight + Math.min(firstHeight, Math.max(5.1, limit - 110))); head(false);
    if (!input.length) { ensure(5.1); text('No confirmed payments supplied', 14, y + 0.9, 9.2); y += 5.1; }
    for (const row of input) {
      const cells = row.values.map((s, i) => wrap(s, cols[i] - (i === cols.length - 1 ? 0 : 2), 9.2));
      const n = Math.max(1, ...cells.map(c => c.length));
      const fullHeight = Math.max(5.1, n * 4 + 1.1);
      if (y + fullHeight > limit && fullHeight <= limit - 110) { next(); head(true); }
      let offset = 0;
      while (offset < n) {
        const capacity = Math.floor((limit - y - 1.1) / 4);
        if (capacity < 1) { next(); head(true); continue; }
        const count = Math.min(n - offset, capacity);
        if (offset) { text(kind === 'payment' ? 'Payment row continued' : 'Sale line continued', 14, y, 8.5, 'normal', colours.muted); y += 4; }
        // Re-evaluate when the continuation marker itself consumes space.
        const fitCount = Math.min(count, Math.max(1, Math.floor((limit - y - 1.1) / 4)));
        const hh = Math.max(5.1, fitCount * 4 + 1.1);
        cells.forEach((ss, i) => ss.slice(offset, offset + fitCount).forEach((s, j) => text(s, i === cols.length - 1 ? 196 : starts[i], y + 0.85 + j * 4, 9.2, 'normal', colours.ink, i === cols.length - 1 ? 'right' : 'left')));
        events.push({ kind, page, x: 14, y, width: 182, height: hh, id: row.id, continued: offset > 0 });
        y += hh; rule(y, 14, 182, colours.rule, 0.13); offset += fitCount;
        if (offset < n) { next(); head(true); }
      }
    }
    y += 2;
  }
  if (data.saleLines.length) table('Sale breakdown', L.saleColumns, ['Description', 'Amount'], data.saleLines.map(r => ({ id: r.id, values: [r.description, r.amount] })), 'sale-line');
  table('Payment history', L.paymentColumns, ['Date', 'Description', 'Method', 'Amount'], data.confirmedPayments.map(p => ({ id: p.id, values: [p.date, p.description, p.method, p.amount] })), 'payment', true);

  // Supplied totals are rendered once, after every payment. No arithmetic or status inference.
  const totalRows = [['Sale total', data.totals.saleTotal], ['Payments received', data.totals.paymentsReceived], [data.balanceLabel ?? 'Balance remaining', data.totals.balanceRemaining]];
  const totalAmountWidth = Math.max(29, ...totalRows.map(([, val], i) => width(val, i === 2 ? 10.3 : 9.7, 'bold') + 0.2));
  const totalLabelWidth = Math.max(...totalRows.map(([label], i) => width(label, 9.2, i === 2 ? 'bold' : 'normal')));
  const settlementWidth = Math.max(68, totalLabelWidth + 5 + totalAmountWidth);
  const settlementLeft = 196 - settlementWidth;
  const measuredTotals = totalRows.map(([k, val], i) => ({ label: k, lines: wrap(val, totalAmountWidth, i === 2 ? 10.3 : 9.7, 'bold'), size: i === 2 ? 10.3 : 9.7 }));
  const statusLines = wrap(data.settlementStatus, settlementWidth, 8.8, 'bold');
  const totalsH = 1 + measuredTotals.reduce((n, r) => n + Math.max(6, r.lines.length * 4), 0) + (statusLines.length ? statusLines.length * 4 + 1 : 0);
  const instructionLines = (data.paymentInstructions ?? []).flatMap(s => wrap(s, Math.min(99, settlementLeft - 29), 9.1));
  const instructionH = instructionLines.length ? 4.8 + instructionLines.length * 4.1 : 0;
  if (totalsH > limit - 100) throw new Error('Settlement amount text is too long. Supply formatted amounts, not explanatory prose.');
  ensure(Math.min(Math.max(totalsH, instructionH), Math.max(totalsH, 55)));
  const totalTop = y, settlementPage = page;
  rule(totalTop, settlementLeft, settlementWidth, colours.ink, 0.35);
  let ty = totalTop + 2;
  for (let i = 0; i < measuredTotals.length; i++) {
    const r = measuredTotals[i]; text(r.label, settlementLeft, ty, 9.2, i === 2 ? 'bold' : 'normal');
    r.lines.forEach((s, j) => text(s, 196, ty + j * 4, r.size, 'bold', colours.ink, 'right'));
    ty += Math.max(6, r.lines.length * 4);
  }
  statusLines.forEach((s, i) => text(s, 196, ty + 1 + i * 4, 8.8, 'bold', colours.accent, 'right'));
  events.push({ kind: 'settlement', page, x: settlementLeft, y: totalTop, width: settlementWidth, height: totalsH });
  if (instructionLines.length) {
    label('Payment instructions', 14, y); y += 4.8;
    for (let i = 0; i < instructionLines.length; i++) {
      if (y + 4.1 > limit) { next(); label('Payment instructions - continued', 14, y); y += 4.8; }
      text(instructionLines[i], 14, y, 9.1); y += 4.1;
    }
  }
  if (page === settlementPage) y = Math.max(y, totalTop + totalsH);
  y += 2;
  if (data.pendingNote) { paragraph(data.pendingNote, 14, L.width, 9.1); y += 3; }
  if (data.draft && !data.verification) { paragraph('Verification QR added on issue', 14, L.width, 8.7); y += 2; }

  // Terms and QR occupy a compact final band; long terms flow without font shrinking.
  let qr: ReturnType<typeof qrcode> | undefined;
  let qrSize = 0;
  if (data.verification) {
    if (!/^https?:\/\/[^\s/]+(?:\/[^\s]*)?$/i.test(data.verification.url)) throw new Error('Verification URL must be HTTP(S).');
    qr = qrcode(0, 'M'); qr.addData(data.verification.url, 'Byte'); qr.make();
    qrSize = Math.max(L.qrSize, (qr.getModuleCount() + 8) * L.qrMinModule);
  }
  const qrTextWidth = 37, qrGap = 4, qrBandWidth = qr ? qrSize + qrTextWidth + qrGap + 7 : 0;
  const termWidth = L.width - qrBandWidth;
  const termLines = (data.terms ?? []).flatMap(s => wrap(s, termWidth, 8.7));
  const qrHeading = wrap(data.verification?.heading ?? 'Verify this invoice', qrTextWidth, 8.7, 'bold');
  const qrText = wrap(data.verification?.explanation, qrTextWidth, 8.5);
  const qrH = qr ? Math.max(qrSize, qrHeading.length * 3.9 + 1 + qrText.length * 3.8) : 0;
  const termsH = termLines.length ? 4.8 + termLines.length * 3.95 : 0;
  if (qrH > limit - 100) throw new Error('Verification explanation is too long for the QR band. Supply a short explanation.');
  if (termLines.length || qr) {
    ensure(Math.max(qrH, Math.min(termsH, 45)));
    const bandPage = page, bandY = y;
    if (termLines.length) label(data.termsHeading ?? 'Dealer terms', 14, y);
    if (qr && data.verification) {
      const xx = 196 - qrSize, module = qrSize / (qr.getModuleCount() + 8);
      doc.setFillColor('#FFFFFF'); doc.rect(xx, y, qrSize, qrSize, 'F'); doc.setFillColor('#000000');
      for (let row = 0; row < qr.getModuleCount(); row++) for (let col = 0; col < qr.getModuleCount(); col++) if (qr.isDark(row, col)) doc.rect(xx + (col + 4) * module, y + (row + 4) * module, module, module, 'F');
      const tx = xx - qrGap - qrTextWidth;
      lines(qrHeading, tx, y + 1, 8.7, 'bold', colours.ink, 3.9);
      lines(qrText, tx, y + 2 + qrHeading.length * 3.9, 8.5, 'normal', colours.muted, 3.8);
      doc.link(xx, y, qrSize, qrSize, { url: data.verification.url });
      events.push({ kind: 'qr', page, x: xx, y, width: qrSize, height: qrSize, text: data.verification.url });
    }
    y += termLines.length ? 4.8 : 0;
    for (const s of termLines) {
      if (y + 3.95 > limit) { next(); label((data.termsHeading ?? 'Dealer terms') + ' - continued', 14, y); y += 4.8; }
      text(s, 14, y, 8.7); y += 3.95;
    }
    if (page === bandPage) y = Math.max(y, bandY + qrH);
  }

  const pageCount = page;
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p); page = p; rule(footerRuleY, 14, 182, colours.muted, 0.18);
    lines(footerLines, 14, footerRuleY + 2, 8.5, 'normal', colours.muted, 3.6);
    const fy = footerRuleY + 2 + footerLines.length * 3.6;
    const numberLines = wrap(data.number, 140, 8.5);
    if (numberLines.length > 1) throw new Error('Invoice number exceeds the footer width.');
    text(data.number, 14, fy, 8.5, 'normal', colours.muted);
    text(`Page ${p} of ${pageCount}`, 196, fy, 8.5, 'normal', colours.muted, 'right');
  }
  doc.setPage(1);
  return { doc, pageCount, events, registration, contentLimit: limit };
}
