import { jsPDF } from 'jspdf';
import { ledgerRegularFontBase64, ledgerBoldFontBase64 } from './classic-ledger/fonts.ts';
import { APPROVED_COLOURS, LAYOUT } from './classic-ledger/layout.ts';
import { invoicePalette } from './invoice-palette.ts';
import type { SalesTermsCopies, SalesTermsSnapshot } from './full-sales-terms.ts';

/** The same A4 stationery, embedded body fonts, margins and accent as the invoice. No fetch or live settings. */
export function renderFullSalesTerms(snapshot: SalesTermsSnapshot, copies: SalesTermsCopies = 'dealer') {
  if (snapshot.rendererVersion !== 'classic-ledger-terms-v1') throw new Error('Unsupported terms layout.');
  if (copies !== 'dealer' && copies !== 'both') throw new Error('Choose dealer copy or both copies.');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: false, putOnlyUsedFonts: true, precision: 5 });
  doc.addFileToVFS('DejaVuSans.ttf', ledgerRegularFontBase64); doc.addFont('DejaVuSans.ttf', 'Ledger', 'normal');
  doc.addFileToVFS('DejaVuSans-Bold.ttf', ledgerBoldFontBase64); doc.addFont('DejaVuSans-Bold.ttf', 'Ledger', 'bold');
  const pt = 25.4 / 72, b = snapshot.branding, ink = APPROVED_COLOURS.ink, muted = APPROVED_COLOURS.muted;
  const accent = invoicePalette(b.presentation?.linkColour).strong, limit = LAYOUT.contentLimit - 4;
  doc.setCreationDate(new Date(snapshot.issuedAt));
  doc.setFileId(snapshot.termsVersionId.replace(/[^a-f0-9]/gi, '').padEnd(32, '0').slice(0, 32));
  doc.setProperties({ title: `${snapshot.title} - ${snapshot.saleReference}`, author: b.identity.name, subject: 'Vehicle sale terms' });
  const events: Array<{ text: string; page: number; y: number; height: number }> = [], copyPages: Array<{ page: number; label: string; number: number; total: number }> = [];
  let page = 1, y = 0, copyLabel = '';
  function font(size = 9.2, bold = false) { doc.setFont('Ledger', bold ? 'bold' : 'normal'); doc.setFontSize(size); }
  function glyphs(s: string) {
    const cmap = (doc.getFont().metadata as { cmap?: { unicode?: { codeMap?: Record<number, number> } } }).cmap?.unicode?.codeMap;
    if (!cmap) throw new Error('The invoice font could not be loaded.');
    for (const character of s) if (!/\s/.test(character) && !cmap[character.codePointAt(0)!]) throw new Error('The terms contain a character unsupported by the invoice font.');
  }
  function text(s: string, x: number, top: number, size = 9.2, bold = false, colour: string = ink, align: 'left' | 'right' = 'left') {
    font(size, bold); glyphs(s); doc.setTextColor(colour); doc.text(s, x, top + size * pt * .8, { align });
    events.push({ text: s, page, y: top, height: size * pt });
  }
  function wrapped(s: string, width = 182, size = 9.2, bold = false): string[] {
    font(size, bold); glyphs(s);
    // jsPDF does measured word wrapping and splits unbroken input to the available width.
    return doc.splitTextToSize(s, width) as string[];
  }
  function rule(top: number, colour: string = APPROVED_COLOURS.rule) { doc.setDrawColor(colour); doc.setLineWidth(.2); doc.line(14, top, 196, top); }
  function header() {
    const logo = b.invoiceSettings?.showLogo !== false && /^data:image\/(png|jpeg);base64,/.test(b.identity.logoAsset) ? b.identity.logoAsset : '';
    if (logo) { const p = doc.getImageProperties(logo), factor = Math.min(38 / p.width, 12 / p.height); doc.addImage(logo, logo.startsWith('data:image/png') ? 'PNG' : 'JPEG', 14, 11, p.width * factor, p.height * factor); }
    else { const nameLines = wrapped(b.identity.name || b.legal.companyName, 85, 12.4, true); if (nameLines.length > 2) throw new Error('The dealership name is too long for the invoice header.'); nameLines.forEach((line, i) => text(line, 14, 14 + i * 5, 12.4, true)); }
    font(9.5, true); if (doc.getTextWidth(snapshot.saleReference) > 84) throw new Error('The sale reference is too long for the invoice header.');
    text(copyLabel, 196, 14.5, 12, true, ink, 'right');
    text(snapshot.saleReference, 196, 22, 9.5, true, ink, 'right');
    text(`Terms version ${snapshot.termsVersion}`, 196, 27, 8.5, false, muted, 'right');
    text(snapshot.draft ? 'Review draft - not issued' : new Date(snapshot.issuedAt).toLocaleDateString('en-GB', { timeZone: 'Europe/London' }), 14, 29, 8.7, true, accent);
    rule(36, accent); y = 41;
    const identity = [snapshot.customer, snapshot.vehicle, snapshot.registration].filter(Boolean).join(' | ');
    for (const line of wrapped(identity, 182, 8.7)) { text(line, 14, y, 8.7); y += 3.8; }
    y += 3; if (y > 85) throw new Error('The repeated customer and vehicle identification is too long.');
  }
  function next() { doc.addPage(); page++; header(); }
  function ensure(h: number) { if (y + h > limit) next(); }
  function para(s: string, size = 9.2, bold = false, leading = 4.1) { for (const line of wrapped(s, 182, size, bold)) { ensure(leading); text(line, 14, y, size, bold); y += leading; } }
  for (const label of copies === 'both' ? ['Dealer copy', 'Customer copy'] : ['Dealer copy']) {
    copyLabel = label;
    if (copyPages.length) { doc.addPage(); page++; }
    const firstPage = page; header();
    ensure(12); para(snapshot.title, 14, true, 6); y += 3;
    if (snapshot.customerAddress) { para(`Customer address: ${snapshot.customerAddress}`, 8.7, false, 3.8); y += 3; }
    for (const section of snapshot.sections) {
      const heading = wrapped(section.heading, 182, 9.8, true);
      ensure(heading.length * 4.5 + 9);
      for (const line of heading) { text(line, 14, y, 9.8, true, accent); y += 4.5; }
      for (const paragraph of section.paragraphs) { para(paragraph); y += 2; }
      y += 2;
    }
    ensure(29); rule(y); y += 7;
    text('Customer signature', 14, y, 8.5, false, muted); text('Date', 151, y, 8.5, false, muted); y += 14;
    doc.setDrawColor(APPROVED_COLOURS.rule); doc.line(14, y, 138, y); doc.line(151, y, 196, y);
    const total = page - firstPage + 1;
    for (let p = firstPage; p <= page; p++) copyPages.push({ page: p, label, number: p - firstPage + 1, total });
  }
  for (const p of copyPages) {
    doc.setPage(p.page); page = p.page; rule(274.5);
    const footer = wrapped([b.legal.companyName, b.legal.companyNumber ? `Company ${b.legal.companyNumber}` : '', b.legal.vatNumber ? `VAT ${b.legal.vatNumber}` : ''].filter(Boolean).join(' | '), 182, 8);
    if (footer.length > 2) throw new Error('The dealership identifiers are too long for the invoice footer.');
    footer.forEach((line, i) => text(line, 14, 278 + i * 3.3, 8, false, muted));
    text(`${p.label} | Page ${p.number} of ${p.total}`, 196, 284, 8, false, muted, 'right');
  }
  return { doc, events, copyPages };
}
export function fullSalesTermsPdfBytes(snapshot: SalesTermsSnapshot, copies: SalesTermsCopies = 'dealer'): Uint8Array {
  return new Uint8Array(renderFullSalesTerms(snapshot, copies).doc.output('arraybuffer'));
}
