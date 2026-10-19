import { jsPDF } from 'jspdf';
import { renderInvoice } from './classic-ledger/render-invoice.ts';
import { ledgerRegularFontBase64, ledgerBoldFontBase64 } from './classic-ledger/fonts.ts';
import type { ImageAsset, InvoiceData } from './classic-ledger/types.ts';
import { registrationPlateFontBase64 } from './registration-plate-font.ts';
import { formatRegistrationPlate } from './registration.ts';
import { invoicePalette } from './invoice-palette.ts';
import { invoiceTextLimits, SaleWorkspaceError, saleWorkspacePence, type SaleWorkspaceDocument } from './sale-workspace.ts';

const clean = (value: unknown) => String(value ?? '').replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').replace(/[\u2010-\u2015]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').trim();
const supplied = (value: unknown) => /^(unknown|n\/a|not supplied|not provided|your dealership|your address|enter .+|\[.+\])$/i.test(clean(value)) ? '' : clean(value);
const money = (pence: number) => Number.isSafeInteger(pence) ? new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pence / 100) : 'Check amount';
const date = (value: string) => {
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric' }) : clean(value);
};
const lines = (value: unknown) => clean(value).split(/\r?\n/).filter(line => line.trim());
const kindLabels: Record<string, string> = { deposit: 'Deposit', 'part-payment': 'Interim payment', 'final-payment': 'Final payment', refund: 'Refund', reversal: 'Reversal', 'refund-correction': 'Refund correction' };

/** Validate only embedded snapshot assets. Never fetch a logo or vehicle photograph. */
function snapshotImage(value: unknown, maximumBytes: number): ImageAsset | undefined {
  if (typeof value !== 'string' || value.length > maximumBytes || !/^data:image\/(?:png|jpe?g);base64,[A-Za-z0-9+/=]+$/.test(value)) return;
  try {
    const probe = new jsPDF();
    const properties = probe.getImageProperties(value);
    if (!(properties.width > 0 && properties.height > 0)) return;
    const format = properties.fileType === 'PNG' ? 'PNG' : properties.fileType === 'JPEG' ? 'JPEG' : undefined;
    if (!format) return;
    return { data: value.replace(/^data:image\/jpg;/, 'data:image/jpeg;'), format };
  } catch { return; }
}

