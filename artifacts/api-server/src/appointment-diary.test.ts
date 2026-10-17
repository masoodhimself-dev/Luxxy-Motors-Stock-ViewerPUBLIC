import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { Request, Response } from "express";
import { getTableColumns } from "drizzle-orm";

// Every row is fictional and all SQL below runs in-process; no provider or real database.
process.env.DATABASE_URL = "postgres://unused:unused@127.0.0.1:1/unused";
process.env.MULTI_TENANT_ENABLED = "true";
const { pool, enquiryEventsTable } = await import("@workspace/db");
const { readAppointmentDiary } = await import("./lib/appointment-diary");
const { appointmentDiaryWindow } = await import("./lib/appointment-diary-window");
const { bookingsForDate } = await import("./lib/booking-store");
const { bookingPressure, defaultBookingPolicy } = await import("./lib/booking-slots");
const { eventsForEnquiries } = await import("./lib/enquiry-events");
const { runWithTenant } = await import("./lib/tenant-context");
const { default: router } = await import("./routes/enquiries");
const tenant = { dealerId: "a", canonicalOrigin: "https://a.example.test", platform: "autotrader" as const, retailerId: "fictional-a", sourceUrl: "https://www.autotrader.co.uk/example" };

function request(date: unknown, staff = true) {
  return runWithTenant(tenant, () => new Promise<{ status: number; data: any }>((resolve, reject) => {
    let status = 200;
    const signedOut = Object.assign(() => ({ userId: null, sessionId: null, tokenType: "session_token" }), { [Symbol.for("@clerk/express.auth")]: true });
    const req = { method: "GET", url: "/staff/enquiries/appointments", query: { date }, headers: {}, auth: signedOut, get: () => undefined, log: { error() {}, warn() {} }, ...(staff ? { staff: { authUserId: "fictional-staff", role: "owner" } } : {}) } as unknown as Request;
    const res = { status(value: number) { status = value; return this; }, json(data: unknown) { resolve({ status, data }); return this; } } as unknown as Response;
    router(req, res, error => error ? reject(error) : reject(new Error("Appointment route did not respond")));
  }));
}

test("day-bounded staff diary preserves adjacent-day overlaps, DST and dealer isolation without old customer history", async () => {
  const engine = new PGlite();
  try {
    await engine.exec(`CREATE TABLE enquiries (id text, dealer_id text, reference text, customer_name text, vehicle_title text, assigned_to_name text, type text, appointment_at timestamptz, appointment_cancelled_at timestamptz, appointment_duration_minutes integer, appointment_buffer_minutes integer);
      INSERT INTO enquiries VALUES
      ('before','a','BEFORE','Before window','Car',null,'viewing','2026-10-23 22:59:59Z',null,30,0),
      ('edge','a','EDGE','At inclusive start','Car',null,'viewing','2026-10-23 23:00:00Z',null,30,0),
      ('overnight','a','OVERNIGHT','Adjacent evening','Car',null,'viewing','2026-10-24 22:45:00Z',null,180,60),
      ('same-day','a','TODAY','Current customer','Car','Fictional Staff','viewing','2026-10-25 10:00:00Z',null,30,0),
      ('next-day','a','NEXT','Next day customer','Car',null,'viewing','2026-10-26 09:00:00Z',null,30,0),
      ('end','a','END','At exclusive end','Car',null,'viewing','2026-10-27 00:00:00Z',null,30,0),
      ('cancelled','a','CANCELLED','Cancelled customer','Car',null,'viewing','2026-10-25 10:00:00Z','2026-10-24 10:00Z',30,0),
      ('other-dealer','b','OTHER','Other dealer customer','Car',null,'viewing','2026-10-25 10:00:00Z',null,30,0),
      ('general','a','GENERAL','Not a viewing','Car',null,'general','2026-10-25 10:00:00Z',null,30,0);
      INSERT INTO enquiries SELECT 'old-' || n, 'a', 'OLD', 'Old customer', 'Car', null, 'viewing', '2020-01-01 10:00Z'::timestamptz, null, 30, 0 FROM generate_series(1,10000) n;
      CREATE INDEX enquiries_dealer_appointment_idx ON enquiries(dealer_id,appointment_at) WHERE appointment_cancelled_at IS NULL;`);
    const connection = drizzle(engine) as any;
    const rows = await readAppointmentDiary("a", "2026-10-25", connection);
    assert.deepEqual(rows.map(row => row.id), ["edge", "overnight", "same-day", "next-day"]);
    assert.equal(Object.keys(rows[0]).length, 8, "the response omits messages, emails, phone numbers, notes and timelines");
    const transactional = await bookingsForDate("a", "2026-10-25", connection);
    assert.deepEqual(rows.map(row => row.id).sort(), transactional.map(row => row.id).sort(), "the staff preview checks the same bookings as a transaction");
    assert.equal(bookingPressure(new Date("2026-10-25T00:00:00Z"), defaultBookingPolicy, rows).overlapping, true, "an adjacent evening appointment can overlap midnight");
    assert.deepEqual((await readAppointmentDiary("b", "2026-10-25", connection)).map(row => row.id), ["other-dealer"]);
    for (const [date, hours] of [["2026-07-06", 72], ["2026-03-29", 71], ["2026-10-25", 73]] as const) {
      const { from, to } = appointmentDiaryWindow(date);
      assert.equal((to.getTime() - from.getTime()) / 3_600_000, hours, date);
    }
  } finally { await engine.close(); }
});

