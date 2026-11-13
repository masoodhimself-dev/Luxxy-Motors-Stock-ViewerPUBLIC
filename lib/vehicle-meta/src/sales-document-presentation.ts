import type { InvoiceData, SaleLine } from './classic-ledger/types.ts';
import { SaleWorkspaceError, saleWorkspacePence, type SaleWorkspaceDocument } from './sale-workspace.ts';

const clean = (value: unknown) => String(value ?? '').replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').replace(/[\u2010-\u2015]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').trim();
const supplied = (value: unknown) => /^(unknown|n\/a|not supplied|not provided|your dealership|your address|enter .+|\[.+\])$/i.test(clean(value)) ? '' : clean(value);
const lines = (value: unknown) => clean(value).split(/\r?\n/).filter(Boolean);
export const salesDocumentMoney = (value: number) => {
  if (!Number.isSafeInteger(value)) throw new SaleWorkspaceError('Check the saved document amount.');
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(value / 100);
};
export function salesDocumentDate(value: string) {
  const date = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'short', year: 'numeric' }) : clean(value);
}
const paymentLabels: Record<string, string> = { deposit: 'Deposit', 'part-payment': 'Part payment', 'final-payment': 'Final payment', refund: 'Refund', reversal: 'Payment reversal', 'refund-correction': 'Refund correction' };