/** Classic ledger presentation only. The frozen ledger remains the authority for every amount. */
export function compactInvoicePdf(document: SaleWorkspaceDocument, options: { fileId?: string; draft?: boolean } = {}): Uint8Array {
  const { draft, branding, vehicle, totals } = document.snapshot;
  const design = branding.invoiceSettings!;
  const name = supplied(branding.identity.name) || supplied(branding.legal.companyName);
  if (!name) throw new SaleWorkspaceError('Add the dealership name in settings before creating an invoice.');
  const wording = { footer: clean(design.footer), paymentInstructions: clean(design.paymentInstructions), saleTerms: clean(document.content) };
  for (const [key, value] of Object.entries(wording)) if (value.length > invoiceTextLimits[key as keyof typeof invoiceTextLimits]) throw new SaleWorkspaceError(`Shorten ${key.replace(/([A-Z])/g, ' $1').toLowerCase()} to ${invoiceTextLimits[key as keyof typeof invoiceTextLimits]} characters in invoice settings before issuing this A4 invoice.`);

  const url = document.verification?.url;
  if (url && (!/^https?:\/\/[a-z0-9.:[\]-]+\/verify-invoice\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9]{64}$/i.test(url) || url.length > 700)) throw new SaleWorkspaceError('The invoice verification address is invalid.');

  const confirmed = document.snapshot.payments.filter(payment => payment.status === 'confirmed');
  const paidInFull = document.balanceAtIssue === 0 && totals.totalDue > 0 && totals.confirmedPaid >= totals.totalDue;
  const status = document.balanceAtIssue < 0 ? 'Customer credit' : paidInFull ? 'Paid in full' : document.invoiceKind === 'deposit' ? 'Deposit received' : 'Balance outstanding';
  const details: Array<[string, unknown]> = [
    ['Engine', vehicle?.engineSize], ['Previous keepers', vehicle?.owners], ['Service history', vehicle?.serviceHistory], ['Body type', vehicle?.bodyType],
    ['Emissions standard', vehicle?.emissionClass], ['Doors / seats', [vehicle?.doors ? `${vehicle.doors} doors` : '', vehicle?.seats ? `${vehicle.seats} seats` : ''].filter(Boolean).join(' / ')], ['Write-off category', vehicle?.writeOffCategory], ['Collection date', supplied(draft.collection) ? date(draft.collection) : ''],
  ];
  const data: InvoiceData = {
    type: document.invoiceKind === 'deposit' ? 'Deposit Invoice' : 'Sales Invoice', number: clean(document.number), issueDate: date(document.issuedAt),
    dealer: { name, address: [branding.address.street, branding.address.city, branding.address.region, branding.address.postcode].map(supplied).filter(Boolean).flatMap(lines), contacts: [branding.contact.phone, branding.contact.email].map(supplied).filter(Boolean) },
    customer: { name: supplied(draft.customer), address: lines(supplied(draft.address)), contacts: [draft.email, draft.phone].map(supplied).filter(Boolean) },
    vehicle: { makeModel: supplied(draft.vehicle) || supplied(vehicle?.title), registration: clean(draft.registration), year: supplied(vehicle?.year), mileage: typeof vehicle?.mileage === 'number' ? `${vehicle.mileage.toLocaleString('en-GB')} miles` : '',
      fuel: supplied(vehicle?.fuel), gearbox: supplied(vehicle?.transmission), colour: supplied(vehicle?.colour), photo: snapshotImage(vehicle?.photoDataUrl, 2_800_000),
      details: details.filter(([, value]) => Boolean(supplied(value))).map(([label, value]) => ({ label, value: supplied(value) })) },
    saleLines: [
      { id: 'vehicle-price', description: 'Vehicle price', amount: money(totals.price) },
      ...(draft.adjustments ?? []).map((adjustment, i) => ({ id: `adjustment-${i}`, description: clean(adjustment.description), amount: money(saleWorkspacePence(adjustment.amount) * (adjustment.kind === 'discount' ? -1 : 1)) })),
      ...(draft.exchanges ?? (draft.partExchange ? [{ registration: draft.pxRegistration, description: draft.pxDescription, value: draft.pxValue }] : [])).map((exchange, i) => ({ id: `exchange-${i}`, description: `Part exchange - ${clean(exchange.registration)}${exchange.description ? ` - ${clean(exchange.description)}` : ''}`, amount: money(-saleWorkspacePence(exchange.value)) })),
    ],
    confirmedPayments: confirmed.map(payment => ({ id: payment.id, date: date(payment.date), description: (kindLabels[payment.kind] ?? clean(payment.kind)) + (payment.reference ? ` / ${clean(payment.reference)}` : ''), method: clean(payment.method), amount: money(payment.signedAmountPence) })),
    totals: { saleTotal: money(totals.totalDue), paymentsReceived: money(totals.confirmedPaid), balanceRemaining: money(Math.abs(document.balanceAtIssue)) },
    balanceLabel: document.balanceAtIssue < 0 ? 'Customer credit' : 'Balance remaining', settlementStatus: status,
    ...(totals.pending > 0 ? { pendingNote: `Awaiting confirmation: ${money(totals.pending)}. Not deducted from the balance.` } : {}), draft: options.draft,
    paymentInstructions: lines(wording.paymentInstructions), terms: lines(wording.saleTerms), termsHeading: 'Terms',
    footerLines: [[supplied(branding.legal.companyName), branding.legal.companyNumber ? `Company ${clean(branding.legal.companyNumber)}` : '', branding.legal.vatNumber ? `VAT registration ${clean(branding.legal.vatNumber)}` : ''].filter(Boolean).join(' | '), wording.footer].filter(Boolean),
    ...(url ? { verification: { url, explanation: 'Scan to check the invoice details on our website.' } } : {}),
  };
  const logo = design.showLogo ? snapshotImage(branding.identity.logoAsset, 1_500_000) : undefined;
  const logoWidth = design.logoSize === 'small' ? 28 : design.logoSize === 'large' ? 49 : 38;
  const logoHeight = design.logoSize === 'small' ? 9 : design.logoSize === 'large' ? 13.07 : 12;
  const palette = invoicePalette(branding.presentation?.linkColour);
  try {
    const result = renderInvoice(data, { fonts: { regularTtf: ledgerRegularFontBase64, boldTtf: ledgerBoldFontBase64, plateTtf: registrationPlateFontBase64 }, registrationFormatter: formatRegistrationPlate,
      branding: { logo, logoWidth, logoHeight, accent: design.style === 'branded' ? palette.strong : '#34414B' }, monochrome: design.inkSaving,
      creationDate: new Date(document.issuedAt), fileId: options.fileId ?? document.id.replace(/[^a-f0-9]/gi, '').padEnd(32, '0').slice(0, 32) });
    result.doc.setProperties({ title: `${document.title} ${document.number}`, author: name });
    return new Uint8Array(result.doc.output('arraybuffer'));
  } catch (error) {
    if (error instanceof SaleWorkspaceError) throw error;
    throw new SaleWorkspaceError(error instanceof Error ? error.message : 'This invoice could not be laid out. Check the supplied invoice details.');
  }
}