test("staff diary authorises and validates before querying; timeline reads explicitly bind the current dealer", async () => {
  const originalQuery = pool.query;
  const queries: Array<{ text: string; params: unknown[] }> = [];
  (pool as any).query = async (config: { text: string } | string, params: unknown[] = []) => {
    const text = typeof config === "string" ? config : config.text;
    queries.push({ text, params });
    assert.ok(params.includes("a"));
    assert.match(text, /"dealer_id" = \$\d+/);
    if (text.includes('from "enquiry_events"')) {
      const columns = Object.keys(getTableColumns(enquiryEventsTable));
      return { rows: [3, 2, 1].map(number => {
        const event: Record<string, unknown> = { id: String(number), dealerId: "a", enquiryId: "fictional-enquiry", kind: "conversation_logged", actor: "dealer", summary: `Note ${number}`, occurredAt: `2026-10-17T10:00:0${number}.000Z` };
        return columns.map(key => event[key] ?? null);
      }) };
    }
    assert.match(text, /"type" = \$\d+/);
    assert.match(text, /"appointment_cancelled_at" is null/);
    assert.match(text, /"appointment_at" >= \$\d+/);
    assert.match(text, /"appointment_at" < \$\d+/);
    assert.ok(!text.includes("enquiry_events"));
    return { rows: [] };
  };
  try {
    assert.equal((await request("2026-10-25", false)).status, 401);
    for (const date of [undefined, [], ["2026-10-25"], "2026-02-30", "2026-10-25 OR 1=1", "0000-01-01"]) assert.equal((await request(date)).status, 400);
    assert.equal(queries.length, 0);
    const result = await request("2026-10-25");
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, { date: "2026-10-25", timezone: "Europe/London", appointments: [] });
    assert.equal(queries.length, 1);
    const timeline = await runWithTenant(tenant, () => eventsForEnquiries(["fictional-enquiry"]));
    assert.deepEqual(timeline.get("fictional-enquiry")?.map(event => event.summary), ["Note 1", "Note 2", "Note 3"]);
    assert.equal(queries.length, 2);
    await assert.rejects(() => eventsForEnquiries(["fictional-enquiry"]), /verified dealership context/);
    assert.equal(queries.length, 2, "missing tenant context cannot query a timeline");
  } finally { pool.query = originalQuery; await pool.end(); }
});
