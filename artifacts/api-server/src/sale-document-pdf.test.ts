import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { jsPDF } from 'jspdf';
import { saleDocumentPdfBytes } from '@workspace/vehicle-meta/sale-document-pdf';
import { createSaleWorkspace, changeSaleWorkspace, defaultInvoiceSettings, invoiceBranding, saleWorkspaceTotals, type SaleWorkspaceContext, type SaleWorkspaceDraft, type SaleWorkspaceDocument, type SaleWorkspacePayment } from '@workspace/vehicle-meta';
import { saleDocumentPdf } from './lib/sale-document-pdf';
const draft: SaleWorkspaceDraft = { id: 'draft-test', customer: 'Jamie Taylor', email: '', phone: '', address: '12 Station Road, London', vehicleId: 'test-car', vehicle: '2018 Touring Estate', registration: 'AB18 XYZ', price: '12000', partExchange: false, pxRegistration: '', pxDescription: '', pxValue: '', deposit: '', paymentMethod: '', notes: '', collection: '', preparation: false, documents: false, handover: false, adjustments: [{ description: 'Agreed delivery', amount: '100', kind: 'fee' }], exchanges: [] };
let id = 0;
const context: SaleWorkspaceContext = { now: '2026-10-10T10:00:00.000Z', actor: 'Test staff', nextId: () => `id-${++id}`, nextNumber: type => `${type}-${++id}`, branding: { identity: { name: 'Northfield Motors', logoText: 'NORTHFIELD', logoAsset: '' }, contact: { phone: '', email: '' }, address: { street: '24 Station Road', city: 'London', region: '', postcode: '' }, legal: { companyName: '', companyNumber: '', vatNumber: '' }, presentation: { linkColour: '#215a7e' } }, vehicle: { year: 2018, fuel: 'Petrol', transmission: 'Automatic', mileage: 42000 } };

const pageCount = (text: string) => (text.match(/\/Type \/Page\b/g) ?? []).length;
const pdfStreams = (text: string) => [...text.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(match => match[1]);
const literalText = (text: string) => text.replace(/\\([()\\])/g, '$1');
type TextRow = { text: string; x: number; y: number; width: number; size: number; page: number };
// Read the actual uncompressed PDF text positions, rather than pinning a layout to
// exact panel counts or coordinates. Font metrics then catch clipped long values.
function textRows(text: string): TextRow[] {
  const metrics = new jsPDF({ unit: 'pt', format: 'a4' });
  const fonts = metrics.getFontList();
  const families = ['helvetica', 'courier', 'times'];
  const fontById = new Map<string, { family: string; style: string }>();
  let fontIndex = 1;
  for (const family of families) for (const style of fonts[family]) fontById.set(`F${fontIndex++}`, { family, style });
  const rows: TextRow[] = [];
  for (const [page, stream] of pdfStreams(text).entries()) for (const block of stream.matchAll(/BT\n([\s\S]*?)\nET/g)) {
    const source = block[1], foundFont = source.match(/\/(F\d+) ([\d.]+) Tf/);
    assert.ok(foundFont, 'Every text block declares its font and size');
    const font = fontById.get(foundFont[1]);
    assert.ok(font, `Font ${foundFont[1]} is supported by the PDF bounds reader`);
    const size = Number(foundFont[2]);
    metrics.setFont(font.family, font.style); metrics.setFontSize(size);
    let x = 0, y = 0, leading = size * 1.15;
    for (const operation of source.matchAll(/(-?[\d.]+) (-?[\d.]+) Td|([\d.]+) TL|\(((?:\\.|[^\\)])*)\) Tj|(T\*)/g)) {
      if (operation[1] !== undefined) { x += Number(operation[1]); y += Number(operation[2]); }
      else if (operation[3] !== undefined) leading = Number(operation[3]);
      else if (operation[4] !== undefined) {
        const row = literalText(operation[4]);
        rows.push({ text: row, x, y, size, width: metrics.getTextWidth(row), page });
      } else if (operation[5]) y -= leading;
    }
  }
  assert.ok(rows.length > 0, 'The PDF includes measurable text rows');
  return rows;
}
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
  assert.match(text, /Northfield Motors/); assert.match(text, /£12,100.00/); assert.match(text, /\(1 \/ 1\)/); const box = text.match(/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/); assert.ok(box); assert.ok(Math.abs(Number(box[1]) - 595.28) < .01); assert.ok(Math.abs(Number(box[2]) - 841.89) < .01);
  assert.doesNotMatch(text, /Issued document|GBP|Payments at issue|draft-test|Separate receipts record payments/);
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
  assert.match(text, /PAYMENT RECEIVED/); assert.match(text, /£1,500.00/); assert.match(text, /SECOND-PAYMENT-REF/); assert.match(text, /£10,100.00/);
  for (const value of ['10 Oct 2026', 'Cash', 'part payment', '£2,000.00', 'AB18 XYZ']) assert.ok(text.includes(value), `Receipt retains its payment and vehicle context: ${value}`);
  assert.doesNotMatch(text, /DEPOSIT-ONLY-REF|Vehicle price|AGREED SALE|PAYMENT HISTORY/);
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
  assert.match(text, /PAYMENT HISTORY/); assert.match(text, /AWAITING-CLEARANCE/); assert.match(text, /£12,100.00/); assert.match(text, /These have not reduced the balance/);
});

