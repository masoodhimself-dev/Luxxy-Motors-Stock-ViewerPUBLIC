import { registrationPdfFontName } from '../../../lib/vehicle-meta/src/registration-plate-pdf';
import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { jsPDF } from 'jspdf';
import { saleDocumentPdfBytes } from '@workspace/vehicle-meta/sale-document-pdf';
import { compactInvoicePdf } from '../../../lib/vehicle-meta/src/legacy-compact-invoice-pdf';
import { createSaleWorkspace, changeSaleWorkspace, defaultInvoiceSettings, invoiceBranding, invoicePalette, saleWorkspaceTotals, type SaleWorkspaceContext, type SaleWorkspaceDraft, type SaleWorkspaceDocument, type SaleWorkspacePayment } from '@workspace/vehicle-meta';
import { saleDocumentPdf } from './lib/sale-document-pdf';
const draft: SaleWorkspaceDraft = { id: 'draft-test', customer: 'Jamie Taylor', email: '', phone: '', address: '12 Station Road, London', vehicleId: 'test-car', vehicle: '2018 Touring Estate', registration: 'AB18 XYZ', price: '12000', partExchange: false, pxRegistration: '', pxDescription: '', pxValue: '', deposit: '', paymentMethod: '', notes: '', collection: '', preparation: false, documents: false, handover: false, adjustments: [{ description: 'Agreed delivery', amount: '100', kind: 'fee' }], exchanges: [] };
let id = 0;
const context: SaleWorkspaceContext = { now: '2026-10-10T10:00:00.000Z', actor: 'Test staff', nextId: () => `id-${++id}`, nextNumber: type => `${type}-${++id}`, branding: { invoiceSettings: { ...defaultInvoiceSettings }, identity: { name: 'Northfield Motors', logoText: 'NORTHFIELD', logoAsset: '' }, contact: { phone: '', email: '' }, address: { street: '24 Station Road', city: 'London', region: '', postcode: '' }, legal: { companyName: '', companyNumber: '', vatNumber: '' }, presentation: { linkColour: '#215a7e' } }, vehicle: { year: 2018, fuel: 'Petrol', transmission: 'Automatic', mileage: 42000 } };

const pageCount = (text: string) => (text.match(/\/Type \/Page\b/g) ?? []).length;
const pdfStreams = (text: string) => [...text.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(match => match[1]);
const literalText = (text: string) => text.replace(/\\([()\\])/g, '$1');
type TextRow = { text: string; x: number; y: number; width: number; size: number; page: number; family: string };
// Read the actual uncompressed PDF text positions, rather than pinning a layout to
// exact panel counts or coordinates. Font metrics then catch clipped long values.
function textRows(text: string): TextRow[] {
  const metrics = new jsPDF({ unit: 'pt', format: 'a4' });
  const builtInFonts = metrics.getFontList();
  type Font = { family: string; style: string; glyphCharacters?: Map<number, string>; glyphWidths?: Map<number, number> };
  const fontById = new Map<string, Font>();
  let fontIndex = 1;
  for (const family of ['helvetica', 'courier', 'times']) for (const style of builtInFonts[family]) fontById.set(`F${fontIndex++}`, { family, style });
  const objects = new Map([...text.matchAll(/(?:^|\n)(\d+) 0 obj\r?\n([\s\S]*?)\r?\nendobj/g)].map(match => [Number(match[1]), match[2]]));
  const objectStream = (object: string) => object.match(/stream\r?\n([\s\S]*?)\r?\nendstream/)?.[1] ?? '';
  // Read each embedded font's own ToUnicode and advance-width tables. Ledger and
  // plate fonts can use the same glyph IDs for entirely different characters.
  // This also measures the actual PDF widths instead of substituting Helvetica.
  for (const resource of text.matchAll(/\/(F\d+)\s+(\d+) 0 R/g)) {
    const object = objects.get(Number(resource[2])) ?? '';
    if (!/\/Subtype \/Type0\b/.test(object)) continue;
    const family = object.match(/\/BaseFont \/([^\s/]+)/)?.[1];
    const unicodeObject = object.match(/\/ToUnicode (\d+) 0 R/);
    const descendant = object.match(/\/DescendantFonts \[\s*(\d+) 0 R/);
    assert.ok(family && unicodeObject && descendant, `Embedded font ${resource[1]} has readable metrics`);
    const glyphCharacters = new Map<number, string>();
    const unicode = objectStream(objects.get(Number(unicodeObject[1])) ?? '');
    for (const block of unicode.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const pair of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
        glyphCharacters.set(parseInt(pair[1], 16), (pair[2].match(/.{4}/g) ?? []).map(code => String.fromCharCode(parseInt(code, 16))).join(''));
      }
    }
    const widthsObject = objects.get(Number(descendant[1])) ?? '';
    const glyphWidths = new Map<number, number>();
    const widthTable = widthsObject.match(/\/W \[([\s\S]*?)\]\s*(?:\n|\/|>>)/)?.[1] ?? '';
    for (const entry of widthTable.matchAll(/(\d+) \[([^\]]+)\]/g)) {
      const first = Number(entry[1]);
      entry[2].trim().split(/\s+/).forEach((width, index) => glyphWidths.set(first + index, Number(width)));
    }
    assert.ok(glyphCharacters.size && glyphWidths.size, `${family} includes embedded character maps and widths`);
    fontById.set(resource[1], { family, style: 'normal', glyphCharacters, glyphWidths });
  }
  const pages = [...objects.values()].filter(object => /\/Type \/Page\b/.test(object));
  const rows: TextRow[] = [];
  for (const [page, pageObject] of pages.entries()) {
    const contentId = pageObject.match(/\/Contents (\d+) 0 R/);
    assert.ok(contentId, 'Every page has a readable content stream');
    const stream = objectStream(objects.get(Number(contentId[1])) ?? '');
    for (const block of stream.matchAll(/BT\n([\s\S]*?)\nET/g)) {
      const source = block[1], foundFont = source.match(/\/(F\d+) ([\d.]+) Tf/);
      assert.ok(foundFont, 'Every text block declares its font and size');
      const font = fontById.get(foundFont[1]);
      assert.ok(font, `Font ${foundFont[1]} is supported by the PDF bounds reader`);
      const size = Number(foundFont[2]);
      if (!font.glyphWidths) { metrics.setFont(font.family, font.style); metrics.setFontSize(size); }
      let x = 0, y = 0, leading = size * 1.15;
      for (const operation of source.matchAll(/(-?[\d.]+) (-?[\d.]+) Td|([\d.]+) TL|\(((?:\\.|[^\\)])*)\) Tj|(T\*)|<([0-9a-fA-F]+)> Tj/g)) {
        if (operation[1] !== undefined) { x += Number(operation[1]); y += Number(operation[2]); }
        else if (operation[3] !== undefined) leading = Number(operation[3]);
        else if (operation[4] !== undefined) {
          const row = literalText(operation[4]);
          rows.push({ text: row, x, y, size, width: metrics.getTextWidth(row), page, family: font.family });
        } else if (operation[5]) y -= leading;
        else if (operation[6]) {
          assert.ok(font.glyphCharacters && font.glyphWidths, 'Glyph-encoded text has its own embedded font metrics');
          const glyphs = (operation[6].match(/.{4}/g) ?? []).map(glyph => parseInt(glyph, 16));
          const row = glyphs.map(glyph => font.glyphCharacters!.get(glyph) ?? '\uFFFD').join('');
          assert.ok(!row.includes('\uFFFD'), `Every ${font.family} glyph maps to selectable Unicode text`);
          const width = glyphs.reduce((sum, glyph) => sum + (font.glyphWidths!.get(glyph) ?? 0), 0) / 1000 * size;
          rows.push({ text: row, x, y, size, width, page, family: font.family });
        }
      }
    }
  }
  assert.ok(rows.length > 0, 'The PDF includes measurable text rows');
  return rows;
}
function readablePdfText(text: string) { return [text,...textRows(text).map(row=>row.text)].join('\n'); }
function assertTextOnA4(text: string) {
  for (const row of textRows(text)) {
    assert.ok(row.x >= -0.1, `Text crosses the left page edge: ${row.text}`);
    assert.ok(row.x + row.width <= 595.28 + 0.1, `Text crosses the right page edge: ${row.text}`);
    assert.ok(row.y >= -0.1 && row.y + row.size <= 841.89 + 0.1, `Text crosses a vertical page edge: ${row.text}`);
  }
}
function assertRowsDoNotCollide(text: string) {
  const rows = textRows(text).filter(row => row.text.trim());
  rows.forEach((row, index) => {
    for (const other of rows.slice(index + 1)) {
      if (row.page !== other.page || Math.abs(row.y - other.y) > 0.1) continue;
      assert.ok(row.x + row.width <= other.x + 0.1 || other.x + other.width <= row.x + 0.1, `Text rows overlap: "${row.text}" and "${other.text}"`);
    }
  });
}
function filledRectangles(text: string) {
  const mmPerPoint = 25.4 / 72;
  return pdfStreams(text).flatMap(stream => [...stream.matchAll(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re\n(?:f|f\*|B|B\*)\b/g)].map(match => {
    const width = Math.abs(Number(match[3])) * mmPerPoint, height = Math.abs(Number(match[4])) * mmPerPoint;
    return { width, height, area: width * height };
  }));
}
function invoiceDocument(inputDraft = draft, inputContext = context): SaleWorkspaceDocument {
  const number = ++id;
  const sale = createSaleWorkspace({ draft: inputDraft, requestId: `design-create-${number}` }, inputContext, `SALE-DESIGN-${number}`).sale;
  const result = changeSaleWorkspace(sale, { action: 'document', type: 'invoice' }, { expectedRevision: sale.revision, requestId: `design-invoice-${number}` }, inputContext);
  assert.ok(result.document);
  return result.document;
}
test('branded PDF is deterministic, A4 and contains issued totals and page references', () => {
  const sale = createSaleWorkspace({ draft, requestId: 'test-create' }, context, 'SALE-TEST-001').sale;
  const result = changeSaleWorkspace(sale, { action: 'document', type: 'invoice' }, { expectedRevision: sale.revision, requestId: 'test-invoice' }, context);
  assert.ok(result.document);
  const bytes = saleDocumentPdf(result.document);
  assert.deepEqual(bytes, saleDocumentPdf(result.document));
  const text = bytes.toString('latin1');
  assert.match(readablePdfText(text), /Northfield Motors/); assert.match(readablePdfText(text), /£12,100.00/); assert.match(readablePdfText(text), /(?:\b1\s*\/\s*1\b|Page 1 of 1)/); const box = text.match(/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/); assert.ok(box); assert.ok(Math.abs(Number(box[1]) - 595.28) < .01); assert.ok(Math.abs(Number(box[2]) - 841.89) < .01);
  assert.doesNotMatch(readablePdfText(text), /Issued document|GBP|Payments at issue|draft-test|Separate receipts record payments/);
  const sameRenderer = saleDocumentPdfBytes(result.document, { fileId: createHash('sha256').update(result.document.id).digest('hex').slice(0, 32) });
  assert.deepEqual(bytes, Buffer.from(sameRenderer));
  if (process.env.LUXXY_PDF_SAMPLE_PATH) {
    const exampleDraft = { ...result.document.snapshot.draft, vehicle: '2018 BMW 320i M Sport Touring', customer: 'Jamie Taylor', address: '12 Example Close\nLondon', email: 'jamie@example.test', phone: '07700 900123',
      adjustments: [...(draft.adjustments ?? []), { description: 'Agreed discount', amount: '250', kind: 'discount' as const }],
      exchanges: [{ registration: 'CD14 EXM', description: '2014 Volkswagen Golf', value: '3000' }],
    };
    const examplePayments = [{ id: 'example-payment', amount: '1000.00', amountPence: 100000, signedAmountPence: 100000, method: 'Bank transfer', date: '2026-10-10', reference: 'DEPOSIT-0018', kind: 'deposit' as const, status: 'confirmed' as const, recordedBy: '', recordedAt: context.now }];
    const exampleTotals = saleWorkspaceTotals(exampleDraft, examplePayments);
    const example = { ...result.document, number: 'INV-2026-0018', balanceAtIssue: exampleTotals.balance, snapshot: { ...result.document.snapshot,
      draft: exampleDraft, totals: exampleTotals, payments: examplePayments,
      branding: invoiceBranding({ ...result.document.snapshot.branding, contact: { phone: '020 7946 0123', email: 'sales@northfield.example' } }, { ...defaultInvoiceSettings, footer: 'Thank you for choosing Northfield Motors.', paymentInstructions: 'Please quote your invoice number with your payment.' }),
      vehicle: { ...result.document.snapshot.vehicle, colour: 'Mineral Grey' },
    } };
    writeFileSync(process.env.LUXXY_PDF_SAMPLE_PATH, saleDocumentPdf(example));
  }
});

