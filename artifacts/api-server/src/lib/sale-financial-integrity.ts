import { SaleWorkspaceError, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { saleDeterministicReview } from '../../../../lib/vehicle-meta/src/sale-operations';

/** Exact ledger and document checks run independently of optional AI advice. */
export function assertSaleFinancialIntegrity(sale: SaleWorkspaceRecord, allowCustomerCredit = false) {
  const issue = saleDeterministicReview(sale, { allowCustomerCredit }).find(item => item.severity === 'error' && ['payments', 'invoices', 'handover'].includes(item.field));
  if (issue) throw new SaleWorkspaceError(issue.message, 409);
}
