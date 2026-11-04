import { SaleWorkspaceError, saleWorkspaceExchanges, saleWorkspacePence, saleWorkspaceTotals, type SaleWorkspaceDraft, type SaleWorkspaceRecord, type SaleWorkspaceTotals } from './sale-workspace.ts';

/** Only editable amounts can come from a preview. Actual money and credits always come from the saved sale. */
export type SaleCalculationFigures = {
  price: string;
  allowances: string[];
  adjustments: Array<{ kind: 'fee' | 'discount'; amount: string }>;
  deliveryCharge: string;
};
export type SaleCalculationSnapshot = {
  version: 1;
  currency: 'GBP';
  pricePence: number;
  allowancesPence: number[];
  feesPence: number[];
  discountsPence: number[];
  deliveryPence: number;
  returnCreditPence: number;
  confirmedPaymentsPence: number[];
  pendingPaymentsPence: number[];
  transferredCreditsPence: number[];
  totals: SaleWorkspaceTotals;
};
export type SaleCalculationCheckResult = {
  status: 'checked' | 'attention' | 'unavailable';
  message: string;
  financialKey: string;
  totals: SaleWorkspaceTotals;
  checkedAt: string;
  cached: boolean;
};
export function saleCalculationFigures(draft: SaleWorkspaceDraft): SaleCalculationFigures {
  return { price: draft.price, allowances: saleWorkspaceExchanges(draft).map(row => row.value), adjustments: (draft.adjustments ?? []).map(({ kind, amount }) => ({ kind, amount })), deliveryCharge: draft.deliveryCharge ?? '' };
}
const money = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 32) throw new SaleWorkspaceError('Check the amounts before previewing.');
  const result = saleWorkspacePence(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new SaleWorkspaceError('Enter amounts with no more than two decimal places.');
  return result;
};
const sorted = (values: number[]) => values.sort((a, b) => a - b);
/** Constructs an allowlisted numeric payload: never includes names, notes, vehicle facts, IDs or references. */
export function saleCalculationSnapshot(sale: Pick<SaleWorkspaceRecord, 'draft' | 'payments'>, input: unknown = saleCalculationFigures(sale.draft)): SaleCalculationSnapshot {
  if (!input || typeof input !== 'object') throw new SaleWorkspaceError('Check the amounts before previewing.');
  const figures = input as SaleCalculationFigures;
  if (!Array.isArray(figures.allowances) || figures.allowances.length > 50 || !Array.isArray(figures.adjustments) || figures.adjustments.length > 50) throw new SaleWorkspaceError('Check the part exchange and extra amounts.');
  const pricePence = money(figures.price), deliveryPence = money(figures.deliveryCharge);
  const allowancesPence = sorted(figures.allowances.map(money)), feesPence: number[] = [], discountsPence: number[] = [];
  for (const row of figures.adjustments) {
    if (!row || !['fee', 'discount'].includes(row.kind)) throw new SaleWorkspaceError('Check the extra amounts and discounts.');
    (row.kind === 'fee' ? feesPence : discountsPence).push(money(row.amount));
  }
  const confirmedPaymentsPence: number[] = [], pendingPaymentsPence: number[] = [];
  const paymentIds = new Set<string>();
  for (const row of sale.payments) {
    if (!row.id || paymentIds.has(row.id)) throw new SaleWorkspaceError('A saved payment is duplicated. Check the payment history.');
    paymentIds.add(row.id);
    if (row.status === 'cancelled') continue;
    if (!['confirmed', 'pending'].includes(row.status) || !Number.isSafeInteger(row.amountPence) || !Number.isSafeInteger(row.signedAmountPence) || row.amountPence <= 0 || money(row.amount) !== row.amountPence || Math.abs(row.signedAmountPence) !== row.amountPence || (['refund', 'reversal'].includes(row.kind) ? row.signedAmountPence >= 0 : row.signedAmountPence <= 0)) throw new SaleWorkspaceError('A saved payment amount needs checking.');
    if (row.status === 'confirmed') confirmedPaymentsPence.push(row.signedAmountPence);
    else pendingPaymentsPence.push(row.amountPence);
  }
  const creditIds = new Set<string>();
  const transferredCreditsPence = (sale.draft.creditEntries ?? []).map(row => {
    if (!row.id || creditIds.has(row.id) || row.signedAmountPence === 0) throw new SaleWorkspaceError('A saved credit amount needs checking.');
    creditIds.add(row.id); return row.signedAmountPence;
  });
  const returnCreditPence = sale.draft.returnCreditPence ?? 0;
  if (!Number.isSafeInteger(returnCreditPence) || returnCreditPence < 0 || transferredCreditsPence.some(value => !Number.isSafeInteger(value))) throw new SaleWorkspaceError('A saved credit amount needs checking.');
  const draft: SaleWorkspaceDraft = { ...sale.draft, price: figures.price, exchanges: figures.allowances.map(value => ({ registration: '', description: '', value })), adjustments: figures.adjustments.map(row => ({ kind: row.kind, amount: row.amount, description: '' })), deliveryCharge: figures.deliveryCharge };
  const totals = saleWorkspaceTotals(draft, sale.payments);
  if (Object.values(totals).some(value => !Number.isSafeInteger(value))) throw new SaleWorkspaceError('The amounts are too large. Check them before continuing.');
  return { version: 1, currency: 'GBP', pricePence, allowancesPence, feesPence: sorted(feesPence), discountsPence: sorted(discountsPence), deliveryPence, returnCreditPence, confirmedPaymentsPence: sorted(confirmedPaymentsPence), pendingPaymentsPence: sorted(pendingPaymentsPence), transferredCreditsPence: sorted(transferredCreditsPence), totals };
}