test('receipt leads with its own payment and does not repeat other payment references or the charge ledger', () => {
  const sale = createSaleWorkspace({ draft, requestId: 'receipt-create' }, context, 'SALE-TEST-RECEIPT').sale;
  const deposit = changeSaleWorkspace(sale, { action: 'payment', payment: { amount: '500', method: 'Bank transfer', date: '2026-10-10', reference: 'DEPOSIT-ONLY-REF', kind: 'deposit', status: 'confirmed' } }, { expectedRevision: sale.revision, requestId: 'receipt-deposit' }, context);
  const later = changeSaleWorkspace(deposit.sale, { action: 'payment', payment: { amount: '1500', method: 'Cash', date: '2026-10-10', reference: 'SECOND-PAYMENT-REF', kind: 'part-payment', status: 'confirmed' } }, { expectedRevision: deposit.sale.revision, requestId: 'receipt-second' }, context);
  assert.ok(later.document);
  const text = saleDocumentPdf(later.document).toString('latin1');
  assert.match(readablePdfText(text), /PAYMENT RECEIVED/); assert.match(readablePdfText(text), /£1,500.00/); assert.match(readablePdfText(text), /SECOND-PAYMENT-REF/); assert.match(readablePdfText(text), /£10,100.00/);
  for (const value of ['10 Oct 2026', 'Cash', 'part payment', '£2,000.00', 'AB18 XYZ']) assert.ok(readablePdfText(text).includes(value), `Receipt retains its payment and vehicle context: ${value}`);
  assert.doesNotMatch(readablePdfText(text), /DEPOSIT-ONLY-REF|Vehicle price|AGREED SALE|PAYMENT HISTORY/);
  assert.ok(text.indexOf('PAYMENT RECEIVED') < text.indexOf('BALANCE REMAINING'));
  assert.equal(pageCount(text), 1); assertTextOnA4(text);
  if (process.env.LUXXY_PDF_QA_DIR) writeFileSync(`${process.env.LUXXY_PDF_QA_DIR}/receipt.pdf`, saleDocumentPdf(later.document));
});

test('only statements show the complete ledger and pending money is not credited', () => {
  const sale = createSaleWorkspace({ draft, requestId: 'statement-create' }, context, 'SALE-TEST-STATEMENT').sale;
  const pending = changeSaleWorkspace(sale, { action: 'payment', payment: { amount: '300', method: 'Bank transfer', date: '2026-10-10', reference: 'AWAITING-CLEARANCE', kind: 'part-payment', status: 'pending' } }, { expectedRevision: sale.revision, requestId: 'statement-payment' }, context);
  const statement = changeSaleWorkspace(pending.sale, { action: 'document', type: 'statement' }, { expectedRevision: pending.sale.revision, requestId: 'statement-issue' }, context);
  assert.ok(statement.document);
  const text = saleDocumentPdf(statement.document).toString('latin1');
  assert.match(readablePdfText(text), /PAYMENT HISTORY/); assert.match(readablePdfText(text), /AWAITING-CLEARANCE/); assert.match(readablePdfText(text), /£12,100.00/); assert.match(readablePdfText(text), /These have not reduced the balance/);
});

test('long terms continue across A4 pages without leaking staff notes or reprinting sale charges', () => {
  const sale = createSaleWorkspace({ draft: { ...draft, notes: 'Private staff-only comment' }, requestId: 'terms-create' }, context, 'SALE-TEST-TERMS').sale;
  const invoice = changeSaleWorkspace(sale, { action: 'document', type: 'invoice' }, { expectedRevision: sale.revision, requestId: 'terms-invoice' }, context);
  assert.ok(invoice.document);
  const terms = { ...invoice.document, type: 'terms' as const, title: 'Terms and conditions of sale', content: Array.from({ length: 90 }, (_, index) => `Clause ${index + 1}: These are fictional test terms for the supplied vehicle sale, collection and delivery arrangements.`).join('\n') };
  const before = JSON.stringify(terms);
  const text = saleDocumentPdf(terms).toString('latin1');
  assert.ok((text.match(/\/Type \/Page\b/g) ?? []).length > 1);
  assert.match(readablePdfText(text), /Clause 90/); assert.doesNotMatch(readablePdfText(text), /Vehicle price|Private staff-only comment|PAYMENT HISTORY/);
  assert.equal(JSON.stringify(terms), before);
  if (process.env.LUXXY_PDF_QA_DIR) writeFileSync(`${process.env.LUXXY_PDF_QA_DIR}/terms.pdf`, saleDocumentPdf(terms));
});

