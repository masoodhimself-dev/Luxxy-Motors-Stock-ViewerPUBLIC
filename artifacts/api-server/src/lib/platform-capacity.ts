type CapacityRow = {
  id: string; name: string; active_key_count: number;
  last_success_received_at: Date | string | null; last_success_scraped_at: Date | string | null;
  last_attempt_at: Date | string | null; last_attempt_status: string | null;
};
export const importCapacitySql = `
WITH eligible AS (
  SELECT d.id, d.name FROM dealerships d
  WHERE d.status = 'active'
    AND NOT EXISTS (SELECT 1 FROM dealer_demos demo WHERE demo.dealer_id = d.id AND demo.converted_at IS NULL)
), latest_attempt AS (
  SELECT DISTINCT ON (r.dealer_id) r.dealer_id, r.received_at, r.status
  FROM stock_import_runs r JOIN eligible d ON d.id = r.dealer_id
  ORDER BY r.dealer_id, r.received_at DESC, r.id DESC
), latest_success AS (
  SELECT DISTINCT ON (r.dealer_id) r.dealer_id, r.received_at, r.scraped_at
  FROM stock_import_runs r JOIN eligible d ON d.id = r.dealer_id
  WHERE r.status = 'completed'
  ORDER BY r.dealer_id, r.received_at DESC, r.id DESC
), keys AS (
  SELECT k.dealer_id, count(*)::int AS active_key_count
  FROM dealer_import_keys k JOIN eligible d ON d.id = k.dealer_id
  WHERE k.disabled_at IS NULL GROUP BY k.dealer_id
)
SELECT d.id, d.name, coalesce(k.active_key_count, 0) AS active_key_count,
  s.received_at AS last_success_received_at, s.scraped_at AS last_success_scraped_at,
  a.received_at AS last_attempt_at, a.status AS last_attempt_status
FROM eligible d LEFT JOIN latest_attempt a ON a.dealer_id = d.id
LEFT JOIN latest_success s ON s.dealer_id = d.id LEFT JOIN keys k ON k.dealer_id = d.id
ORDER BY lower(d.name), d.id`;

function iso(value: Date | string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function importCapacitySummary(rows: CapacityRow[], now = Date.now()) {
  const dealers = rows.map(row => {
    const lastSuccessfulCollectionAt = iso(row.last_success_scraped_at);
    const ageSeconds = lastSuccessfulCollectionAt ? Math.max(0, Math.floor((now - Date.parse(lastSuccessfulCollectionAt)) / 1_000)) : null;
    const freshness = ageSeconds === null ? 'missing' : ageSeconds >= 14 * 3_600 ? 'critical' : ageSeconds >= 13 * 3_600 ? 'warning' : 'fresh';
    const connectionConfigured = Number(row.active_key_count) > 0;
    const lastAttemptStatus = row.last_attempt_status;
    const latestAttemptFailed = lastAttemptStatus === 'failed' || lastAttemptStatus === 'quarantined';
    return {
      dealerId: row.id, name: row.name, connectionConfigured, freshness, ageSeconds,
      lastSuccessfulCollectionAt, lastSuccessfulImportAt: iso(row.last_success_received_at),
      lastAttemptAt: iso(row.last_attempt_at), lastAttemptStatus,
      needsAttention: !connectionConfigured || freshness !== 'fresh' || latestAttemptFailed,
    };
  });
  return {
    available: true, dealerCount: dealers.length,
    attentionCount: dealers.filter(dealer => dealer.needsAttention).length,
    missingConnectionCount: dealers.filter(dealer => !dealer.connectionConfigured).length,
    neverImportedCount: dealers.filter(dealer => dealer.freshness === 'missing').length,
    warningCount: dealers.filter(dealer => dealer.freshness === 'warning').length,
    criticalCount: dealers.filter(dealer => dealer.freshness === 'critical').length,
    warningAfterHours: 13, criticalAfterHours: 14,
    dealers,
  };
}
