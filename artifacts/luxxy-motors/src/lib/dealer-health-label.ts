/** One vocabulary for the network overview and the detailed operations snapshot. */
export function dealerHealthLabel(dealer: { connectionConfigured: boolean; freshness: string; lastAttemptStatus: string | null }) {
  if (!dealer.connectionConfigured) return 'Import credential missing';
  if (dealer.freshness === 'missing') return 'First import needed';
  if (dealer.freshness === 'critical') return 'Stock overdue · 14h+';
  if (dealer.freshness === 'warning') return 'Stock due soon · 13h+';
  if (dealer.lastAttemptStatus === 'failed') return 'Last import failed';
  if (dealer.lastAttemptStatus === 'quarantined') return 'Last import held for review';
  return 'Stock up to date';
}