test('long terms continue across A4 pages without leaking staff notes or reprinting sale charges', () => {
  const sale = createSaleWorkspace({ draft: { ...draft, notes: 'Private staff-only comment' }, requestId: 'terms-create' }, context, 'SALE-TEST-TERMS').sale;
  const invoice = changeSaleWorkspace(sale, { action: 'document', type: 'invoice' }, { expectedRevision: sale.revision, requestId: 'terms-invoice' }, context);
  assert.ok(invoice.document);
  const terms = { ...invoice.document, type: 'terms' as const, title: 'Terms and conditions of sale', content: Array.from({ length: 90 }, (_, index) => `Clause ${index + 1}: These are fictional test terms for the supplied vehicle sale, collection and delivery arrangements.`).join('\n') };
  const before = JSON.stringify(terms);
  const text = saleDocumentPdf(terms).toString('latin1');
  assert.ok((text.match(/\/Type \/Page\b/g) ?? []).length > 1);
  assert.match(text, /Clause 90/); assert.doesNotMatch(text, /Vehicle price|Private staff-only comment|PAYMENT HISTORY/);
  assert.equal(JSON.stringify(terms), before);
  if (process.env.LUXXY_PDF_QA_DIR) writeFileSync(`${process.env.LUXXY_PDF_QA_DIR}/terms.pdf`, saleDocumentPdf(terms));
});

test('invoice renderer never fetches a remote logo and retains dealer wordmark fallback', () => {
  const sale = createSaleWorkspace({ draft, requestId: 'logo-create' }, { ...context, branding: { ...context.branding, identity: { ...context.branding.identity, logoAsset: 'https://remote.example.test/logo.png' } } }, 'SALE-TEST-LOGO').sale;
  const result = changeSaleWorkspace(sale, { action: 'document', type: 'invoice' }, { expectedRevision: sale.revision, requestId: 'logo-invoice' }, context);
  assert.ok(result.document);
  assert.match(saleDocumentPdf(result.document).toString('latin1'), /Northfield Motors/);
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
  assert.match(bytes.toString('latin1'), /Thank you for choosing Northfield/);
  assert.match(bytes.toString('latin1'), /Please contact accounts to confirm bank details/);
  assert.doesNotMatch(bytes.toString('latin1'), /Later wording/);
});

