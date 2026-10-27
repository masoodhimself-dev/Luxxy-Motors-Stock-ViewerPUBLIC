import type { SaleWorkspaceRecord } from '@workspace/vehicle-meta';
function csvCell(value: string | number): string {
  let safe = String(value);
  // Only trusted generated numbers remain numeric. Customer/provider strings
  // are neutralised even when a formula marker follows leading whitespace.
  if (typeof value === 'string' && /^[\s\uFEFF]*[=+\-@]/.test(safe)) safe = `'${safe}`;
  return `"${safe.replace(/"/g, '""')}"`;
}
export function paymentLedgerCsv(sales: SaleWorkspaceRecord[], range: { from?: string; to?: string } = {}): string {
  const rows: Array<Array<string | number>> = [['Sale reference', 'Customer', 'Vehicle', 'Registration', 'Payment ID', 'Payment date', 'Kind', 'Status', 'Method', 'Payment reference', 'Amount GBP', 'Signed amount GBP', 'Amount pence', 'Signed amount pence', 'Reverses payment ID', 'Reason', 'Receipt number', 'Recorded by', 'Recorded at']];
  for (const sale of [...sales].sort((a, b) => a.reference.localeCompare(b.reference))) {
    for (const payment of [...sale.payments].sort((a, b) => a.date.localeCompare(b.date) || a.recordedAt.localeCompare(b.recordedAt))) {
      if ((range.from && payment.date < range.from) || (range.to && payment.date > range.to)) continue;
      const receipt = sale.documents.find(document => document.id === payment.receiptId);
      rows.push([sale.reference, sale.draft.customer, sale.draft.vehicle, sale.draft.registration, payment.id, payment.date, payment.kind, payment.status, payment.method, payment.reference, payment.amountPence / 100, payment.signedAmountPence / 100, payment.amountPence, payment.signedAmountPence, payment.reversesPaymentId ?? '', payment.reason ?? '', receipt?.number ?? '', payment.recordedBy, payment.recordedAt]);
    }
  }
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
