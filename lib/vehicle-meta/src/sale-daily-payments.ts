import { SaleWorkspaceError, type SaleWorkspacePaymentKind, type SaleWorkspaceRecord } from './sale-workspace.ts';

export const dailySalePaymentsPageSize = 25;
export type DailySalePaymentRow = {
  id: string;
  saleId: string;
  saleReference: string;
  vehicle: string;
  registration: string;
  reference: string;
  method: string;
  kind: SaleWorkspacePaymentKind;
  amountPence: number;
};
export type DailySalePaymentGroup = Pick<DailySalePaymentRow, 'method' | 'kind' | 'amountPence'> & {
  status: 'confirmed' | 'pending';
  count: number;
};
export type DailySalePaymentsOptions = {
  date: string;
  confirmedOffset: number;
  pendingOffset: number;
};
export type DailySalePaymentsResult = ReturnType<typeof dailySalePaymentsResult>;

export function dailySalePaymentsOptions(date: unknown, confirmedOffset: unknown, pendingOffset: unknown): DailySalePaymentsOptions {
  const isoDate = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00Z`) : null;
  if (typeof date !== 'string' || !isoDate || !Number.isFinite(isoDate.getTime()) || isoDate.toISOString().slice(0, 10) !== date) {
    throw new SaleWorkspaceError('Choose a valid payment date.');
  }
  const pageOffset = (input: unknown) => {
    if (input === undefined) return 0;
    const offset = typeof input === 'string' && /^\d{1,7}$/.test(input) ? Number(input) : NaN;
    if (!Number.isSafeInteger(offset) || offset > 1000000) throw new SaleWorkspaceError('Choose a valid payments page.');
    return offset;
  };
  return { date, confirmedOffset: pageOffset(confirmedOffset), pendingOffset: pageOffset(pendingOffset) };
}

export function dailySalePaymentsResult(options: DailySalePaymentsOptions, confirmed: DailySalePaymentRow[], pending: DailySalePaymentRow[], groups: DailySalePaymentGroup[]) {
  const totals = { receivedPence: 0, refundsPence: 0, adjustmentsPence: 0, adjustmentCount: 0, pendingPence: 0, confirmedCount: 0, pendingCount: 0 };
  const methods = new Map<string, { method: string; receivedPence: number; refundsPence: number }>();
  for (const group of groups) {
    if (group.status === 'pending') {
      totals.pendingPence += group.amountPence;
      totals.pendingCount += group.count;
      continue;
    }
    totals.confirmedCount += group.count;
    if (group.kind === 'reversal' || group.kind === 'refund-correction') {
      totals.adjustmentsPence += group.amountPence;
      totals.adjustmentCount += group.count;
      continue;
    }
    const method = methods.get(group.method) ?? { method: group.method, receivedPence: 0, refundsPence: 0 };
    if (group.kind === 'refund') {
      totals.refundsPence -= group.amountPence;
      method.refundsPence -= group.amountPence;
    } else {
      totals.receivedPence += group.amountPence;
      method.receivedPence += group.amountPence;
    }
    methods.set(group.method, method);
  }
  if (!Object.values(totals).every(Number.isSafeInteger)) throw new SaleWorkspaceError('Daily totals could not be verified. Review the payments on each sale.', 409);
  return {
    date: options.date,
    confirmedOffset: options.confirmedOffset,
    pendingOffset: options.pendingOffset,
    confirmed,
    pending,
    totals,
    methods: [...methods.values()].sort((a, b) => a.method.localeCompare(b.method, 'en-GB')),
    confirmedHasMore: options.confirmedOffset + confirmed.length < totals.confirmedCount,
    pendingHasMore: options.pendingOffset + pending.length < totals.pendingCount,
  };
}

/** The local preview uses the same date and payment classifications as the stored ledger. */
export function previewDailySalePayments(sales: SaleWorkspaceRecord[], options: DailySalePaymentsOptions) {
  const confirmed: DailySalePaymentRow[] = [], pending: DailySalePaymentRow[] = [], groups: DailySalePaymentGroup[] = [];
  for (const sale of sales) {
    for (const payment of [...sale.payments].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt) || b.id.localeCompare(a.id))) {
      if (payment.status !== 'confirmed' && payment.status !== 'pending') continue;
      const date = payment.status === 'pending' ? payment.expectedDate || payment.date : payment.date;
      if (date !== options.date) continue;
      const row = {
        id: payment.id, saleId: sale.id, saleReference: sale.reference, vehicle: sale.draft.vehicle, registration: sale.draft.registration,
        reference: payment.reference, method: payment.method || 'Unspecified', kind: payment.kind, amountPence: payment.signedAmountPence,
      };
      (payment.status === 'confirmed' ? confirmed : pending).push(row);
      groups.push({ status: payment.status, method: row.method, kind: row.kind, amountPence: row.amountPence, count: 1 });
    }
  }
  return dailySalePaymentsResult(options,
    confirmed.slice(options.confirmedOffset, options.confirmedOffset + dailySalePaymentsPageSize),
    pending.slice(options.pendingOffset, options.pendingOffset + dailySalePaymentsPageSize),
    groups,
  );
}