test('invoice renderer never fetches a remote logo and retains dealer wordmark fallback', () => {
  const sale = createSaleWorkspace({ draft, requestId: 'logo-create' }, { ...context, branding: { ...context.branding, identity: { ...context.branding.identity, logoAsset: 'https://remote.example.test/logo.png' } } }, 'SALE-TEST-LOGO').sale;
  const result = changeSaleWorkspace(sale, { action: 'document', type: 'invoice' }, { expectedRevision: sale.revision, requestId: 'logo-invoice' }, context);
  assert.ok(result.document);
  assert.match(readablePdfText(saleDocumentPdf(result.document).toString('latin1')), /Northfield Motors/);
});

test('archive includes immutable invoice instructions and footer settings', async () => {
  const { defaultInvoiceSettings, invoiceBranding } = await import('@workspace/vehicle-meta');
  const settings = { ...defaultInvoiceSettings, style: 'premium' as const, footer: 'Thank you for choosing Northfield.', paymentInstructions: 'Please contact accounts to confirm bank details.' };
  const styled = { ...context, branding: invoiceBranding(context.branding, settings) };
  const sale = createSaleWorkspace({ draft, requestId: 'styled-create' }, styled, 'SALE-TEST-002').sale;
  const result = changeSaleWorkspace(sale, { action: 'document', type: 'invoice' }, { expectedRevision: sale.revision, requestId: 'styled-invoice' }, styled);
  assert.ok(result.document);
  settings.footer = 'Later wording';
  const bytes = saleDocumentPdf(result.document);
  assert.match(readablePdfText(bytes.toString('latin1')), /Thank you for choosing Northfield/);
  assert.match(readablePdfText(bytes.toString('latin1')), /Please contact accounts to confirm bank details/);
  assert.doesNotMatch(readablePdfText(bytes.toString('latin1')), /Later wording/);
});

test('drafts are identified without claiming an empty draft is paid, and ink saving removes filled panels', async () => {
  const sale = createSaleWorkspace({ draft, requestId: 'draft-design-create' }, context, 'SALE-TEST-DRAFT').sale;
  const result = changeSaleWorkspace(sale, { action: 'document', type: 'invoice' }, { expectedRevision: sale.revision, requestId: 'draft-design-invoice' }, context);
  assert.ok(result.document);
  const empty = { ...result.document, balanceAtIssue: 0, snapshot: { ...result.document.snapshot, totals: { ...result.document.snapshot.totals, totalDue: 0, confirmedPaid: 0 } } };
  const draftPdf = Buffer.from(saleDocumentPdfBytes(empty, { draft: true })).toString('latin1');
  assert.match(readablePdfText(draftPdf), /Draft/i);
  assert.doesNotMatch(readablePdfText(draftPdf), /Paid in full|ISSUED ON/);
  const { defaultInvoiceSettings, invoiceBranding } = await import('@workspace/vehicle-meta');
  const light = { ...result.document, snapshot: { ...result.document.snapshot, branding: invoiceBranding(result.document.snapshot.branding, { ...defaultInvoiceSettings, inkSaving: true }) } };
  const premiumFills = filledRectangles(saleDocumentPdf(result.document).toString('latin1'));
  const lightFills = filledRectangles(saleDocumentPdf(light).toString('latin1'));
  assert.equal(premiumFills.filter(rectangle => Math.min(rectangle.width, rectangle.height) > 2).length, 0, 'Classic ledger uses white stationery rather than filled panels');
  const lightText = saleDocumentPdf(light).toString('latin1');
  const inkColours = [...lightText.matchAll(/(?:^|\n)([\d.]+) ([\d.]+) ([\d.]+) (?:rg|RG)(?=\n)/g)];
  for (const colour of inkColours) assert.ok(Math.abs(Number(colour[1])-Number(colour[2])) < .001 && Math.abs(Number(colour[2])-Number(colour[3])) < .001, 'Ink-saving text and rules use neutral grayscale');
  assert.equal(lightFills.filter(rectangle => Math.min(rectangle.width, rectangle.height) > 2).length, 0, 'Ink saving has no filled panels; thin rules are allowed');
  for (const value of ['Northfield Motors', 'Jamie Taylor', 'AB18 XYZ', '£12,100.00']) assert.ok(readablePdfText(saleDocumentPdf(light).toString('latin1')).includes(value), `Ink saving preserves ${value}`);
});

test('ordinary invoice with three PX cars, three adjustments, contact details and collection stays on one A4 page', () => {
  const detailedDraft = { ...draft, price: '15000', email: 'alex@example.test', phone: '07700 900123', address: '10 Example Road\nHarrow\nHA1 1AA', collection: '2026-10-20',
    exchanges: [{ registration: 'PX11 AAA', description: 'Example Hatchback', value: '3000' }, { registration: 'PX12 BBB', description: 'Example Estate', value: '1250' }, { registration: 'PX13 CCC', description: 'Example City', value: '500' }],
    adjustments: [{ description: 'Delivery to agreed address', amount: '150', kind: 'fee' as const }, { description: 'Administration agreed with buyer', amount: '50', kind: 'fee' as const }, { description: 'Agreed discount', amount: '250', kind: 'discount' as const }],
  };
  const details = { ...context, branding: { ...context.branding, contact: { phone: '020 7946 0123', email: 'sales@example.test' }, address: { street: '25 Showroom Road', city: 'Harrow', region: 'London', postcode: 'HA2 2BB' }, legal: { companyName: 'Example Motors Limited', companyNumber: 'TEST012345', vatNumber: '' } } };
  const sale = createSaleWorkspace({ draft: detailedDraft, requestId: 'normal-full-create' }, details, 'SALE-TEST-FULL').sale;
  const result = changeSaleWorkspace(sale, { action: 'document', type: 'invoice' }, { expectedRevision: sale.revision, requestId: 'normal-full-invoice' }, details);
  assert.ok(result.document);
  const text = saleDocumentPdf(result.document).toString('latin1');
  assert.equal((text.match(/\/Type \/Page\b/g) ?? []).length, 1);
  for (const value of ['PX11 AAA', 'PX12 BBB', 'PX13 CCC', 'Administration agreed with buyer', 'Agreed discount', 'Example Motors Limited', 'TEST012345', '20 Oct 2026', '£10,200.00']) assert.ok(readablePdfText(text).includes(value), value);
  for (const value of ['£15,000.00', '£150.00', '£50.00', '-£250.00', '-£3,000.00', '-£1,250.00', '-£500.00']) assert.ok(readablePdfText(text).includes(value), `The full agreed price breakdown retains ${value}`);
  assertTextOnA4(text);
  if (process.env.LUXXY_PDF_QA_DIR) writeFileSync(`${process.env.LUXXY_PDF_QA_DIR}/three-px-invoice.pdf`, saleDocumentPdf(result.document));
});

test('long dealer and customer details remain complete and inside A4 boundaries', () => {
  const dealer = 'Northfield and Westborough Specialist Motor Company Limited - Independent Prestige and Family Vehicle Sales Centre';
  const customer = 'Alexandra Catherine Pennington-Worthington';
  const longDraft = { ...draft, customer, vehicle: '2018 Mercedes-Benz E-Class E 350 d AMG Line Premium Plus Estate',
    email: 'alexandra.pennington@example.test', phone: '07700 900123',
    address: 'Apartment 14, The Old Coach House\n187 Westborough Avenue\nLittle Northfield\nGreater London\nNW12 8XY', notes: 'NEVER PRINT PRIVATE WORKSPACE NOTES',
  };
  const branded = { ...context, branding: { ...context.branding, identity: { ...context.branding.identity, name: dealer },
    contact: { phone: '020 7946 0123', email: 'sales@northfield-westborough.example.test' },
    address: { street: 'Unit 18, Westborough Specialist Motor Centre', city: 'Little Northfield', region: 'Greater London', postcode: 'NW12 8AB' },
    legal: { companyName: dealer, companyNumber: 'TEST012345', vatNumber: 'TEST987654321' },
  } };
  const document = invoiceDocument(longDraft, branded);
  const before = JSON.stringify(document), text = saleDocumentPdf(document).toString('latin1');
  const rows = textRows(text);
  // Party columns are drawn one physical line at a time. Read each column in
  // order rather than interleaving a dealer address into a wrapped customer name.
  const readableColumns = [rows, rows.filter(row=>row.x<100*72/25.4), rows.filter(row=>row.x>=100*72/25.4)].map(column=>column.map(row=>row.text).join(' ').replace(/\s+/g,''));
  for (const supplied of [dealer, customer, longDraft.vehicle, 'The Old Coach House', '187 Westborough Avenue', 'NW12 8XY', 'sales@northfield-westborough.example.test']) assert.ok(readableColumns.some(column=>column.includes(supplied.replace(/\s+/g,''))), `No clipping or omitted supplied detail: ${supplied}`);
  assert.doesNotMatch(readablePdfText(text), /NEVER PRINT PRIVATE WORKSPACE NOTES/);
  assertTextOnA4(text);
  assertRowsDoNotCollide(text);
  assert.equal(JSON.stringify(document), before, 'Rendering cannot mutate the archived snapshot');
  assert.deepEqual(saleDocumentPdf(document), saleDocumentPdf(document));
});

