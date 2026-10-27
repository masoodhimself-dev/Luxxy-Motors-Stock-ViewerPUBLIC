import type { DealerReport, ReportPeriod } from './dealer-reports';

type Queryable = { query: (sql: string, params: any[]) => Promise<{ rows: Record<string, any>[] }> };

/** Report only data created within this test session and its isolated sales namespace. */
export async function readTestModeReport(db: Queryable, sessionId: string, sandboxDealerId: string, period: ReportPeriod, includeSales: boolean, now = new Date()): Promise<DealerReport> {
  const to = now.toISOString();
  const from = new Date(now.getTime() - (period === '90d' ? 90 : 30) * 86_400_000).toISOString();
  const [enquiries, newEnquiries, bookings, cars, sales] = await Promise.all([
    db.query(`SELECT count(*)::int AS received FROM sales_test_enquiries WHERE session_id=$1 AND created_at >= $2::timestamptz AND created_at < $3::timestamptz`, [sessionId, from, to]),
    db.query(`SELECT count(*)::int AS new_now FROM sales_test_enquiries WHERE session_id=$1`, [sessionId]),
    db.query(`SELECT count(*) FILTER (WHERE appointment_status='confirmed')::int AS scheduled, count(*) FILTER (WHERE appointment_status='pending')::int AS pending FROM sales_test_enquiries WHERE session_id=$1 AND appointment_at >= $2::timestamptz AND appointment_at < $3::timestamptz`, [sessionId, from, to]),
    db.query(`SELECT vehicle_id::text, max(vehicle_title) AS title, count(*)::int AS enquiry_count FROM sales_test_enquiries WHERE session_id=$1 AND created_at >= $2::timestamptz AND created_at < $3::timestamptz GROUP BY vehicle_id ORDER BY count(*) DESC,vehicle_id LIMIT 5`, [sessionId, from, to]),
    includeSales ? db.query(`SELECT state->>'completedAt' AS completed_at, state#>>'{lifecycle,status}' AS lifecycle_status FROM sale_workspace WHERE dealer_id=$1 AND updated_at >= $2::timestamptz AND state ? 'completedAt'`, [sandboxDealerId, from]) : Promise.resolve({rows: []}),
  ]);
  let completed: number | null = 0;
  for (const sale of sales.rows) {
    if (typeof sale.completed_at !== 'string' || !Number.isFinite(Date.parse(sale.completed_at))) { completed = null; break; }
    const timestamp = Date.parse(sale.completed_at);
    if (sale.lifecycle_status !== 'released' && timestamp >= Date.parse(from) && timestamp < now.getTime()) completed++;
  }
  return { period, from, to, enquiries: {received: Number(enquiries.rows[0]?.received ?? 0), newNow: Number(newEnquiries.rows[0]?.new_now ?? 0)}, bookings: {scheduled: Number(bookings.rows[0]?.scheduled ?? 0), pending:Number(bookings.rows[0]?.pending ?? 0)}, sales: includeSales ? {completed} : null, popularVehicles: cars.rows.map(row => ({vehicleId:String(row.vehicle_id),title:String(row.title),enquiries:Number(row.enquiry_count)})) };
}