/** Pure presentation of a frozen v2 snapshot. Never reprices or changes its ledger. */
export function salesDocumentPresentation(document: SaleWorkspaceDocument): InvoiceData {
  if (!['invoice', 'statement', 'receipt', 'payment-request', 'credit-note', 'delivery-invoice'].includes(document.type)) throw new SaleWorkspaceError('Use this document’s dedicated renderer to preserve its wording and signatures.');
  const { draft, branding, totals, vehicle, payments } = document.snapshot;
  const confirmed = payments.filter(row => row.status === 'confirmed');
  const cash = confirmed.reduce((amount, row) => amount + row.signedAmountPence, 0);
  const credit = (draft.creditEntries ?? []).reduce((amount, row) => amount + row.signedAmountPence, 0);
  const amount = salesDocumentMoney;
  const balanceLabel = document.balanceAtIssue < 0 ? 'Refund / credit due' : 'Balance remaining';
  const review = document.type === 'invoice' ? vehicle?.invoiceReview : undefined;
  const hasVehiclePhotoSnapshot = document.type === 'invoice' && Array.isArray(vehicle?.invoicePhotoDataUrls);
  const vehicleName = supplied(draft.vehicle) || supplied(vehicle?.title);
  const trim = hasVehiclePhotoSnapshot ? supplied(vehicle?.trim) : '';
  const derivative = trim && !vehicleName.toLowerCase().includes(trim.toLowerCase()) ? trim : undefined;
  const displayedDoorCount = Number(`${vehicleName} ${derivative ?? ''}`.match(/\b(\d+)\s*(?:dr|doors?)\b/i)?.[1]);
  const doors = vehicle?.doors && vehicle.doors !== displayedDoorCount ? vehicle.doors : undefined;
  const paymentsLabel = !review ? 'Cash payments / refunds' : confirmed.some(row => row.signedAmountPence < 0) ? 'Payments after refunds' : 'Payments received';
  const mot = review?.motExpiry && (review.motSource === 'DVSA' || review.motSource === 'DVLA')
    ? { label: `MOT expiry (${review.motSource})`, expiry: salesDocumentDate(review.motExpiry) } : undefined;
  const saleLines: SaleLine[] = [
    { id: 'vehicle-price', description: 'Vehicle price', amount: amount(totals.price) },
    ...(saleWorkspacePence(draft.deliveryCharge ?? '') > 0 ? [{ id: 'delivery-charge', description: 'Delivery', amount: amount(saleWorkspacePence(draft.deliveryCharge!)) }] : []),
    ...(draft.adjustments ?? []).map((row, i) => ({ id: `adjustment-${i}`, description: clean(row.description), amount: amount(saleWorkspacePence(row.amount) * (row.kind === 'discount' ? -1 : 1)) })),
    ...(draft.exchanges ?? (draft.partExchange ? [{ registration: draft.pxRegistration, description: draft.pxDescription, value: draft.pxValue }] : [])).map((row, i) => ({ id: `exchange-${i}`, description: `Part exchange - ${clean(row.registration)}${row.description ? ` - ${clean(row.description)}` : ''}`, amount: amount(-saleWorkspacePence(row.value)) })),
    ...(draft.returnCreditPence ? [{ id: 'return-credit', description: 'Agreed vehicle return credit', amount: amount(-draft.returnCreditPence) }] : []),
  ];
  const status = totals.totalDue === 0 && cash === 0 && credit === 0 ? 'No agreed charges' : document.balanceAtIssue < 0 ? 'Customer credit outstanding' : document.balanceAtIssue === 0 ? 'No balance outstanding' : 'Balance outstanding';
  const data: InvoiceData = {
    type: document.type === 'statement' ? 'Balance Statement' : document.invoiceKind === 'deposit' ? 'Deposit Invoice' : 'Sales Invoice',
    number: clean(document.number), issueDate: salesDocumentDate(document.issuedAt),
    dealer: { name: supplied(branding.identity.name) || supplied(branding.legal.companyName), address: [branding.address.street, branding.address.city, branding.address.region, branding.address.postcode].map(supplied).filter(Boolean).flatMap(lines), contacts: [branding.contact.phone, branding.contact.email].map(supplied).filter(Boolean) },
    customer: { name: supplied(draft.customer), address: lines(draft.address), contacts: [draft.email, draft.phone].map(supplied).filter(Boolean) },
    vehicle: { makeModel: vehicleName, ...(derivative ? { derivative } : {}), registration: clean(review?.registration ?? draft.registration), year: supplied(vehicle?.year),
      mileage: !review && typeof vehicle?.mileage === 'number' ? `${vehicle.mileage.toLocaleString('en-GB')} miles` : '',
      ...(review ? { saleMileage: `${review.mileage.toLocaleString('en-GB')} miles` } : {}), ...(mot ? { officialMot: mot } : {}),
      fuel: supplied(vehicle?.fuel), gearbox: supplied(vehicle?.transmission), colour: supplied(vehicle?.colour), vin: supplied(draft.vin),
      details: [
        ['Engine', vehicle?.engineSize], ['Previous keepers', vehicle?.owners], ['Service history', vehicle?.serviceHistory], ['Body type', vehicle?.bodyType],
        ...(hasVehiclePhotoSnapshot ? [['Seats', vehicle?.seats || undefined], ['Doors', doors]] : []),
        ['Write-off category', vehicle?.writeOffCategory],
      ].filter(([, value]) => supplied(value)).map(([label, value]) => ({ label: String(label), value: supplied(value) })) },
    ...(document.type === 'invoice' && draft.fulfilment?.method === 'delivery' && draft.fulfilment.address.trim()
      ? { facts: [{ label: 'Delivery address', value: clean(draft.fulfilment.address) }] } : {}),
    saleLines,
    confirmedPayments: [...confirmed.map(row => ({ id: row.id, date: salesDocumentDate(row.date), description: `${paymentLabels[row.kind] ?? clean(row.kind)}${row.reference ? ` / ${clean(row.reference)}` : ''}`, method: clean(row.method), amount: amount(row.signedAmountPence) })), ...(draft.creditEntries ?? []).map(row => ({ id: `credit-${row.id}`, date: salesDocumentDate(row.at), description: `Credit ${row.signedAmountPence > 0 ? 'from' : 'to'} ${clean(row.reference)}`, method: 'Credit transfer', amount: amount(row.signedAmountPence) }))],
    ...(document.type === 'statement' ? { pendingPayments: payments.filter(row => row.status === 'pending').map(row => ({ id: row.id, date: salesDocumentDate(row.date), description: `${paymentLabels[row.kind] ?? clean(row.kind)}${row.reference ? ` / ${clean(row.reference)}` : ''}`, method: clean(row.method), amount: amount(row.amountPence) })) } : {}),
    totals: { saleTotal: amount(totals.totalDue), paymentsReceived: amount(totals.confirmedPaid), balanceRemaining: amount(Math.abs(document.balanceAtIssue)) },
    summaryRows: [{ label: 'Sale total', amount: amount(totals.totalDue) }, { label: paymentsLabel, amount: amount(cash) }, ...(draft.creditEntries?.length ? [{ label: 'Transferred credit (net)', amount: amount(credit) }] : []), { label: balanceLabel, amount: amount(Math.abs(document.balanceAtIssue)), emphasis: true }],
    paymentHistory: { heading: draft.creditEntries?.length ? 'Payments and transferred credit' : 'Payment history', countLabel: `${confirmed.length} payment ${confirmed.length === 1 ? 'entry' : 'entries'}${draft.creditEntries?.length ? ` / ${draft.creditEntries.length} credit ${draft.creditEntries.length === 1 ? 'entry' : 'entries'}` : ''}`, emptyLabel: 'No confirmed payments recorded at issue' },
    settlementStatus: status,
    ...(review ? { firstPageBalance: { label: document.balanceAtIssue < 0 ? 'Credit at issue' : 'Balance at issue', amount: amount(Math.abs(document.balanceAtIssue)) } } : {}),
    notice: 'Figures and payment status are recorded at the issue date. Later changes appear on separate receipts or statements.',
    ...(totals.pending > 0 ? { pendingNote: `Awaiting confirmation: ${amount(totals.pending)}. Not deducted from the balance.` } : {}),
    paymentInstructions: document.balanceAtIssue > 0 || document.type === 'delivery-invoice' || document.type === 'payment-request'
      ? lines(branding.invoiceSettings?.paymentInstructions) : [],
    terms: lines(document.content), termsHeading: 'Agreed terms',
    footerLines: [[supplied(branding.legal.companyName), branding.legal.companyNumber ? `Company ${clean(branding.legal.companyNumber)}` : '', branding.legal.vatNumber ? `VAT registration ${clean(branding.legal.vatNumber)}` : ''].filter(Boolean).join(' | '), clean(branding.invoiceSettings?.footer)].filter(Boolean),
    ...(document.verification?.url ? { verification: { url: document.verification.url, explanation: 'Scan to check the invoice details on our website.' } } : {}),
  };
  const transaction = document.transaction;
  if (document.type === 'payment-request') {
    if (transaction?.kind !== 'payment-request') throw new SaleWorkspaceError('The payment request is missing its saved request details.');
    const label = transaction.requestKind === 'deposit' ? 'Deposit requested' : transaction.requestKind === 'balance' ? 'Remaining balance requested' : 'Agreed payment requested';
    Object.assign(data, { type: 'Payment Request', customerLabel: 'Requested from', saleLinesHeading: 'Payment requested', hidePaymentHistory: true, settlementStatus: 'Awaiting payment - not a receipt', notice: 'This requests a payment. It is not a tax invoice or confirmation that money has been received.',
      facts: [{ label: 'Sale reference', value: clean(transaction.saleReference) }, { label: 'Payment reference', value: clean(transaction.paymentReference) }, { label: 'Due date', value: salesDocumentDate(transaction.dueDate) }],
      saleLines: [{ id: 'request-amount', description: label, amount: amount(transaction.amountPence) }],
      summaryRows: [{ label: 'Amount requested', amount: amount(transaction.amountPence), emphasis: true }], terms: transaction.note ? lines(transaction.note) : [], termsHeading: 'Payment note', verification: undefined, pendingNote: undefined });
    if (transaction.showSaleBreakdown) Object.assign(data, {
      type: transaction.requestKind === 'deposit' ? 'Deposit Request' : 'Payment Request',
      saleLinesHeading: 'Agreed sale', saleLines,
      summaryRows: [
        { label: 'Sale total', amount: amount(totals.totalDue) },
        { label: 'Already paid / credit', amount: amount(totals.confirmedPaid) },
        { label: 'Outstanding before this request', amount: amount(document.balanceAtIssue) },
        { label, amount: amount(transaction.amountPence), emphasis: true },
        { label: 'Balance if this payment is received', amount: amount(Math.max(0, document.balanceAtIssue - transaction.amountPence)) },
      ],
    });
  } else if (document.type === 'delivery-invoice') {
    if (transaction?.kind !== 'delivery-invoice') throw new SaleWorkspaceError('The delivery invoice is missing its saved charge details.');
    Object.assign(data, { type: 'Delivery Invoice', saleLinesHeading: 'Additional delivery charge', hidePaymentHistory: true, settlementStatus: 'Additional charge at issue', notice: 'This invoice charges the additional delivery amount only. The vehicle price remains on the original sales invoice.',
      facts: [{ label: 'Linked sale', value: clean(transaction.saleReference) }, ...(transaction.invoiceReferences.length ? [{ label: 'Original invoice', value: transaction.invoiceReferences.map(clean).join(', ') }] : []), ...(transaction.deliveryAddress ? [{ label: 'Delivery address', value: clean(transaction.deliveryAddress) }] : [])],
      saleLines: [{ id: 'additional-delivery', description: 'Additional delivery charge', amount: amount(transaction.amountPence) }],
      summaryRows: [{ label: 'Invoice total', amount: amount(transaction.amountPence), emphasis: true }], terms: [], verification: undefined, pendingNote: undefined });
  } else if (document.type === 'credit-note') {
    if (transaction?.kind === 'return-only-credit') {
      Object.assign(data, { type: 'Return Credit Note', customerLabel: 'Credit for', saleLinesHeading: 'Agreed return credit', hidePaymentHistory: true,
        settlementStatus: transaction.refundDuePence > 0 ? 'Refund due - not yet recorded' : 'Return agreement credited', notice: 'This credits the returned vehicle agreement. It cancels the unpaid amount shown below and records any remaining customer credit. It does not send money or confirm a refund.',
        facts: [{ label: 'Original sale', value: clean(transaction.originalSaleReference) }, ...(transaction.originalInvoiceReferences.length ? [{ label: 'Original invoice', value: transaction.originalInvoiceReferences.map(clean).join(', ') }] : []), { label: 'Actual return date', value: salesDocumentDate(transaction.returnedDate) }, { label: 'Returned mileage', value: `${transaction.mileage.toLocaleString('en-GB')} miles` }],
        saleLines: [{ id: 'agreed-return-credit', description: 'Credit for returned vehicle', amount: amount(transaction.amountPence) }],
        summaryRows: [{ label: 'Original agreed charges', amount: amount(transaction.originalTotalPence) }, { label: 'Agreed return credit', amount: amount(transaction.amountPence) }, { label: 'Unpaid balance cancelled', amount: amount(transaction.unpaidCancelledPence) }, { label: 'Refund due at return', amount: amount(transaction.refundDuePence), emphasis: true }, { label: 'Cash refund recorded by this document', amount: amount(0) }],
        terms: [`Return reason: ${clean(transaction.reason)}`, `Recorded condition: ${clean(transaction.condition)}`], termsHeading: 'Return record', paymentInstructions: [], verification: undefined, pendingNote: undefined });
      return data;
    }
    if (transaction?.kind !== 'return-credit') throw new SaleWorkspaceError('The return credit note is missing its saved credit details.');
    Object.assign(data, { type: 'Return Credit Note', customerLabel: 'Credit for', saleLinesHeading: 'Agreed return credit', hidePaymentHistory: true, settlementStatus: 'Credit transferred - no cash refund', notice: 'This records the agreed vehicle return credit and its transfer to the replacement sale. It does not record a new payment or cash refund.',
      facts: [{ label: 'Original sale', value: clean(transaction.originalSaleReference) }, ...(transaction.originalInvoiceReferences.length ? [{ label: 'Original invoice', value: transaction.originalInvoiceReferences.map(clean).join(', ') }] : []), { label: 'Replacement sale', value: clean(transaction.replacementSaleReference) }, { label: 'Returned mileage', value: `${transaction.mileage.toLocaleString('en-GB')} miles` }],
      saleLines: [{ id: 'agreed-return-credit', description: 'Credit for returned vehicle', amount: amount(transaction.amountPence) }],
      summaryRows: [{ label: 'Agreed credit', amount: amount(transaction.amountPence) }, { label: 'Transferred to replacement', amount: amount(transaction.amountPence), emphasis: true }, { label: 'Cash refund recorded', amount: amount(0) }],
      terms: [`Return reason: ${clean(transaction.reason)}`, `Recorded condition: ${clean(transaction.condition)}`], termsHeading: 'Return record', paymentInstructions: [], verification: undefined, pendingNote: undefined });
  } else if (document.type === 'receipt') {
    const payment = confirmed.find(row => row.id === document.paymentId);
    if (!payment) throw new SaleWorkspaceError('This receipt has no confirmed payment.');
    const refund = payment.kind === 'refund', adjustment = payment.kind === 'reversal' || payment.kind === 'refund-correction';
    Object.assign(data, { type: refund ? 'Refund Receipt' : adjustment ? 'Payment Adjustment' : 'Payment Receipt', customerLabel: 'Customer', saleLinesHeading: refund ? 'Refund details' : adjustment ? 'Payment adjustment' : 'Payment recorded', hidePaymentHistory: true,
      ...(refund ? { settlementStatus: 'Refund recorded' } : {}),
      notice: refund ? 'This confirms the recorded refund to the customer. Transferred credit is shown separately from cash payments.' : adjustment ? 'This records a ledger correction. It is not a new customer payment.' : 'This confirms the individual payment recorded below. Other payments retain their own receipts.',
      facts: [{ label: refund ? 'Refund date' : 'Payment date', value: salesDocumentDate(payment.date) }, { label: 'Method', value: clean(payment.method) }, ...(payment.reference ? [{ label: 'Reference', value: clean(payment.reference) }] : []), ...(payment.reason ? [{ label: 'Reason', value: clean(payment.reason) }] : [])],
      saleLines: [{ id: payment.id, description: refund ? 'Amount refunded' : payment.kind === 'reversal' ? 'Payment reversed' : payment.kind === 'refund-correction' ? 'Refund correction' : 'Amount received', amount: amount(payment.amountPence) }],
      terms: [], paymentInstructions: [], verification: undefined, pendingNote: undefined });
  }
  return data;
}