test('long supplied terms title and continuation header stay on the page', () => {
  const original = invoiceDocument();
  const document: SaleWorkspaceDocument = { ...original, type: 'terms', title: 'Terms and conditions of this vehicle purchase, payment and delivery agreement',
    snapshot: { ...original.snapshot, branding: { ...original.snapshot.branding, identity: { ...original.snapshot.branding.identity, name: 'Northfield and Westborough Specialist Motor Company Limited' } } },
    content: Array.from({ length: 75 }, (_, index) => `Clause ${index + 1}: Fictional supplied terms describe the agreed arrangements without changing the recorded financial figures.`).join('\n'),
  };
  const text = saleDocumentPdf(document).toString('latin1');
  const allText = textRows(text).map(row => row.text).join(' ');
  assert.ok(pageCount(text) > 1);
  assert.ok(allText.includes(document.title), 'The complete title is retained when it wraps');
  assert.match(readablePdfText(text), /Clause 75/);
  assertTextOnA4(text);
  assertRowsDoNotCollide(text);
});

test('large supported monetary amount remains exact and fits every summary column', () => {
  const document = invoiceDocument({ ...draft, price: '9999999999999.99', adjustments: [] });
  const text = saleDocumentPdf(document).toString('latin1');
  assert.match(readablePdfText(text), /£9,999,999,999,999\.99/);
  assert.doesNotMatch(readablePdfText(text), /Check amount|NaN|Infinity/);
  assert.equal(pageCount(text), 1);
  assertTextOnA4(text);
});

test('dense statement retains all payment references and flows to additional A4 pages', () => {
  const original = invoiceDocument({ ...draft, price: '20000', adjustments: [] });
  const payments: SaleWorkspacePayment[] = Array.from({ length: 36 }, (_, index) => ({
    id: `statement-payment-${index}`, amount: '100.00', amountPence: 10000, signedAmountPence: 10000,
    method: index % 2 ? 'Cash' : 'Bank transfer', date: '2026-10-10', reference: `LEDGER-ROW-${String(index + 1).padStart(2, '0')}`,
    kind: 'part-payment', status: 'confirmed', recordedBy: 'STAFF-IDENTITY-PRIVATE', recordedAt: context.now,
  }));
  const totals = saleWorkspaceTotals(original.snapshot.draft, payments);
  const document: SaleWorkspaceDocument = { ...original, type: 'statement', title: 'Statement', balanceAtIssue: totals.balance,
    snapshot: { ...original.snapshot, payments, totals },
  };
  const text = saleDocumentPdf(document).toString('latin1');
  assert.ok(pageCount(text) > 1);
  for (const payment of payments) assert.ok(readablePdfText(text).includes(payment.reference), `Statement retains ${payment.reference}`);
  assert.match(readablePdfText(text), /£3,600\.00/); assert.match(readablePdfText(text), /£16,400\.00/);
  assert.doesNotMatch(readablePdfText(text), /STAFF-IDENTITY-PRIVATE/);
  assertTextOnA4(text);
});

test('saved dealer colours vary the design without changing document text or financial amounts', () => {
  const original = invoiceDocument();
  const variants = ['#215a7e', '#8f306d', '#fff5a1'].map(accent => {
    const document = { ...original, snapshot: { ...original.snapshot, branding: invoiceBranding(original.snapshot.branding, { ...defaultInvoiceSettings, useWebsiteColour: false, accent }) } };
    const bytes = saleDocumentPdf(document), text = bytes.toString('latin1');
    assertTextOnA4(text);
    for (const value of ['Northfield Motors', 'Jamie Taylor', 'AB18 XYZ', '£12,100.00']) assert.ok(readablePdfText(text).includes(value), `Palette changes preserve ${value}`);
    return { bytes, text: textRows(text).map(row => row.text) };
  });
  assert.notDeepEqual(variants[0].bytes, variants[1].bytes, 'A dealer accent changes the actual PDF design');
  assert.notDeepEqual(variants[0].bytes, variants[2].bytes, 'A pale dealer accent gets its own printable design');
  assert.deepEqual(variants[0].text, variants[1].text);
  assert.deepEqual(variants[0].text, variants[2].text);
});

const relativeLuminance = (hex: string) => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
  .map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
  .reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
const colourContrast = (a: string, b: string) => (Math.max(relativeLuminance(a), relativeLuminance(b)) + .05) / (Math.min(relativeLuminance(a), relativeLuminance(b)) + .05);

test('small document labels remain readable on white and dealer-tinted panels', () => {
  for (const accent of ['#ffffff', '#000000', '#fff5a1', '#ff2dff', '#ffeb00', '#00ffff', '#00ff00', '#215a7e', '#8f306d']) {
    const palette = invoicePalette(accent);
    assert.equal(palette.accent, accent, 'The saved brand colour is preserved');
    for (const surface of ['#ffffff', palette.tint, palette.soft]) {
      for (const tone of [palette.strong, palette.ink, palette.muted]) {
        assert.ok(colourContrast(tone, surface) >= 4.5, `${tone} on ${surface} needs 4.5:1 for small invoice text (${accent})`);
      }
    }
  }
});

test('all supported settings render Classic ledger with embedded body text, exact totals and A4 margins', () => {
  const original = invoiceDocument();
  const variants = [
    { name: 'modern-blue', style: 'modern' as const, inkSaving: false, accent: '#215a7e' },
    { name: 'premium-magenta', style: 'premium' as const, inkSaving: false, accent: '#ff2dff' },
    { name: 'classic-blue', style: 'classic' as const, inkSaving: false, accent: '#215a7e' },
    { name: 'ink-saving-magenta', style: 'premium' as const, inkSaving: true, accent: '#ff2dff' },
  ];
  for (const variant of variants) {
    const document = { ...original, snapshot: { ...original.snapshot, branding: invoiceBranding(original.snapshot.branding, { ...defaultInvoiceSettings, ...variant, useWebsiteColour: false }) } };
    const bytes = saleDocumentPdf(document), text = bytes.toString('latin1');
    assert.equal(pageCount(text), 1, variant.name);
    assertTextOnA4(text); assertRowsDoNotCollide(text);
    for (const row of textRows(text)) {
      if(row.family===registrationPdfFontName) assert.match(row.text,/^[A-Z0-9 ]+$/,'Only registration lettering uses the plate font');
      else assert.match(row.family,/^Ledger/,`Body text uses the approved embedded invoice font: ${row.text}`);
      assert.ok(row.size >= 7.3, `Small print is legible: ${row.text}`);
      assert.ok(row.x >= 14 * 72 / 25.4 - .1 && row.x + row.width <= 196 * 72 / 25.4 + .1, `Text retains the stationery margins: ${row.text}`);
    }
    for (const value of ['Northfield Motors', 'Jamie Taylor', 'AB18 XYZ', '£12,100.00']) assert.ok(readablePdfText(text).includes(value), `Style retains ${value}`);
    if (variant.style === 'classic' || variant.inkSaving) assert.equal(filledRectangles(text).length, 0, 'Plain printing removes filled panels');
    if (process.env.LUXXY_PDF_AUDIT_DIR) writeFileSync(`${process.env.LUXXY_PDF_AUDIT_DIR}/${variant.name}.pdf`, bytes);
  }
});

