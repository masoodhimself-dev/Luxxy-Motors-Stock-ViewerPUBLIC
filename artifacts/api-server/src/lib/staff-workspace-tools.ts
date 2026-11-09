import {
  saleWorkspaceTotals,
  type SaleWorkspaceRecord,
} from "@workspace/vehicle-meta";

export type WorkspaceDatabase = {
  query(sql: string, values?: any[]): Promise<{ rows: any[] }>;
};
export class WorkspaceToolsError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const validWorkspaceId = (id: string) =>
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id);
export const presenceLifetimeMs = 90_000;
const iso = (value: unknown) =>
  value ? new Date(String(value)).toISOString() : null;

/** Tenant predicates precede every match; results never contain message bodies or document snapshots. */
export async function searchWorkspace(
  database: WorkspaceDatabase,
  dealer: string,
  input: string,
  canCustomers: boolean,
) {
  const q = input.trim();
  if (q.length < 2 || q.length > 120)
    throw new WorkspaceToolsError("Enter between 2 and 120 characters.");
  const escaped = q.replace(/[\\%_]/g, "\\$&"),
    pattern = `%${escaped}%`;
  const vehicles = await database.query(
    `SELECT id,coalesce(website_title_override,title,'Vehicle') AS title,coalesce(plate,vrm,registration,'') AS registration FROM vehicles WHERE dealer_id=$1 AND concat_ws(' ',title,make,model,plate,vrm,registration) ILIKE $2 ESCAPE '\\' ORDER BY first_seen_at DESC LIMIT 8`,
    [dealer, pattern],
  );
  const enquiries = canCustomers
    ? await database.query(
        `SELECT id,customer_name,vehicle_title,vehicle_registration FROM enquiries WHERE dealer_id=$1 AND concat_ws(' ',customer_name,email,phone,reference,vehicle_title,vehicle_registration) ILIKE $2 ESCAPE '\\' ORDER BY updated_at DESC LIMIT 8`,
        [dealer, pattern],
      )
    : { rows: [] };
  const sales = await database.query(
    `SELECT id,reference,state#>>'{draft,customer}' AS customer,state#>>'{draft,vehicle}' AS vehicle,state#>>'{draft,registration}' AS registration FROM sale_workspace WHERE dealer_id=$1 AND (concat_ws(' ',reference,state#>>'{draft,customer}',state#>>'{draft,vehicle}',state#>>'{draft,registration}') ILIKE $2 ESCAPE '\\' OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(state->'documents')='array' THEN state->'documents' ELSE '[]'::jsonb END) d WHERE d->>'number' ILIKE $2 ESCAPE '\\')) ORDER BY updated_at DESC LIMIT 8`,
    [dealer, pattern],
  );
  return {
    results: [
      ...vehicles.rows.map((r) => ({
        kind: "car",
        id: r.id,
        title: r.title,
        detail: r.registration,
        href: `/portal?section=cars&carId=${r.id}`,
      })),
      ...enquiries.rows.map((r) => ({
        kind: "customer",
        id: r.id,
        title: r.customer_name,
        detail: [r.vehicle_title, r.vehicle_registration]
          .filter(Boolean)
          .join(" · "),
        href: `/portal?section=notifications&workView=customers&enquiryId=${r.id}`,
      })),
      ...sales.rows.map((r) => ({
        kind: "sale",
        id: r.id,
        title: `${r.reference} · ${r.customer || "Customer to add"}`,
        detail: [r.vehicle, r.registration].filter(Boolean).join(" · "),
        href: `/portal?section=sales&saleId=${r.id}`,
      })),
    ],
  };
}

