import { saleWorkspaceTotals, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';
export type OperationEnquiry = { id: string; status: string; appointmentAt?: string | Date | null; appointmentCancelledAt?: string | Date | null; appointmentStatus?: string | null; followUpAt?: string | Date | null; followUpCompletedAt?: string | Date | null; customerName?: string; vehicleTitle?: string | null };
export type StockRunSummary = { runId: string; status: string; scrapedAt: string | Date; receivedAt: string | Date; complete?: boolean; expectedCount?: number; receivedCount?: number; errors?: unknown[]; addedCount?: number; changedCount?: number; missingCount?: number };
const iso = (value: string | Date | null | undefined) => value == null ? null : new Date(value).toISOString();
export function stockHealth(runs: StockRunSummary[], now = new Date(), staleAfterHours = 36) {
  const sorted = [...runs].sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime());
  const success = sorted.find(run => run.status === 'completed' && run.complete !== false);
  const lastSuccessfulSync = success ? iso(success.receivedAt) : null;
  const lastStockObservedAt = success ? iso(success.scrapedAt) : null;
  const ageHours = lastStockObservedAt ? Math.max(0, (now.getTime() - new Date(lastStockObservedAt).getTime()) / 3_600_000) : null;
  const stale = ageHours == null || ageHours > staleAfterHours;
  const latest = sorted[0];
  const failedImports = sorted.filter(run => ['failed', 'quarantined'].includes(run.status)).length;
  const failuresSinceSuccess = sorted.filter(run => ['failed', 'quarantined'].includes(run.status) && (!lastSuccessfulSync || new Date(run.receivedAt).getTime() >= new Date(lastSuccessfulSync).getTime())).length;
  const alerts: Array<{ code: string; severity: 'warning' | 'error'; message: string }> = [];
  if (!success) alerts.push({ code: 'never_synced', severity: 'warning', message: 'No complete stock update has been received. Configure your scheduled stock importer.' });
  else if (stale) alerts.push({ code: 'stock_stale', severity: 'warning', message: `The stock feed is older than ${staleAfterHours} hours. Check the scheduled importer.` });
  if (latest && ['failed', 'quarantined'].includes(latest.status)) alerts.push({ code: 'import_failed', severity: 'error', message: 'The latest stock update failed validation. Existing stock has been preserved; review the import errors.' });
  return { lastSuccessfulSync, lastStockObservedAt, ageHours, stale, staleAfterHours, failedImports, failuresSinceSuccess, latestRun: latest ? { runId: latest.runId, status: latest.status, receivedAt: iso(latest.receivedAt), scrapedAt: iso(latest.scrapedAt), expectedCount: latest.expectedCount ?? null, receivedCount: latest.receivedCount ?? null } : null, alerts };
}
export function dealerOperationsSummary(input: { enquiries: OperationEnquiry[]; sales: SaleWorkspaceRecord[]; stockRuns: StockRunSummary[]; stockCount: number; now?: Date; staleAfterHours?: number }) {
  const now = input.now ?? new Date();
  const active = input.sales.filter(sale => sale.lifecycle?.status !== 'released');
  const outstanding = active.map(sale => ({ sale, balancePence: saleWorkspaceTotals(sale.draft, sale.payments).balance })).filter(entry => entry.balancePence > 0);
  const enquiryIds = new Set(input.enquiries.map(enquiry => enquiry.id));
  const converted = new Set(active.map(sale => sale.draft.sourceEnquiryId).filter((id): id is string => Boolean(id && enquiryIds.has(id))));
  const sold = new Set(active.filter(sale => sale.lifecycle?.status === 'sold' || sale.draft.handover).map(sale => sale.draft.sourceEnquiryId).filter((id): id is string => Boolean(id && enquiryIds.has(id))));
  const upcoming = input.enquiries.filter(enquiry => enquiry.appointmentAt && !enquiry.appointmentCancelledAt && new Date(enquiry.appointmentAt).getTime() >= now.getTime()).sort((a, b) => new Date(a.appointmentAt!).getTime() - new Date(b.appointmentAt!).getTime());
  const deliveries = active.filter(sale => sale.draft.fulfilment?.method === 'delivery' && !sale.draft.fulfilment.completedAt && !sale.draft.handover).sort((a, b) => (a.draft.fulfilment?.scheduledDate ?? '').localeCompare(b.draft.fulfilment?.scheduledDate ?? ''));
  return {
    generatedAt: now.toISOString(),
    unansweredEnquiries: input.enquiries.filter(enquiry => enquiry.status === 'new').length,
    upcomingAppointments: upcoming.length,
    pendingAppointments: upcoming.filter(enquiry => enquiry.appointmentStatus === 'pending').length,
    overdueFollowUps: input.enquiries.filter(enquiry => enquiry.status !== 'closed' && enquiry.followUpAt && !enquiry.followUpCompletedAt && new Date(enquiry.followUpAt).getTime() < now.getTime()).length,
    outstandingBalancePence: outstanding.reduce((total, entry) => total + entry.balancePence, 0),
    salesWithBalance: outstanding.length,
    upcomingDeliveries: deliveries.length,
    totalEnquiries: input.enquiries.length,
    convertedEnquiries: converted.size,
    soldEnquiries: sold.size,
    enquiryConversionPercent: input.enquiries.length ? Math.round(converted.size / input.enquiries.length * 1000) / 10 : 0,
    completedConversionPercent: input.enquiries.length ? Math.round(sold.size / input.enquiries.length * 1000) / 10 : 0,
    completedSales: active.filter(sale => sale.draft.handover || sale.lifecycle?.status === 'sold').length,
    totalSales: active.length,
    stockCount: input.stockCount,
    stock: stockHealth(input.stockRuns, now, input.staleAfterHours),
    appointments: upcoming.slice(0, 10).map(enquiry => ({ id: enquiry.id, customer: enquiry.customerName ?? '', vehicle: enquiry.vehicleTitle ?? '', at: iso(enquiry.appointmentAt), status: enquiry.appointmentStatus ?? 'confirmed' })),
    balances: outstanding.slice(0, 10).map(({ sale, balancePence }) => ({ id: sale.id, reference: sale.reference, customer: sale.draft.customer, balancePence })),
    deliveries: deliveries.slice(0, 10).map(sale => ({ id: sale.id, reference: sale.reference, customer: sale.draft.customer, scheduledDate: sale.draft.fulfilment?.scheduledDate ?? '', timeWindow: sale.draft.fulfilment?.timeWindow ?? '' })),
  };
}
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