test('receipt colours, long references and multi-page terms keep their complete supplied details', () => {
  const original = invoiceDocument();
  const longReference = 'NORTHFIELD-WESTBOROUGH-INVOICE-2026-999999999';
  const longDocument = invoiceDocument({ ...draft, customer: 'Alexandra Catherine Pennington-Worthington', vehicle: '2018 Mercedes-Benz E-Class E 350 d AMG Line Premium Plus Estate', price: '9999999999999.99', adjustments: [], address: 'Apartment 14, The Old Coach House\n187 Westborough Avenue\nLittle Northfield\nGreater London\nNW12 8XY' });
  longDocument.number = longReference;
  longDocument.snapshot.branding.identity.name = 'Northfield and Westborough Specialist Motor Company Limited - Independent Prestige and Family Vehicle Sales Centre';
  const longBytes = saleDocumentPdf(longDocument), longText = longBytes.toString('latin1');
  assertTextOnA4(longText); assertRowsDoNotCollide(longText);
  assert.match(readablePdfText(longText), /£9,999,999,999,999\.99/);
  assert.ok(textRows(longText).map(row => row.text).join('').replace(/\s+/g, '').includes(longReference), 'The wrapped invoice reference stays complete');
  const referenceRows = textRows(longText).filter(row => row.x > 100 * 72 / 25.4);
  assert.ok(referenceRows.some(row => row.text.includes('INVOICE-')), 'Reference labels wrap at separators instead of splitting INVOICE');
  if (process.env.LUXXY_PDF_AUDIT_DIR) writeFileSync(`${process.env.LUXXY_PDF_AUDIT_DIR}/long-reference-large-money.pdf`, longBytes);

  const payment: SaleWorkspacePayment = { id: 'audit-receipt-payment', amount: '1500.00', amountPence: 150000, signedAmountPence: 150000, method: 'Bank transfer', date: '2026-10-10', reference: 'BANK-PAYMENT-REFERENCE-FOR-NORTHFIELD-2026-999999999', kind: 'part-payment', status: 'confirmed', recordedBy: '', recordedAt: context.now };
  const totals = saleWorkspaceTotals(original.snapshot.draft, [payment]);
  for (const [name, accent] of [['receipt-pale-yellow', '#fff5a1'], ['receipt-dark', '#000000']]) {
    const document: SaleWorkspaceDocument = { ...original, type: 'receipt', title: 'Payment receipt', number: longReference, paymentId: payment.id, paymentAmountPence: payment.amountPence, balanceAtIssue: totals.balance, snapshot: { ...original.snapshot, payments: [payment], totals, branding: invoiceBranding(original.snapshot.branding, { ...defaultInvoiceSettings, useWebsiteColour: false, accent }) } };
    const bytes = saleDocumentPdf(document), text = bytes.toString('latin1');
    assert.equal(pageCount(text), 1); assertTextOnA4(text); assertRowsDoNotCollide(text);
    const allText = textRows(text).map(row => row.text).join(' ').replace(/\s+/g, ' ');
    assert.ok(allText.includes(payment.reference), 'Receipt keeps the wrapped payment reference');
    assert.match(readablePdfText(text), /£1,500\.00/); assert.match(readablePdfText(text), /£10,600\.00/);
    if (process.env.LUXXY_PDF_AUDIT_DIR) writeFileSync(`${process.env.LUXXY_PDF_AUDIT_DIR}/${name}.pdf`, bytes);
  }
  const terms: SaleWorkspaceDocument = { ...longDocument, type: 'terms', title: 'Terms and conditions of this vehicle purchase, payment and delivery agreement', content: Array.from({ length: 75 }, (_, index) => `Clause ${index + 1}: Fictional supplied terms describe the agreed arrangements without changing the recorded financial figures.`).join('\n') };
  const termsBytes = saleDocumentPdf(terms), termsText = termsBytes.toString('latin1');
  assert.ok(pageCount(termsText) > 1); assertTextOnA4(termsText); assertRowsDoNotCollide(termsText); assert.match(readablePdfText(termsText), /Clause 75/);
  if (process.env.LUXXY_PDF_AUDIT_DIR) writeFileSync(`${process.env.LUXXY_PDF_AUDIT_DIR}/long-terms.pdf`, termsBytes);
});


test('compact A4 layouts retain fourteen payments, QR links and exact totals without text collisions',()=>{
  for(const style of ['understated','branded'] as const) {
    const document=invoiceDocument({...draft,adjustments:[]});
    document.invoiceKind='full';
    document.snapshot.branding=invoiceBranding(document.snapshot.branding,{...defaultInvoiceSettings,style,footer:'Fictional design sample. All customer and transaction details are illustrative.',paymentInstructions:'Please quote your invoice number when contacting the showroom.'});
    document.snapshot.vehicle={id:draft.vehicleId,year:2020,fuel:'Diesel',transmission:'Automatic',mileage:22000,colour:'Obsidian Black',engineSize:'2.0L',owners:1,serviceHistory:'Full'};
    document.snapshot.payments=Array.from({length:14},(_,i)=>({id:'payment-'+i,amount:'100',amountPence:10000,signedAmountPence:10000,method:'Bank transfer',date:'2026-10-10',reference:`PAY-${String(i+1).padStart(2,'0')}`,kind:i===0?'deposit':'part-payment',status:'confirmed',recordedBy:'',recordedAt:context.now}) as SaleWorkspacePayment);
    document.snapshot.totals=saleWorkspaceTotals(document.snapshot.draft,document.snapshot.payments);
    document.balanceAtIssue=document.snapshot.totals.balance;
    document.verification={url:'https://northfield.example/verify-invoice/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/'+'a'.repeat(64),tokenHash:'private-hash'};
    const bytes=saleDocumentPdf(document),text=bytes.toString('latin1');
    assert.equal(pageCount(text),1);assertTextOnA4(text);assertRowsDoNotCollide(text);
    assert.equal(filledRectangles(text).filter(r=>r.width>35||r.height>35).length,0,'Official stationery has no large shaded backgrounds');
    for(const row of textRows(text).filter(r=>r.text.includes('£'))) assert.ok(row.size<=10.5,'Money stays compact rather than becoming a display panel');
    const readable=readablePdfText(text);
    for(let i=1;i<=14;i++) assert.ok(readable.includes('PAY-'+String(i).padStart(2,'0')));
    assert.match(readablePdfText(text),/Verify (?:this )?invoice/i);assert.match(readablePdfText(text),/\/Subtype \/Link/);assert.ok(text.includes(document.verification.url));
    assert.doesNotMatch(readablePdfText(text),/private-hash/);assert.match(readablePdfText(text),/£1,400.00/);assert.match(readablePdfText(text),/£10,600.00/);
    assert.deepEqual(bytes,saleDocumentPdf(document));
    if(process.env.COMPACT_INVOICE_SAMPLE_DIR) {
      mkdirSync(process.env.COMPACT_INVOICE_SAMPLE_DIR,{recursive:true});
      const sample=structuredClone(document);
      sample.number='NF-INV-2026-00107';
      sample.snapshot.draft.vehicle='Mercedes-Benz E-Class E220d AMG Line';
      sample.snapshot.draft.registration='AB20 XYZ';
      sample.snapshot.draft.price='24950';
      sample.snapshot.draft.adjustments=[{description:'Agreed discount',amount:'450',kind:'discount'}];
      sample.snapshot.payments=[500,2000,1500,2500,3000,1000].map((amount,i)=>({...document.snapshot.payments[i],amount:String(amount),amountPence:amount*100,signedAmountPence:amount*100,date:`2026-10-${String(8+i).padStart(2,'0')}`,method:i===2?'Debit card':i===3?'Cash':'Bank transfer',reference:i===0?'NF107-DEPOSIT':`NF107-PAY-${i}`}));
      sample.snapshot.totals=saleWorkspaceTotals(sample.snapshot.draft,sample.snapshot.payments);
      sample.balanceAtIssue=sample.snapshot.totals.balance;
      sample.snapshot.vehicle!.photoDataUrl='data:image/jpeg;base64,'+readFileSync(new URL('../../luxxy-motors/src/assets/luxxy-hero.jpg',import.meta.url)).toString('base64');
      writeFileSync(`${process.env.COMPACT_INVOICE_SAMPLE_DIR}/${style}-multiple-payments.pdf`,saleDocumentPdf(sample));
    }
    document.snapshot.payments=Array.from({length:90},(_,index)=>({...document.snapshot.payments[0],id:`long-${index}`,reference:`LONG-PAY-${String(index+1).padStart(3,'0')}`}));
    document.snapshot.totals=saleWorkspaceTotals(document.snapshot.draft,document.snapshot.payments);
    document.balanceAtIssue=document.snapshot.totals.balance;
    const continued=saleDocumentPdf(document).toString('latin1');
    assert.ok(pageCount(continued)>1,'Long histories continue onto further A4 pages');
    const continuedRows=textRows(continued);
    for(const payment of document.snapshot.payments) assert.equal(continuedRows.filter(row=>row.text.includes(payment.reference)).length,1,`No missing or duplicated ${payment.reference}`);
    for(const heading of continuedRows.filter(row=>/^Payment history(?: - continued)?$/i.test(row.text))) assert.ok(continuedRows.some(row=>row.page===heading.page&&row.y<heading.y&&/LONG-PAY-\d{3}/.test(row.text)),'A ninety-payment continuation heading shares its page with a payment row');
    assertTextOnA4(continued);assertRowsDoNotCollide(continued);
    document.snapshot.payments=[];document.snapshot.branding.invoiceSettings!.footer='x'.repeat(121);
    assert.throws(()=>saleDocumentPdf(document),/120 characters/);
  }
});