/** A shared, expiring indication of who is composing, not a replacement for revision checks. */
export class ReplyPresenceStore {
  constructor(
    private database: WorkspaceDatabase,
    private clock = () => new Date(),
  ) {}
  async read(dealer: string, enquiry: string) {
    const exists = await this.database.query(
      "SELECT id FROM enquiries WHERE dealer_id=$1 AND id=$2::uuid",
      [dealer, enquiry],
    );
    if (!exists.rows.length)
      throw new WorkspaceToolsError("Enquiry not found.", 404);
    const rows = await this.database.query(
      "SELECT staff_id,staff_name,session_id,expires_at FROM staff_reply_presence WHERE dealer_id=$1 AND enquiry_id=$2::uuid AND expires_at>$3",
      [dealer, enquiry, this.clock()],
    );
    return rows.rows[0] ?? null;
  }
  async claim(
    dealer: string,
    enquiry: string,
    staff: { id: string; name: string },
    session: string,
    takeover = false,
  ) {
    const now = this.clock(),
      expires = new Date(now.getTime() + presenceLifetimeMs);
    const result = await this.database.query(
      `INSERT INTO staff_reply_presence(dealer_id,enquiry_id,staff_id,staff_name,session_id,expires_at)
      SELECT $1,$2::uuid,$3,$4,$5::uuid,$6 WHERE EXISTS(SELECT 1 FROM enquiries WHERE dealer_id=$1 AND id=$2::uuid AND archived_at IS NULL)
      ON CONFLICT(dealer_id,enquiry_id) DO UPDATE SET staff_id=EXCLUDED.staff_id,staff_name=EXCLUDED.staff_name,session_id=EXCLUDED.session_id,expires_at=EXCLUDED.expires_at
      WHERE staff_reply_presence.expires_at<=$7 OR staff_reply_presence.session_id=$5::uuid AND staff_reply_presence.staff_id=$3 OR $8
      RETURNING staff_id,staff_name,session_id,expires_at`,
      [
        dealer,
        enquiry,
        staff.id,
        staff.name.slice(0, 120),
        session,
        expires,
        now,
        takeover,
      ],
    );
    return {
      claimed: Boolean(result.rows.length),
      presence: result.rows[0] ?? (await this.read(dealer, enquiry)),
    };
  }
  async release(
    dealer: string,
    enquiry: string,
    staff: string,
    session: string,
  ) {
    await this.database.query(
      "DELETE FROM staff_reply_presence WHERE dealer_id=$1 AND enquiry_id=$2::uuid AND staff_id=$3 AND session_id=$4::uuid",
      [dealer, enquiry, staff, session],
    );
  }
}
export function publicPresence(row: any, staffId: string, session?: string) {
  return row
    ? {
        name: row.staff_name,
        expiresAt: iso(row.expires_at),
        mine: row.staff_id === staffId && row.session_id === session,
      }
    : null;
}

