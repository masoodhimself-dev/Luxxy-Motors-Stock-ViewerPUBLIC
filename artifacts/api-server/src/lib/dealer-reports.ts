/** Read-only operational counts. No website tracking or customer details are returned. */
export type ReportPeriod = '30d' | '90d';
type Queryable = { query: (sql: string, params: any[]) => Promise<{ rows: Record<string, any>[] }> };
export type DealerReport = {
  period: ReportPeriod; from: string; to: string;
  enquiries: { received: number; newNow: number };
  bookings: { scheduled: number; pending: number };
  sales: { completed: number | null } | null;
  popularVehicles: Array<{ vehicleId: string; title: string; enquiries: number }>;
};

/** A rolling window ending at request time, rather than a calendar-month estimate. */
export async function readDealerReport(db: Queryable, dealerId: string, period: ReportPeriod, includeSales: boolean, now = new Date()): Promise<DealerReport> {
  const to = now.toISOString();
  const from = new Date(now.getTime() - (period === '90d' ? 90 : 30) * 86_400_000).toISOString();
  // Each query is dealer-scoped. Enquiry and appointment indexes already begin
  // with dealer_id; no customer messages, contacts or archived PDFs are read.
  const [enquiryRows, newRows, bookingRows, vehicleRows, saleRows] = await Promise.all([
    // Historical received records remain counted even if staff later merge them.
    db.query(`SELECT count(*)::int AS received FROM enquiries
      WHERE dealer_id=$1 AND created_at >= $2::timestamptz AND created_at < $3::timestamptz`, [dealerId, from, to]),
    db.query(`SELECT count(*)::int AS new_now FROM enquiries
      WHERE dealer_id=$1 AND status='new' AND merged_into_id IS NULL`, [dealerId]),
    db.query(`SELECT
      count(*) FILTER (WHERE appointment_status = 'confirmed' OR appointment_status IS NULL)::int AS scheduled,
      count(*) FILTER (WHERE appointment_status = 'pending')::int AS pending
      FROM enquiries WHERE dealer_id=$1 AND type='viewing'
      AND appointment_cancelled_at IS NULL AND appointment_at >= $2::timestamptz AND appointment_at < $3::timestamptz`, [dealerId, from, to]),
    db.query(`SELECT e.vehicle_id::text AS vehicle_id, coalesce(nullif(btrim(v.title), ''), nullif(max(nullif(btrim(e.vehicle_title), '')), ''), 'Car') AS title, count(*)::int AS enquiry_count
      FROM enquiries e LEFT JOIN vehicles v ON v.id=e.vehicle_id AND v.dealer_id=e.dealer_id
      WHERE e.dealer_id=$1 AND e.vehicle_id IS NOT NULL
      AND e.created_at >= $2::timestamptz AND e.created_at < $3::timestamptz
      GROUP BY e.vehicle_id, v.title ORDER BY count(*) DESC, e.vehicle_id ASC LIMIT 5`, [dealerId, from, to]),
    // `completedAt` is the authoritative completion event. JSON timestamps are
    // selected without loading the full state (which may include archived PDFs).
    includeSales ? db.query(`SELECT state->>'completedAt' AS completed_at, state#>>'{lifecycle,status}' AS lifecycle_status
      FROM sale_workspace WHERE dealer_id=$1 AND updated_at >= $2::timestamptz AND state ? 'completedAt'`, [dealerId, from]) : Promise.resolve({ rows: [] }),
  ]);
  let sales: DealerReport['sales'] = null;
  if (includeSales) {
    let completed = 0;
    let valid = true;
    for (const row of saleRows.rows) {
      // Refuse to publish an inaccurate count if persisted completion data is malformed.
      if (typeof row.completed_at !== 'string' || !Number.isFinite(Date.parse(row.completed_at))) { valid = false; continue; }
      const timestamp = Date.parse(row.completed_at);
      if (row.lifecycle_status !== 'released' && timestamp >= Date.parse(from) && timestamp < now.getTime()) completed++;
    }
    sales = { completed: valid ? completed : null };
  }
  return {
    period, from, to,
    enquiries: { received: Number(enquiryRows.rows[0]?.received ?? 0), newNow: Number(newRows.rows[0]?.new_now ?? 0) },
    bookings: { scheduled: Number(bookingRows.rows[0]?.scheduled ?? 0), pending: Number(bookingRows.rows[0]?.pending ?? 0) },
    sales,
    popularVehicles: vehicleRows.rows.map(row => ({ vehicleId: String(row.vehicle_id), title: String(row.title), enquiries: Number(row.enquiry_count) })),
  };
}
