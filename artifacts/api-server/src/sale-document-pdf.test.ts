import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { saleDocumentPdfBytes } from '@workspace/vehicle-meta/sale-document-pdf';
import { createSaleWorkspace, changeSaleWorkspace, defaultInvoiceSettings, invoiceBranding, saleWorkspaceTotals, type SaleWorkspaceContext, type SaleWorkspaceDraft } from '@workspace/vehicle-meta';
import { saleDocumentPdf } from './lib/sale-document-pdf';
const draft: SaleWorkspaceDraft = { id: 'draft-test', customer: 'Jamie Taylor', email: '', phone: '', address: '12 Station Road, London', vehicleId: 'test-car', vehicle: '2018 Touring Estate', registration: 'AB18 XYZ', price: '12000', partExchange: false, pxRegistration: '', pxDescription: '', pxValue: '', deposit: '', paymentMethod: '', notes: '', collection: '', preparation: false, documents: false, handover: false, adjustments: [{ description: 'Agreed delivery', amount: '100', kind: 'fee' }], exchanges: [] };
let id = 0;
const context: SaleWorkspaceContext = { now: '2026-10-10T10:00:00.000Z', actor: 'Test staff', nextId: () => `id-${++id}`, nextNumber: type => `${type}-${++id}`, branding: { identity: { name: 'Northfield Motors', logoText: 'NORTHFIELD', logoAsset: '' }, contact: { phone: '', email: '' }, address: { street: '24 Station Road', city: 'London', region: '', postcode: '' }, legal: { companyName: '', companyNumber: '', vatNumber: '' }, presentation: { linkColour: '#215a7e' } }, vehicle: { year: 2018, fuel: 'Petrol', transmission: 'Automatic', mileage: 42000 } };
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
  assert.doesNotMatch(text, /DEPOSIT-ONLY-REF|Vehicle price|AGREED SALE|PAYMENT HISTORY/);
  assert.ok(text.indexOf('PAYMENT RECEIVED') < text.indexOf('BALANCE REMAINING'));
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
  const filledPanels = (text: string) => (text.match(/re\nf\b/g) ?? []).length;
  assert.ok(filledPanels(saleDocumentPdf(result.document).toString('latin1')) >= 5);
  assert.equal(filledPanels(saleDocumentPdf(light).toString('latin1')), 1);
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
  if (process.env.LUXXY_PDF_QA_DIR) writeFileSync(`${process.env.LUXXY_PDF_QA_DIR}/three-px-invoice.pdf`, saleDocumentPdf(result.document));
});