export function reportRange(from: unknown, to: unknown) {
  const valid = (v: unknown): v is string =>
    typeof v === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    !Number.isNaN(Date.parse(v)) &&
    new Date(v).toISOString().slice(0, 10) === v;
  if (
    !valid(from) ||
    !valid(to) ||
    from > to ||
    Date.parse(to) - Date.parse(from) > 366 * 86400000
  )
    throw new WorkspaceToolsError(
      "Choose a valid reporting period of up to one year.",
    );
  return { from, to };
}
export async function workspaceReport(
  database: WorkspaceDatabase,
  dealer: string,
  from: string,
  to: string,
) {
  const counts = (
    await database.query(
      `SELECT count(*)::int AS enquiries,count(*) FILTER(WHERE type='viewing')::int AS test_drives,count(*) FILTER(WHERE attendance='completed')::int AS completed_visits FROM enquiries WHERE dealer_id=$1 AND created_at>=($2::date::timestamp AT TIME ZONE 'Europe/London') AND created_at<(($3::date+1)::timestamp AT TIME ZONE 'Europe/London')`,
      [dealer, from, to],
    )
  ).rows[0];
  // Read calculation inputs only: never load customer contacts, notes, photographs,
  // document archives or inspection evidence into the reporting process.
  const rows = await database.query(
    `SELECT jsonb_build_object(
    'completedAt',state->'completedAt','lifecycle',state->'lifecycle',
    'standaloneReturn',state->'standaloneReturn','returnReplacement',state->'returnReplacement',
    'corrections',CASE WHEN jsonb_typeof(state->'corrections')='array' AND jsonb_array_length(state->'corrections')>0 THEN '[{}]'::jsonb ELSE '[]'::jsonb END,
    'draft',jsonb_build_object('price',state#>'{draft,price}','adjustments',state#>'{draft,adjustments}',
      'exchanges',state#>'{draft,exchanges}','partExchange',state#>'{draft,partExchange}',
      'pxValue',state#>'{draft,pxValue}','deliveryCharge',state#>'{draft,deliveryCharge}',
      'returnCreditPence',state#>'{draft,returnCreditPence}','creditEntries',state#>'{draft,creditEntries}'),
    'payments',CASE WHEN jsonb_typeof(state->'payments')='array' THEN coalesce((SELECT jsonb_agg(jsonb_build_object('status',p->'status','date',p->'date','signedAmountPence',p->'signedAmountPence','amountPence',p->'amountPence')) FROM jsonb_array_elements(state->'payments') p),'[]'::jsonb) ELSE NULL END
    ) AS state FROM sale_workspace WHERE dealer_id=$1 ORDER BY updated_at DESC LIMIT 10001`,
    [dealer],
  );
  if (rows.rows.length > 10000)
    throw new WorkspaceToolsError(
      "This report needs a larger reporting export. Contact platform support.",
      413,
    );
  let receivedPence = 0,
    refundsPence = 0,
    outstandingPence = 0,
    creditPence = 0,
    sold = 0,
    unreviewedBalances = 0;
  for (const { state } of rows.rows as { state: SaleWorkspaceRecord }[]) {
    const soldDay = state.completedAt
      ? new Intl.DateTimeFormat("en-CA", {
          timeZone: "Europe/London",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date(state.completedAt))
      : null;
    if (soldDay && soldDay >= from && soldDay <= to) sold++;
    for (const payment of state.payments ?? [])
      if (
        payment.status === "confirmed" &&
        payment.date >= from &&
        payment.date <= to &&
        Number.isSafeInteger(payment.signedAmountPence)
      ) {
        if (payment.signedAmountPence >= 0)
          receivedPence += payment.signedAmountPence;
        else refundsPence -= payment.signedAmountPence;
      }
    const isReturnedOriginal =
      state.returnReplacement?.direction === "returned";
    const standaloneReturn = Boolean(state.standaloneReturn);
    if (
      state.lifecycle?.status !== "released" &&
      !isReturnedOriginal &&
      (state.lifecycle?.status !== "returned" || standaloneReturn)
    ) {
      const externalRefund =
        Boolean(state.completedAt) &&
        !standaloneReturn &&
        !state.returnReplacement &&
        state.payments?.some(
          (p) => p.status === "confirmed" && p.signedAmountPence < 0,
        );
      if (
        !Array.isArray(state.payments) ||
        state.corrections?.length ||
        externalRefund
      ) {
        unreviewedBalances++;
        continue;
      }
      const balance = saleWorkspaceTotals(state.draft, state.payments).balance;
      if (balance > 0 && !standaloneReturn) outstandingPence += balance;
      else if (balance < 0) creditPence -= balance;
    }
  }
  if (
    ![receivedPence, refundsPence, outstandingPence, creditPence].every(
      Number.isSafeInteger,
    )
  )
    throw new WorkspaceToolsError(
      "Some report amounts need review before they can be totalled.",
      409,
    );
  return {
    from,
    to,
    enquiries: counts?.enquiries ?? 0,
    testDrivesRequested: counts?.test_drives ?? 0,
    testDrivesCompleted: counts?.completed_visits ?? 0,
    carsSold: sold,
    receivedPence,
    refundsPence,
    netReceivedPence: receivedPence - refundsPence,
    currentOutstandingPence: outstandingPence,
    currentCustomerCreditPence: creditPence,
    unreviewedBalances,
    generatedAt: new Date().toISOString(),
  };
}
export function workspaceReportCsv(
  report: Awaited<ReturnType<typeof workspaceReport>>,
) {
  const labels: Record<string, string> = {
    enquiries: "Enquiries received",
    testDrivesRequested: "Test-drive enquiries received",
    testDrivesCompleted: "Completed visits from enquiries received in period",
    carsSold: "Cars marked sold",
    receivedPence: "Confirmed money received (pence)",
    refundsPence: "Confirmed money paid out (pence)",
    netReceivedPence: "Net received (pence)",
    currentOutstandingPence: "Current outstanding across open sales (pence)",
    currentCustomerCreditPence: "Current customer credit (pence)",
    unreviewedBalances: "Balances excluded pending review",
  };
  return (
    '\uFEFF"From","To","Measure","Value"\r\n' +
    Object.entries(labels)
      .map(([key, label]) =>
        [report.from, report.to, label, report[key as keyof typeof report]]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(","),
      )
      .join("\r\n") +
    "\r\n"
  );
}