test('guided full invoice includes richer car details, a photo and every dated payment with no handover block', () => {
  const photo = 'data:image/jpeg;base64,' + readFileSync(new URL('../../luxxy-motors/src/assets/luxxy-hero.jpg', import.meta.url)).toString('base64');
  const ctx: SaleWorkspaceContext = { ...context, vehicle: { id:'test-car', title:'Mercedes-Benz E Class', year:2020, fuel:'Diesel', transmission:'Automatic', mileage:22000, colour:'Obsidian Black', engineSize:'2.0L', bodyType:'Saloon', doors:4, seats:5, owners:1, emissionClass:'Euro 6', serviceHistory:'Full service history', photoDataUrl:photo } };
  const input={...draft, vehicle:'Mercedes-Benz E Class E220d AMG Line',registration:'AB20 XYZ',adjustments:[],exchanges:[],price:'24950', address:'12 Station Road, London'};
  let sale=createSaleWorkspace({draft:input,requestId:'guided-pdf-create'},ctx,'SALE-GUIDED').sale;
  const apply = (command: Parameters<typeof changeSaleWorkspace>[1], requestId:string) => { const result=changeSaleWorkspace(sale,command,{expectedRevision:sale.revision,requestId},ctx);sale=result.sale;return result; };
  apply({action:'invoice-payment',payment:{amount:'500',method:'Cash',date:'2026-10-08',reference:'DEPOSIT-001',kind:'deposit',status:'confirmed'}},'guided-pdf-deposit');
  const deposit=apply({action:'issue-invoice',kind:'deposit',acknowledge:true},'guided-pdf-deposit-invoice').document!;
  apply({action:'invoice-payment',payment:{amount:'10000',method:'Bank transfer',date:'2026-10-09',reference:'TRANSFER-002',kind:'part-payment',status:'confirmed'}},'guided-pdf-interim');
  apply({action:'invoice-payment',payment:{amount:'14450',method:'Debit card',date:'2026-10-10',reference:'CARD-003',kind:'final-payment',status:'confirmed'}},'guided-pdf-final');
  const full=apply({action:'issue-invoice',kind:'full',acknowledge:true},'guided-pdf-full').document!;
  const bytes=saleDocumentPdf(full); const text=bytes.toString('latin1');
  assert.match(readablePdfText(text),/Vehicle details/i);assert.match(readablePdfText(text),/Obsidian Black/);assert.match(readablePdfText(text),/22,000 miles/);assert.match(readablePdfText(text),/Euro 6/);assert.match(readablePdfText(text),/DEPOSIT-001/);assert.match(readablePdfText(text),/TRANSFER-002/);assert.match(readablePdfText(text),/CARD-003/);assert.match(readablePdfText(text),/8 Oct 2026/);assert.match(readablePdfText(text),/9 Oct 2026/);assert.match(readablePdfText(text),/10 Oct 2026/);assert.match(readablePdfText(text),/\/Subtype \/Image/);assert.doesNotMatch(readablePdfText(text),/Collection arrangements|Delivery arrangements|Issued document/);
  assert.equal(full.snapshot.totals.balance,0);assert.equal(deposit.snapshot.totals.balance,2445000);assert.deepEqual(bytes,saleDocumentPdf(full));
  for (const row of textRows(text)) assert.ok(row.x >= 14*72/25.4-.1 && row.x+row.width <= 196*72/25.4+.1, `Text fits A4: ${row.text}`);
  if(process.env.GUIDED_INVOICE_SAMPLE_DIR) {mkdirSync(process.env.GUIDED_INVOICE_SAMPLE_DIR,{recursive:true});for(const [name,document] of [['deposit',deposit],['full',full]] as const) {document.snapshot.branding.invoiceSettings={...defaultInvoiceSettings,footer:'Design sample only — fictional customer, vehicle details and payments.'};writeFileSync(`${process.env.GUIDED_INVOICE_SAMPLE_DIR}/${name}-invoice-sample.pdf`,saleDocumentPdf(document));}}
});

test('invoice plates embed the approved font, preserve all registration formats and stay inside A4 without a UK badge', () => {
  const formats = [['MM00MMM','MM00 MMM'],['M222MMM','M222 MMM'],['MMM3333','MMM 3333'],['MMM222','MMM 222'],['BIZ1111','BIZ 1111']];
  for(const style of ['branded','understated','modern','classic'] as const) for(const [registration,expected] of formats) {
    const document=invoiceDocument({...draft,registration,adjustments:[]});
    document.snapshot.branding.invoiceSettings={...defaultInvoiceSettings,style};
    const before=JSON.stringify(document);
    const bytes=saleDocumentPdf(document), text=bytes.toString('latin1');
    const lettering=textRows(text).filter(row=>row.family===registrationPdfFontName);
    assert.equal(lettering.length,1,`${style}/${registration}: one real registration`);
    assert.equal(lettering[0].text,expected);
    assert.ok(lettering[0].size>=15,'Registration stays readable in print');
    assert.match(readablePdfText(text),/\/FontFile2\b/,'TrueType font is embedded for offline printing');
    assert.equal(textRows(text).some(row=>row.text==='UK'),false,'No UK badge on invoice');
    assert.doesNotMatch(readablePdfText(text),/\/Subtype \/Image/,'The plate is text/vector artwork, not a raster image');
    assert.equal(pageCount(text),1);assertTextOnA4(text);assertRowsDoNotCollide(text);
    assert.equal(JSON.stringify(document),before,'Rendering never alters the issued snapshot');
  }
});

const ledgerPhoto = () => 'data:image/jpeg;base64,' + readFileSync(new URL('../../luxxy-motors/src/assets/luxxy-hero.jpg', import.meta.url)).toString('base64');
function ledgerInvoiceFixture(count = 14, kind: 'deposit' | 'full' = 'full', paid = false) {
  const document = invoiceDocument({ ...draft, vehicle: 'Mercedes-Benz E220d AMG Line', registration: 'AB20XYZ', price: paid ? String(count * 100) : '24950', adjustments: [], exchanges: [], email: 'jamie@example.test', phone: '07700 900123', address: '12 Station Road\nLondon\nHA1 1AA' });
  document.invoiceKind = kind;
  document.number = 'NF-INV-2026-00107';
  document.snapshot.branding = invoiceBranding(document.snapshot.branding, { ...defaultInvoiceSettings, footer: 'Fictional design sample. All customer and transaction details are illustrative.', paymentInstructions: 'Please quote your invoice number when contacting the showroom.' });
  document.snapshot.vehicle = { id: draft.vehicleId, year: 2020, fuel: 'Diesel', transmission: 'Automatic', mileage: 22000, colour: 'Obsidian Black', engineSize: '2.0L', photoDataUrl: ledgerPhoto() };
  document.snapshot.payments = Array.from({ length: count }, (_, index): SaleWorkspacePayment => ({ id: `ledger-payment-${index}`, amount: '100.00', amountPence: 10000, signedAmountPence: 10000, method: index % 2 ? 'Bank transfer' : 'Debit card', date: `2026-10-${String(index % 10 + 1).padStart(2, '0')}`, reference: `LEDGER-PAY-${String(index + 1).padStart(3, '0')}`, kind: index === 0 ? 'deposit' : 'part-payment', status: 'confirmed', recordedBy: 'PRIVATE-STAFF-NAME', recordedAt: context.now }));
  document.snapshot.totals = saleWorkspaceTotals(document.snapshot.draft, document.snapshot.payments);
  document.balanceAtIssue = document.snapshot.totals.balance;
  document.verification = { url: 'https://northfield.example/verify-invoice/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/' + 'a'.repeat(64), tokenHash: 'PRIVATE-VERIFICATION-HASH' };
  return document;
}
function saveLedgerSample(name: string, document: SaleWorkspaceDocument) {
  if (!process.env.CLASSIC_LEDGER_SAMPLE_DIR) return;
  mkdirSync(process.env.CLASSIC_LEDGER_SAMPLE_DIR, { recursive: true });
  writeFileSync(`${process.env.CLASSIC_LEDGER_SAMPLE_DIR}/${name}.pdf`, saleDocumentPdf(document));
}
function assertPaymentsRetained(text: string, payments: SaleWorkspacePayment[]) {
  const rows = textRows(text);
  for (const payment of payments.filter(payment => payment.status === 'confirmed')) {
    const occurrence = rows.filter(row => row.text.includes(payment.reference));
    assert.equal(occurrence.length, 1, `Exactly one complete payment row: ${payment.reference}`);
    assert.ok(occurrence[0].size >= 9, `Payment history stays at least 9pt: ${payment.reference}`);
  }
  for (const heading of rows.filter(row => /^Payment history(?: - continued)?$/i.test(row.text))) {
    assert.ok(rows.some(row => row.page === heading.page && /LEDGER-PAY-\d{3}/.test(row.text)), 'A payments heading stays with at least its first payment row');
  }
}

