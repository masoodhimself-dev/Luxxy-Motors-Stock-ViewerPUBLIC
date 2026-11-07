import { jsPDF } from 'jspdf';
import { ledgerBoldFontBase64, ledgerRegularFontBase64 } from './classic-ledger/fonts.ts';
import { invoicePalette } from './invoice-palette.ts';
import type { SaleWorkspaceBranding } from './sale-workspace.ts';

export type StaffLetter = {
  recipientName: string;
  postalAddress: string;
  subject: string;
  body: string;
  date: string;
};

export class StaffLetterError extends Error {}

const xml = (value: string) => value.replace(/[&<>"]/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]!,
);

function renderLetter(
  letter: StaffLetter,
  branding: SaleWorkspaceBranding,
  fileId: string,
  includePreview: boolean,
) {
  const pdf = new jsPDF({ format: 'a4', unit: 'mm', compress: true, putOnlyUsedFonts: true });
  pdf.addFileToVFS('DejaVuSans.ttf', ledgerRegularFontBase64);
  pdf.addFont('DejaVuSans.ttf', 'Letter', 'normal');
  pdf.addFileToVFS('DejaVuSans-Bold.ttf', ledgerBoldFontBase64);
  pdf.addFont('DejaVuSans-Bold.ttf', 'Letter', 'bold');
  pdf.setFileId(fileId);
  // Keep the transport bytes stable between preview and send.
  pdf.setCreationDate("D:20000101000000+00'00'");
  const name = branding.identity.name || branding.legal.companyName;
  pdf.setProperties({ title: letter.subject, author: name });

  const left = 20, right = 190, width = right - left;
  const palette = invoicePalette(branding.presentation?.linkColour);
  const artwork: string[] = [];
  let page = 1;
  function drawPreview(element: () => string) {
    if (includePreview && page === 1) artwork.push(element());
  }
  function font(size: number, bold: boolean) {
    pdf.setFont('Letter', bold ? 'bold' : 'normal');
    pdf.setFontSize(size);
  }
  function wrap(value: string, maxWidth: number, size: number, bold = false) {
    font(size, bold);
    const glyphs = (pdf.getFont().metadata as { cmap: { unicode: { codeMap: Record<number, number> } } }).cmap.unicode.codeMap;
    const printable = value.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').normalize('NFC');
    for (const character of printable) {
      if (character !== '\n' && !glyphs[character.codePointAt(0)!]) {
        throw new StaffLetterError('Remove any emoji or unsupported characters and preview the letter again.');
      }
    }
    return pdf.splitTextToSize(printable, maxWidth) as string[];
  }
  function text(value: string, x: number, y: number, size: number, bold = false, colour = palette.ink, align: 'left' | 'right' = 'left') {
    font(size, bold);
    pdf.setTextColor(colour);
    pdf.text(value, x, y, { align });
    if (value) drawPreview(() => {
      const anchor = align === 'right' ? 'end' : 'start';
      const length = pdf.getTextWidth(value).toFixed(3);
      return `<text x="${x}" y="${y}" fill="${colour}" font-size="${size * 25.4 / 72}" font-weight="${bold ? 700 : 400}" text-anchor="${anchor}" textLength="${length}" lengthAdjust="spacingAndGlyphs" xml:space="preserve">${xml(value)}</text>`;
    });
  }
  function rule(y: number, colour: string, weight: number) {
    pdf.setLineWidth(weight);
    pdf.setDrawColor(colour);
    pdf.line(left, y, right, y);
    drawPreview(() => `<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" stroke="${colour}" stroke-width="${weight}"/>`);
  }
  function drawLines(lines: string[], x: number, firstBaseline: number, leading: number, size: number, bold = false, colour = palette.ink, align: 'left' | 'right' = 'left') {
    lines.forEach((line, index) => text(line, x, firstBaseline + index * leading, size, bold, colour, align));
  }

  const contact = [branding.contact.phone, branding.contact.email].filter(Boolean);
  const contactLines = contact.flatMap(value => wrap(value, 72, 9));
  const nameLines = wrap(name, 88, 15, true);
  const address = [branding.address.street, branding.address.city, branding.address.region, branding.address.postcode].filter(Boolean).join(', ');
  const legal = [
    branding.legal.companyName || name,
    branding.legal.companyNumber && `Company no. ${branding.legal.companyNumber}`,
    branding.legal.vatNumber && `VAT no. ${branding.legal.vatNumber}`,
  ].filter(Boolean).join('  |  ');
  const footerLines = [address, legal].filter(Boolean).flatMap(value => wrap(value, width - 27, 8.5));
  if (footerLines.length > 5 || nameLines.length > 5 || contactLines.length > 5) {
    throw new StaffLetterError('The dealership’s details are too long for the letterhead. Shorten them in Settings.');
  }

  const logo = /^data:image\/(png|jpeg);base64,[a-z0-9+/]+=*$/i.test(branding.identity.logoAsset) ? branding.identity.logoAsset : '';
  const logoDimensions = logo ? pdf.getImageProperties(logo) : null;
  const logoScale = logoDimensions ? Math.min(64 / logoDimensions.width, 18 / logoDimensions.height) : 0;
  const logoHeight = logoDimensions ? logoDimensions.height * logoScale : 0;
  const headerRule = 15 + Math.max(logoHeight, nameLines.length * 6, contactLines.length * 4.5) + 6;
  const footerRule = 283 - Math.max(1, footerLines.length) * 3.8;
  function letterhead() {
    if (logoDimensions) {
      const logoWidth = logoDimensions.width * logoScale;
      pdf.addImage(logo, logo.startsWith('data:image/png') ? 'PNG' : 'JPEG', left, 15, logoWidth, logoHeight);
      drawPreview(() => `<image href="${logo}" x="${left}" y="15" width="${logoWidth}" height="${logoHeight}"/>`);
    } else {
      drawLines(nameLines, left, 19.5, 6, 15, true);
    }
    drawLines(contactLines, right, 19, 4.5, 9, false, palette.muted, 'right');
    rule(headerRule, palette.strong, 0.4);
  }
  letterhead();

  const date = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' })
    .format(new Date(`${letter.date}T00:00:00Z`));
  const recipient = wrap(letter.recipientName, 105, 11, true);
  const postal = wrap(letter.postalAddress, 105, 10.5).filter(line => line.trim());
  if (postal.length > 10) throw new StaffLetterError('Use up to 10 lines for the postal address.');
  let y = headerRule + 15;
  text(date, right, y, 10, false, palette.muted, 'right');
  drawLines(recipient, left, y, 5, 11, true);
  y += recipient.length * 5;
  drawLines(postal, left, y, 4.7, 10.5);
  y += postal.length * 4.7 + 10;
  const subject = wrap(letter.subject, width, 15, true);
  drawLines(subject, left, y, 6, 15, true);
  y += subject.length * 6 + 5;

  for (const line of wrap(letter.body, width, 11)) {
    if (y > footerRule - 9) {
      if (!line.trim()) continue;
      pdf.addPage();
      page++;
      letterhead();
      y = headerRule + 15;
    }
    if (line.trim()) text(line, left, y, 11);
    y += 5.2;
  }

  const pages = pdf.getNumberOfPages();
  for (page = 1; page <= pages; page++) {
    pdf.setPage(page);
    rule(footerRule, palette.rule, 0.25);
    drawLines(footerLines, left, footerRule + 4.8, 3.8, 8.5, false, palette.muted);
    if (pages > 1) text(`Page ${page} of ${pages}`, right, footerRule + 4.8, 8.5, false, palette.muted, 'right');
  }
  return {
    pdf: new Uint8Array(pdf.output('arraybuffer')),
    previewSvg: includePreview
      ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210 297" font-family="DejaVu Sans, Arial, sans-serif"><rect width="210" height="297" fill="white"/>${artwork.join('')}</svg>`
      : '',
  };
}

export function renderStaffLetter(letter: StaffLetter, branding: SaleWorkspaceBranding, fileId: string): Uint8Array {
  return renderLetter(letter, branding, fileId, false).pdf;
}

/** Use the PDF's first-page positions and line breaks in browsers without a PDF viewer. */
export function renderStaffLetterPreview(letter: StaffLetter, branding: SaleWorkspaceBranding, fileId: string) {
  return renderLetter(letter, branding, fileId, true);
}