test('drafts are identified without claiming an empty draft is paid, and ink saving removes filled panels', async () => {
  const sale = createSaleWorkspace({ draft, requestId: 'draft-design-create' }, context, 'SALE-TEST-DRAFT').sale;
  const result = changeSaleWorkspace(sale, { action: 'document', type: 'invoice' }, { expectedRevision: sale.revision, requestId: 'draft-design-invoice' }, context);
  assert.ok(result.document);
  const empty = { ...result.document, balanceAtIssue: 0, snapshot: { ...result.document.snapshot, totals: { ...result.document.snapshot.totals, totalDue: 0, confirmedPaid: 0 } } };
  const draftPdf = Buffer.from(saleDocumentPdfBytes(empty, { draft: true })).toString('latin1');
  assert.match(draftPdf, /DRAFT/);
  assert.doesNotMatch(draftPdf, /Paid in full|ISSUED ON/);
  const { defaultInvoiceSettings, invoiceBranding } = await import('@workspace/vehicle-meta');
  const light = { ...result.document, snapshot: { ...result.document.snapshot, branding: invoiceBranding(result.document.snapshot.branding, { ...defaultInvoiceSettings, inkSaving: true }) } };
  const premiumFills = filledRectangles(saleDocumentPdf(result.document).toString('latin1'));
  const lightFills = filledRectangles(saleDocumentPdf(light).toString('latin1'));
  const area = (rectangles: ReturnType<typeof filledRectangles>) => rectangles.reduce((sum, rectangle) => sum + rectangle.area, 0);
  assert.ok(area(premiumFills) > 100, 'The ordinary design includes visible dealer colour');
  assert.ok(area(lightFills) <= area(premiumFills) * 0.05, 'Ink saving removes at least 95% of filled rectangular coverage');
  assert.equal(lightFills.filter(rectangle => Math.min(rectangle.width, rectangle.height) > 2).length, 0, 'Ink saving has no filled panels; thin rules are allowed');
  for (const value of ['Northfield Motors', 'Jamie Taylor', 'AB18 XYZ', '£12,100.00']) assert.ok(saleDocumentPdf(light).toString('latin1').includes(value), `Ink saving preserves ${value}`);
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
  for (const value of ['PX11 AAA', 'PX12 BBB', 'PX13 CCC', 'Administration agreed with buyer', 'Agreed discount', 'Example Motors Limited', 'TEST012345', '20 Oct 2026', '£10,200.00']) assert.ok(text.includes(value), value);
  for (const value of ['£15,000.00', '£150.00', '£50.00', '-£250.00', '-£3,000.00', '-£1,250.00', '-£500.00']) assert.ok(text.includes(value), `The full agreed price breakdown retains ${value}`);
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
  const allText = textRows(text).map(row => row.text).join(' ').replace(/\s+/g, ' ');
  for (const supplied of [dealer, customer, longDraft.vehicle, 'The Old Coach House', '187 Westborough Avenue', 'NW12 8XY', 'sales@northfield-westborough.example.test']) assert.ok(allText.includes(supplied), `No clipping or omitted supplied detail: ${supplied}`);
  assert.doesNotMatch(text, /NEVER PRINT PRIVATE WORKSPACE NOTES/);
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
  assert.match(text, /Clause 75/);
  assertTextOnA4(text);
  assertRowsDoNotCollide(text);
});

test('large supported monetary amount remains exact and fits every summary column', () => {
  const document = invoiceDocument({ ...draft, price: '9999999999999.99', adjustments: [] });
  const text = saleDocumentPdf(document).toString('latin1');
  assert.match(text, /£9,999,999,999,999\.99/);
  assert.doesNotMatch(text, /Check amount|NaN|Infinity/);
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
  for (const payment of payments) assert.ok(text.includes(payment.reference), `Statement retains ${payment.reference}`);
  assert.match(text, /£3,600\.00/); assert.match(text, /£16,400\.00/);
  assert.doesNotMatch(text, /STAFF-IDENTITY-PRIVATE/);
  assertTextOnA4(text);
});

test('saved dealer colours vary the design without changing document text or financial amounts', () => {
  const original = invoiceDocument();
  const variants = ['#215a7e', '#8f306d', '#fff5a1'].map(accent => {
    const document = { ...original, snapshot: { ...original.snapshot, branding: invoiceBranding(original.snapshot.branding, { ...defaultInvoiceSettings, useWebsiteColour: false, accent }) } };
    const bytes = saleDocumentPdf(document), text = bytes.toString('latin1');
    assertTextOnA4(text);
    for (const value of ['Northfield Motors', 'Jamie Taylor', 'AB18 XYZ', '£12,100.00']) assert.ok(text.includes(value), `Palette changes preserve ${value}`);
    return { bytes, text: textRows(text).map(row => row.text) };
  });
  assert.notDeepEqual(variants[0].bytes, variants[1].bytes, 'A dealer accent changes the actual PDF design');
  assert.notDeepEqual(variants[0].bytes, variants[2].bytes, 'A pale dealer accent gets its own printable design');
  assert.deepEqual(variants[0].text, variants[1].text);
  assert.deepEqual(variants[0].text, variants[2].text);
});