test('Classic ledger keeps photo and all fourteen payments on one A4 page for paid and part-paid full invoices', () => {
  for (const paid of [false, true]) {
    const document = ledgerInvoiceFixture(14, 'full', paid);
    const before = JSON.stringify(document);
    const bytes = saleDocumentPdf(document), text = bytes.toString('latin1'), readable = readablePdfText(text);
    assert.equal(pageCount(text), 1, 'A normal fourteen-payment invoice keeps its car photo on one A4 sheet');
    assert.match(text, /\/Subtype \/Image/);
    assert.match(text, /\/FontFile2\b/);
    assertTextOnA4(text); assertRowsDoNotCollide(text); assertPaymentsRetained(text, document.snapshot.payments);
    for (const value of ['Mercedes-Benz E220d AMG Line', 'AB20 XYZ', '22,000 miles', 'Obsidian Black', 'Diesel', 'Automatic', '£1,400.00']) assert.ok(readable.includes(value), `Retains supplied detail: ${value}`);
    assert.match(readable, paid ? /Paid in full/ : /£23,550\.00/);
    assert.equal(textRows(text).filter(row => row.family === registrationPdfFontName).length, 1);
    assert.equal(textRows(text).some(row => row.text === 'UK'), false);
    assert.match(text, /\/Subtype \/Link/); assert.ok(text.includes(document.verification!.url));
    assert.doesNotMatch(readable, /PRIVATE-STAFF-NAME|PRIVATE-VERIFICATION-HASH/);
    assert.equal(JSON.stringify(document), before, 'Drawing the new design cannot mutate an issued snapshot');
    assert.deepEqual(bytes, saleDocumentPdf(document), 'Archived inputs produce deterministic bytes');
    saveLedgerSample(paid ? 'full-paid-fourteen-payments' : 'full-part-paid-fourteen-payments', document);
    if (!paid) {
      const inkSaving = structuredClone(document);
      inkSaving.snapshot.branding.invoiceSettings!.inkSaving = true;
      saveLedgerSample('full-fourteen-payments-monochrome', inkSaving);
    }
  }
});

test('Classic ledger deposit invoice retains its photo and confirmed payments while pending money stays outside the balance', () => {
  const document = ledgerInvoiceFixture(3, 'deposit');
  const pending: SaleWorkspacePayment = { ...document.snapshot.payments[0], id: 'ledger-pending', reference: 'NOT-CONFIRMED-PAYMENT', amount: '50.00', amountPence: 5000, signedAmountPence: 5000, status: 'pending' };
  const cancelled: SaleWorkspacePayment = { ...pending, id: 'ledger-cancelled', reference: 'CANCELLED-PAYMENT', status: 'cancelled' };
  document.snapshot.payments.push(pending, cancelled);
  document.snapshot.totals = saleWorkspaceTotals(document.snapshot.draft, document.snapshot.payments);
  document.balanceAtIssue = document.snapshot.totals.balance;
  const text = saleDocumentPdf(document).toString('latin1'), readable = readablePdfText(text);
  assert.equal(pageCount(text), 1); assertTextOnA4(text); assertRowsDoNotCollide(text);
  assert.match(readable, /Deposit invoice/i); assert.match(text, /\/Subtype \/Image/);
  assertPaymentsRetained(text, document.snapshot.payments);
  assert.match(readable, /£300\.00/); assert.match(readable, /£24,650\.00/);
  assert.match(readable, /£50\.00/); assert.match(readable, /(?:not deducted|not reduced|not credited|not included)/i);
  assert.doesNotMatch(readable, /NOT-CONFIRMED-PAYMENT|CANCELLED-PAYMENT/);
  saveLedgerSample('deposit-three-payments', document);
});

test('Classic ledger continuation retains twenty-six payments, repeats table headings and prints settlement totals once', () => {
  const document = ledgerInvoiceFixture(26);
  document.snapshot.draft.customer = 'Alexandra Catherine Pennington-Worthington';
  document.snapshot.draft.address = 'Apartment 14, The Old Coach House\n187 Westborough Avenue\nLittle Northfield\nGreater London\nNW12 8XY';
  document.snapshot.payments[4].reference = 'LEDGER-PAY-005 / Agreed instalment following a detailed customer payment arrangement';
  document.snapshot.vehicle = { ...document.snapshot.vehicle, owners: 1, serviceHistory: 'Full service history with original invoices', bodyType: 'Estate', doors: 5, seats: 5, emissionClass: 'Euro 6', writeOffCategory: 'Not recorded' };
  const text = saleDocumentPdf(document).toString('latin1'), rows = textRows(text), readable = readablePdfText(text);
  assert.ok(pageCount(text) > 1); assertTextOnA4(text); assertRowsDoNotCollide(text);
  // Wrapped descriptions are measured separately; all short references remain complete.
  assertPaymentsRetained(text, document.snapshot.payments.filter(payment => payment.id !== 'ledger-payment-4'));
  assert.ok(rows.map(row => row.text).join(' ').includes(document.snapshot.payments[4].reference));
  assert.ok(rows.some(row => row.page > 0 && /Date/i.test(row.text)) && rows.some(row => row.page > 0 && /Method/i.test(row.text)), 'Continued payment pages repeat readable column headings');
  assert.equal(rows.filter(row => row.text === 'Sale total').length, 1, 'The final sale total is printed once');
  assert.equal(rows.filter(row => /^(?:Balance remaining|Balance due)$/.test(row.text)).length, 1, 'Settlement is not repeated on each page');
  assert.match(readable, /£2,600\.00/); assert.match(readable, /£22,350\.00/);
  saveLedgerSample('full-long-content-twenty-six-payments', document);
});

test('Classic ledger retains signed refunds, reversals and customer credit without counting pending or cancelled payments', () => {
  const document = ledgerInvoiceFixture(1);
  const base = document.snapshot.payments[0];
  document.snapshot.payments = [
    { ...base, amount: '26000.00', amountPence: 2600000, signedAmountPence: 2600000 },
    { ...base, id: 'refund', reference: 'LEDGER-PAY-002', kind: 'refund', amount: '200.00', amountPence: 20000, signedAmountPence: -20000 },
    { ...base, id: 'reversal', reference: 'LEDGER-PAY-003', kind: 'reversal', amount: '50.00', amountPence: 5000, signedAmountPence: -5000 },
    { ...base, id: 'correction', reference: 'LEDGER-PAY-004', kind: 'refund-correction', amount: '100.00', amountPence: 10000, signedAmountPence: 10000 },
    { ...base, id: 'pending', reference: 'PRIVATE-PENDING-REF', status: 'pending', amount: '77.00', amountPence: 7700, signedAmountPence: 7700 },
    { ...base, id: 'cancelled', reference: 'PRIVATE-CANCELLED-REF', status: 'cancelled', amount: '88.00', amountPence: 8800, signedAmountPence: 8800 },
  ];
  document.snapshot.totals = saleWorkspaceTotals(document.snapshot.draft, document.snapshot.payments);
  document.balanceAtIssue = document.snapshot.totals.balance;
  const text = saleDocumentPdf(document).toString('latin1'), readable = readablePdfText(text);
  assert.equal(document.snapshot.totals.confirmedPaid, 2585000); assert.equal(document.balanceAtIssue, -90000);
  assertPaymentsRetained(text, document.snapshot.payments);
  for (const value of ['Refund', 'Reversal', 'Refund correction', '-£200.00', '-£50.00', '£25,850.00', 'Customer credit', '£900.00', '£77.00']) assert.ok(readable.includes(value), `Retains financial meaning: ${value}`);
  assert.doesNotMatch(readable, /Paid in full|PRIVATE-PENDING-REF|PRIVATE-CANCELLED-REF/);
  assertTextOnA4(text); assertRowsDoNotCollide(text);
  saveLedgerSample('full-refunds-and-customer-credit', document);
});


test('unmarked historic compact snapshots keep the existing renderer and exact deterministic bytes', () => {
  for (const style of ['branded', 'understated'] as const) {
    const document = ledgerInvoiceFixture(3);
    document.snapshot.branding.invoiceSettings = { ...defaultInvoiceSettings, style };
    delete document.snapshot.branding.invoiceSettings.layoutVersion;
    const before = JSON.stringify(document);
    const fileId = createHash('sha256').update(document.id).digest('hex').slice(0, 32);
    const bytes = saleDocumentPdf(document);
    assert.deepEqual(bytes, Buffer.from(compactInvoicePdf(document, { fileId })), 'An old snapshot routes through its unchanged historical renderer');
    assert.equal(textRows(bytes.toString('latin1')).some(row => row.family.startsWith('Ledger')), false, 'The new font is never inserted into an unmarked historic invoice');
    assert.equal(JSON.stringify(document), before);
  }
});

test('Classic ledger keeps a payment heading with its first wrapped row across changing address heights', () => {
  const firstReference = 'EDGE-FIRST-PAYMENT / First agreed instalment for this vehicle, with a deliberately longer payment description that must remain complete when it wraps onto several lines';
  const observedHeadingPages = new Set<number>();
  // Each extra address line changes the space left above the payment table. This
  // covers the narrow break boundary rather than pinning it to a single y value.
  for (const addressLines of [1, 7, 13, 19, 25, 31, 37, 43]) {
    const document = ledgerInvoiceFixture(3);
    document.snapshot.draft.address = Array.from({ length: addressLines }, (_, index) => `Address line ${index + 1}, Example Road`).join('\n');
    document.snapshot.payments[0].reference = firstReference;
    document.snapshot.payments[1].reference = 'EDGE-SECOND-PAYMENT';
    document.snapshot.payments[2].reference = 'EDGE-THIRD-PAYMENT';
    const text = saleDocumentPdf(document).toString('latin1'), rows = textRows(text);
    assertTextOnA4(text); assertRowsDoNotCollide(text);
    const headings = rows.filter(row => /^Payment history(?: - continued)?$/i.test(row.text));
    assert.ok(headings.length, 'Every payment table has its readable heading');
    const firstFragment = rows.find(row => row.text.includes('EDGE-FIRST-PAYMENT'));
    assert.ok(firstFragment, 'The first payment retains its identifying fragment');
    observedHeadingPages.add(headings[0].page);
    assert.equal(headings[0].page, firstFragment.page, `A heading cannot be orphaned before its first wrapped payment (${addressLines} address lines)`);
    assert.ok(firstFragment.y < headings[0].y, 'The first payment starts below its heading on the same A4 page');
    const paymentDescription = rows.filter(row => row.x >= 37 * 72 / 25.4 && row.x <= 39 * 72 / 25.4).map(row => row.text).join(' ').replace(/\s+/g, ' ');
    assert.ok(paymentDescription.includes(firstReference), 'All wrapped first-payment wording is retained in its column');
    for (const reference of ['EDGE-SECOND-PAYMENT', 'EDGE-THIRD-PAYMENT']) assert.equal(rows.filter(row => row.text.includes(reference)).length, 1, `Exactly one ${reference}`);
    const secondFragment = rows.find(row => row.text.includes('EDGE-SECOND-PAYMENT'));
    assert.ok(secondFragment);
    const firstRowLines = rows.filter(row => row.page === firstFragment.page && Math.abs(row.x-firstFragment.x)<.1 && row.y <= firstFragment.y+.1 && (secondFragment.page !== firstFragment.page || row.y > secondFragment.y+.1));
    assert.ok(firstRowLines.length >= 2, 'The first payment actually exercises multiline wrapping');
  }
  assert.ok(observedHeadingPages.size > 1, 'The varying addresses exercise payment tables before and after an A4 page break');
});

test('Classic ledger realistic full invoice keeps photo, fourteen payments, fee, discount, PX and short terms on one A4 sheet', () => {
  const document = ledgerInvoiceFixture(14);
  document.snapshot.draft.adjustments = [
    { description: 'Agreed delivery', amount: '100.00', kind: 'fee' },
    { description: 'Agreed discount', amount: '250.00', kind: 'discount' },
  ];
  document.snapshot.draft.exchanges = [{ registration: 'CD14 EXM', description: 'Volkswagen Golf', value: '3000.00' }];
  document.snapshot.branding.contact = { phone: '020 7946 0123', email: 'sales@northfield.example' };
  document.snapshot.branding.legal = { companyName: 'Northfield Motors Limited', companyNumber: 'TEST012345', vatNumber: '' };
  document.content = 'The vehicle and agreed price are recorded above. Please keep this invoice with your vehicle records. Contact the showroom if any supplied detail needs correcting.';
  document.snapshot.totals = saleWorkspaceTotals(document.snapshot.draft, document.snapshot.payments);
  document.balanceAtIssue = document.snapshot.totals.balance;
  const before = JSON.stringify(document);
  const text = saleDocumentPdf(document).toString('latin1'), rows = textRows(text), readable = readablePdfText(text);
  saveLedgerSample('full-fourteen-payments-with-breakdown', document);
  assert.equal(pageCount(text), 1, 'Normal sale paperwork retains the photo, full breakdown and fourteen individual payments on one A4 page');
  assertTextOnA4(text); assertRowsDoNotCollide(text); assertPaymentsRetained(text, document.snapshot.payments);
  assert.match(text, /\/Subtype \/Image/); assert.match(text, /\/Subtype \/Link/);
  assert.ok(text.includes(document.verification!.url));
  for (const value of ['Vehicle price', 'Agreed delivery', 'Agreed discount', 'CD14 EXM', 'Volkswagen Golf', '020 7946 0123', 'sales@northfield.example', 'Northfield Motors Limited', 'TEST012345', '£24,950.00', '£100.00', '-£250.00', '-£3,000.00', '£21,800.00', '£1,400.00', '£20,400.00']) assert.ok(readable.includes(value), `Realistic invoice retains ${value}`);
  const flattened = rows.map(row => row.text).join(' ').replace(/\s+/g, ' ');
  assert.ok(flattened.includes(document.content), 'All short terms remain complete');
  assert.equal(rows.filter(row => row.family === registrationPdfFontName && row.text === 'AB20 XYZ').length, 1);
  assert.equal(rows.some(row => row.text === 'UK'), false, 'The printed plate remains badge-free');
  assert.equal(document.snapshot.totals.totalDue, 2180000); assert.equal(document.balanceAtIssue, 2040000);
  assert.equal(JSON.stringify(document), before, 'The realistic issued snapshot remains untouched');
});

test('Classic ledger keeps an ordinary rich vehicle heading, plate, photo and facts together at A4 boundaries', () => {
  const observedVehiclePages = new Set<number>();
  for (const addressLines of [1, 7, 13, 19, 25, 31, 37, 43]) {
    const document = ledgerInvoiceFixture(1);
    document.snapshot.draft.address = Array.from({ length: addressLines }, (_, index) => `Customer address line ${index + 1}`).join('\n');
    document.snapshot.draft.collection = '2026-10-20';
    document.snapshot.vehicle = { ...document.snapshot.vehicle, owners: 1, serviceHistory: 'Full service history', bodyType: 'Estate', emissionClass: 'Euro 6', doors: 5, seats: 5, writeOffCategory: 'Category N' };
    const text = saleDocumentPdf(document).toString('latin1'), rows = textRows(text);
    assertTextOnA4(text); assertRowsDoNotCollide(text);
    const heading = rows.find(row => /^Vehicle details$/i.test(row.text));
    const title = rows.find(row => row.text === document.snapshot.draft.vehicle);
    const plate = rows.find(row => row.family === registrationPdfFontName && row.text === 'AB20 XYZ');
    assert.ok(heading && title && plate, 'The ordinary rich vehicle block retains its heading, title and plate');
    observedVehiclePages.add(heading.page);
    assert.equal(title.page, heading.page, `Vehicle title stays with its heading (${addressLines} address lines)`);
    assert.equal(plate.page, heading.page, 'The vehicle plate stays with the vehicle heading');
    const saleHeading = rows.find(row => row.page === heading.page && /^Sale breakdown$/i.test(row.text));
    const vehicleRows = rows.filter(row => row.page === heading.page && row.y < heading.y && (!saleHeading || row.y > saleHeading.y));
    const vehicleText = vehicleRows.map(row => row.text).join(' ').replace(/\s+/g, '');
    for (const value of ['2020', '22,000 miles', 'Diesel', 'Automatic', 'Obsidian Black', '2.0L', '1', 'Full service history', 'Estate', 'Euro 6', '5 doors / 5 seats', 'Category N', '20 Oct 2026']) {
      assert.ok(value === '1' ? vehicleRows.some(row => row.text === value) : vehicleText.includes(value.replace(/\s+/g, '')), `Complete ordinary fact ${value} stays inside the vehicle block on its heading page`);
    }
    // The fixture has no dealer logo: its sole image invocation is the car photo.
    // Inspect page content streams, not shared PDF image-resource declarations.
    const objects = new Map([...text.matchAll(/(?:^|\n)(\d+) 0 obj\r?\n([\s\S]*?)\r?\nendobj/g)].map(match => [Number(match[1]), match[2]]));
    const imagePages = [...objects.values()].filter(object => /\/Type \/Page\b/.test(object)).flatMap((object, page) => {
      const contentId = object.match(/\/Contents (\d+) 0 R/);
      const contents = contentId ? objects.get(Number(contentId[1])) ?? '' : '';
      return /\/I\d+ Do\b/.test(contents) ? [page] : [];
    });
    assert.deepEqual(imagePages, [heading.page], 'The car photo is drawn exactly on its vehicle heading page');
  }
  assert.ok(observedVehiclePages.size > 1, 'The eight address heights exercise vehicle blocks before and after an A4 page break');
});
