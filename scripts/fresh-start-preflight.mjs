/** Operator-only inventory of a proposed fresh start. There is no deletion mode. */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export class PreflightError extends Error {
  constructor(code) { super(code); this.code = code; }
}

// Resolve the already-installed database dependency without importing its pool,
// application entrypoint, tenant backfill, workers or provider configuration.
const requireDatabase = createRequire(new URL('../lib/db/package.json', import.meta.url));
const identifier = value => {
  if (!/^[a-z_]+$/.test(value)) throw new PreflightError('invalid_identifier');
  return `"${value}"`;
};
const count = value => {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) throw new PreflightError('invalid_count');
  return result;
};

// Explicitly exclude credentials, settings, authentication and provider tokens.
// Hashing protected rows happens inside PostgreSQL; their contents never leave it.
const directTables = [
  'enquiries', 'enquiry_events', 'enquiry_emails', 'enquiry_email_drafts',
  'enquiry_email_reply_routes', 'enquiry_email_replies', 'enquiry_photos',
  'enquiry_photo_upload_sessions', 'customer_email_preparations', 'email_outbox',
  'test_drive_declarations', 'leads', 'sale_workspace', 'sale_workspace_counters',
  'sales', 'customers', 'sold_vehicle_follow_ups', 'customer_phone_shares',
  'staff_push_deliveries', 'staff_ai_draft_generations', 'stock_change_customer_outcomes',
  'stock_change_contact_events', 'vehicle_watch_reply_routes', 'dealer_chat', 'vehicles',
];
const childTables = [
  ['lead_events', 'JOIN public.leads parent ON parent.id=t.lead_id'],
  ['vehicle_images', 'JOIN public.vehicles parent ON parent.id=t.vehicle_id'],
  ...['sale_payments', 'invoices', 'sale_revisions', 'sale_fulfilments', 'sale_events',
    'sale_adjustments', 'sale_part_exchanges', 'sale_warranties', 'deal_vault_artifacts']
    .map(table => [table, 'JOIN public.sales parent ON parent.id=t.sale_id']),
  ...['sale_documents', 'signatures', 'acknowledgements']
    .map(table => [table, 'JOIN public.sale_revisions revision ON revision.id=t.revision_id JOIN public.sales parent ON parent.id=revision.sale_id']),
];

const requiredColumns = {
  dealerships: ['id', 'name', 'status'],
  enquiries: ['id', 'dealer_id', 'workspace_revision', 'type', 'status', 'attendance', 'appointment_at', 'appointment_cancelled_at', 'appointment_revision', 'merged_into_id'],
  sale_workspace: ['id', 'dealer_id', 'revision', 'state'],
  leads: ['id', 'dealer_id', 'enquiry_id', 'stage', 'deposit_pence', 'deposit_taken_at'],
  sales: ['id', 'dealer_id', 'enquiry_id', 'lead_id'],
  vehicles: ['id', 'dealer_id', 'inventory_status', 'audit_metadata'],
  enquiry_email_drafts: ['dealer_id', 'enquiry_id', 'content'],
  customer_phone_shares: ['dealer_id', 'payload', 'revoked_at', 'expires_at'],
  sold_vehicle_follow_ups: ['dealer_id', 'sale_id', 'enquiry_id', 'related_enquiry_ids'],
  enquiry_emails: ['enquiry_id'], enquiry_email_replies: ['enquiry_id'], enquiry_email_reply_routes: ['enquiry_id'],
  email_outbox: ['enquiry_id', 'status'], test_drive_declarations: ['enquiry_id'],
  vehicle_watch_reply_routes: ['enquiry_id'], staff_push_deliveries: ['enquiry_id', 'status'], dealer_chat: ['state'],
  sale_revisions: ['id'],
};

export const preflightSchemaRequirements = Object.fromEntries([
  ...new Set([...directTables, ...childTables.map(([table]) => table), ...Object.keys(requiredColumns)]),
].map(table => [table, [...new Set([
  ...(directTables.includes(table) ? ['dealer_id'] : []),
  ...(requiredColumns[table] ?? []),
  ...(table==='lead_events' ? ['lead_id','payload'] : []),
  ...(table==='vehicle_images' ? ['vehicle_id'] : []),
  ...(['sale_documents','signatures','acknowledgements'].includes(table) ? ['revision_id'] : []),
  ...(childTables.some(([name]) => name===table) && !['lead_events','vehicle_images','sale_documents','signatures','acknowledgements'].includes(table) ? ['sale_id'] : []),
])]]));

export const workspaceSql = `
WITH ledger AS (
  SELECT w.*,
    CASE WHEN jsonb_typeof(state->'payments')='array' THEN state->'payments' ELSE '[]'::jsonb END AS payments,
    CASE WHEN jsonb_typeof(state->'documents')='array' THEN state->'documents' ELSE '[]'::jsonb END AS documents
  FROM public.sale_workspace w
)
SELECT id::text,dealer_id,revision,md5(state::text) AS row_fingerprint,
  jsonb_typeof(state) AS state_type,
  jsonb_typeof(state->'draft') AS draft_type,
  jsonb_typeof(state->'payments') AS payments_type,
  jsonb_typeof(state->'documents') AS documents_type,
  jsonb_typeof(state->'events') AS events_type,
  jsonb_typeof(state->'documentArchives') AS archives_type,
  jsonb_typeof(state->'providerPayments') AS provider_payments_type,
  jsonb_array_length(payments) AS payment_count,
  jsonb_array_length(documents) AS document_count,
  (SELECT count(*)::text FROM jsonb_array_elements(documents) d WHERE d->>'type'='invoice') AS invoice_count,
  (SELECT count(*)::text FROM jsonb_array_elements(payments) p WHERE
    jsonb_typeof(p) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p->'id') IS DISTINCT FROM 'string'
    OR coalesce(p->>'id','')=''
    OR coalesce(p->>'status','') NOT IN ('pending','confirmed','cancelled')
    OR coalesce(p->>'kind','') NOT IN ('deposit','part-payment','final-payment','refund','reversal','refund-correction')
    OR jsonb_typeof(p->'amountPence') IS DISTINCT FROM 'number'
    OR coalesce(p->>'amountPence','') !~ '^[0-9]+$'
    OR jsonb_typeof(p->'signedAmountPence') IS DISTINCT FROM 'number'
    OR coalesce(p->>'signedAmountPence','') !~ '^-?[0-9]+$'
  ) AS malformed_payment_count,
  (SELECT count(*)::text FROM jsonb_array_elements(documents) d WHERE
    jsonb_typeof(d) IS DISTINCT FROM 'object'
    OR jsonb_typeof(d->'id') IS DISTINCT FROM 'string'
    OR coalesce(d->>'id','')=''
    OR coalesce(d->>'type','') NOT IN ('invoice','statement','receipt','handover','terms','reservation','vehicle-details')
    OR jsonb_typeof(d->'snapshot') IS DISTINCT FROM 'object'
  ) AS malformed_document_count,
  state#>>'{lifecycle,status}' AS lifecycle_status,
  state->>'completedAt' AS completed_at,
  state#>>'{draft,sourceEnquiryId}' AS source_enquiry_id,
  state#>>'{draft,sourceReservationId}' AS source_reservation_id,
  state#>>'{reviewReminder,enquiryId}' AS review_enquiry_id,
  (state ? 'customerAccess' OR state ? 'customerLinkEmail') AS has_customer_access,
  (state ? 'documentArchives' AND state->'documentArchives'<>'{}'::jsonb) AS has_archives,
  (state ? 'providerPayments' AND state->'providerPayments'<>'{}'::jsonb) AS has_provider_payments,
  (state ? 'emailDeliveries' AND state->'emailDeliveries'<>'[]'::jsonb) AS has_email_deliveries,
  (state#>'{draft,payments}' IS NOT NULL AND state#>'{draft,payments}' IS DISTINCT FROM state->'payments') AS draft_ledger_disagrees,
  EXISTS(SELECT 1 FROM public.vehicles v WHERE v.dealer_id=ledger.dealer_id AND v.audit_metadata->>'saleWorkspaceId'=ledger.id::text) AS has_stock_ownership,
  EXISTS(SELECT 1 FROM public.sold_vehicle_follow_ups f WHERE f.dealer_id=ledger.dealer_id AND f.sale_id=ledger.id) AS has_sold_followups
FROM ledger ORDER BY dealer_id,id`;

export const enquirySql = `
SELECT e.id::text,e.dealer_id,e.workspace_revision,e.status,
  md5(to_jsonb(e)::text) AS row_fingerprint,
  (e.type='viewing' OR e.appointment_at IS NOT NULL OR e.appointment_cancelled_at IS NOT NULL OR e.appointment_revision>0) AS has_booking_history,
  (e.appointment_at>transaction_timestamp() AND e.appointment_cancelled_at IS NULL AND e.attendance='scheduled') AS has_future_booking,
  (e.merged_into_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.enquiries child WHERE child.merged_into_id=e.id)) AS has_merge_history,
  EXISTS(SELECT 1 FROM public.sale_workspace w WHERE w.dealer_id=e.dealer_id AND strpos((CASE WHEN jsonb_typeof(w.state)='object' THEN w.state-'documentArchives'-'providerPayments'-'requests' ELSE w.state END)::text,e.id::text)>0) AS referenced_by_workspace,
  EXISTS(SELECT 1 FROM public.sales s WHERE s.enquiry_id=e.id) AS linked_legacy_sale,
  EXISTS(SELECT 1 FROM public.leads l WHERE l.enquiry_id=e.id AND (l.deposit_pence>0 OR l.stage<>'new')) AS progressed_or_deposit_lead,
  EXISTS(SELECT 1 FROM public.test_drive_declarations d WHERE d.enquiry_id=e.id) AS has_declaration,
  EXISTS(SELECT 1 FROM public.enquiry_emails m WHERE m.enquiry_id=e.id) AS has_email_journal,
  EXISTS(SELECT 1 FROM public.enquiry_email_replies m WHERE m.enquiry_id=e.id) AS has_customer_reply,
  EXISTS(SELECT 1 FROM public.enquiry_email_reply_routes r WHERE r.enquiry_id=e.id) AS has_reply_route,
  EXISTS(SELECT 1 FROM public.email_outbox o WHERE o.enquiry_id=e.id AND o.status IN ('queued','sending')) AS has_active_outbox,
  EXISTS(SELECT 1 FROM public.sold_vehicle_follow_ups f WHERE f.enquiry_id=e.id OR f.related_enquiry_ids ? e.id::text) AS has_sold_followup,
  EXISTS(SELECT 1 FROM public.enquiry_email_drafts d WHERE d.enquiry_id=e.id AND
    (CASE WHEN jsonb_typeof(d.content->'documentIds')='array' THEN jsonb_array_length(d.content->'documentIds')>0
      ELSE d.content ? 'documentIds' AND d.content->'documentIds'<>'null'::jsonb END)) AS has_document_draft,
  EXISTS(SELECT 1 FROM public.customer_phone_shares s WHERE s.dealer_id=e.dealer_id AND strpos(s.payload::text,e.id::text)>0) AS has_phone_share,
  EXISTS(SELECT 1 FROM public.vehicle_watch_reply_routes r WHERE r.enquiry_id=e.id) AS has_watch_reply_route,
  EXISTS(SELECT 1 FROM public.staff_push_deliveries p WHERE p.enquiry_id=e.id AND p.status IN ('pending','sending')) AS has_active_push,
  EXISTS(SELECT 1 FROM public.dealer_chat c WHERE c.dealer_id=e.dealer_id AND strpos(c.state::text,e.id::text)>0) AS has_chat_reference
FROM public.enquiries e ORDER BY e.dealer_id,e.id`;

const bookingFlags = ['has_booking_history', 'has_future_booking', 'has_merge_history', 'referenced_by_workspace', 'linked_legacy_sale', 'progressed_or_deposit_lead', 'has_declaration', 'has_email_journal', 'has_customer_reply', 'has_reply_route', 'has_active_outbox', 'has_sold_followup', 'has_document_draft', 'has_phone_share', 'has_watch_reply_route', 'has_active_push', 'has_chat_reference'];

export function classifyWorkspace(row) {
  const reasons = [];
  for (const [field, expected] of [['state_type', 'object'], ['draft_type', 'object'], ['payments_type', 'array'], ['documents_type', 'array'], ['events_type', 'array']]) {
    if (row[field] !== expected) reasons.push(`${field}:${row[field] ?? 'missing'}`);
  }
  for (const field of ['archives_type', 'provider_payments_type']) {
    if (row[field] != null && row[field] !== 'object') reasons.push(`${field}:${row[field]}`);
  }
  if (count(row.malformed_payment_count)) reasons.push('malformed_payment_entries');
  if (count(row.malformed_document_count)) reasons.push('malformed_document_entries');
  if (row.draft_ledger_disagrees) reasons.push('draft_ledger_disagrees');
  if (row.lifecycle_status && !['draft', 'reserved', 'sold', 'released'].includes(row.lifecycle_status)) reasons.push('unknown_lifecycle_status');
  return {
    id: row.id, revision: count(row.revision), fingerprint: row.row_fingerprint,
    payments: count(row.payment_count), documents: count(row.document_count), invoices: count(row.invoice_count),
    lifecycle: row.lifecycle_status ?? null,
    completed: Boolean(row.completed_at),
    customerAccess: row.has_customer_access === true,
    archives: row.has_archives === true,
    providerPayments: row.has_provider_payments === true,
    emailHistory: row.has_email_deliveries === true,
    stockOwnership: row.has_stock_ownership === true,
    soldFollowups: row.has_sold_followups === true,
    sourceEnquiryId: row.source_enquiry_id || null,
    sourceReservationId: row.source_reservation_id || null,
    reviewEnquiryId: row.review_enquiry_id || null,
    malformedOrUnknown: reasons,
    // Even a structurally empty ledger is not proof that a draft is disposable.
    deletionEligibility: 'not_assessed',
  };
}

export async function collectPreflight(client) {
  let begun = false;
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY'); begun = true;
    await client.query("SET LOCAL statement_timeout='60s'");
    await client.query("SET LOCAL lock_timeout='3s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='60s'");
    const transaction = (await client.query('SELECT transaction_timestamp() AS at,current_setting(\'transaction_read_only\') AS read_only,current_setting(\'transaction_isolation\') AS isolation')).rows[0];
    if (transaction?.read_only !== 'on' || transaction?.isolation !== 'repeatable read') throw new PreflightError('read_only_not_confirmed');
    const columns = (await client.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position")).rows;
    const schema = new Map();
    for (const row of columns) {
      const existing = schema.get(row.table_name) ?? new Set(); existing.add(row.column_name); schema.set(row.table_name, existing);
    }
    for (const [table, names] of Object.entries(preflightSchemaRequirements)) if (!schema.has(table) || names.some(name => !schema.get(table)?.has(name))) throw new PreflightError('schema_mismatch');

    const dealerships = (await client.query('SELECT id,name,status FROM public.dealerships ORDER BY id')).rows;
    const dealerMap = new Map(dealerships.map(row => [row.id, { dealerId: row.id, name: row.name, status: row.status, registered: true, tables: {}, enquiries: [], sales: [] }]));
    const dealerFor = id => {
      if (typeof id !== 'string' || !id) throw new PreflightError('unknown_tenant_scope');
      if (!dealerMap.has(id)) dealerMap.set(id, { dealerId: id, name: null, status: null, registered: false, tables: {}, enquiries: [], sales: [] });
      return dealerMap.get(id);
    };
    for (const [table, join] of [...directTables.map(name => [name, '']), ...childTables]) {
      const scope = join ? 'parent.dealer_id' : 't.dealer_id';
      const rows = (await client.query(`SELECT dealer_id,count(*)::text AS row_count,md5(coalesce(string_agg(row_hash,'' ORDER BY row_hash),'')) AS fingerprint
        FROM (SELECT ${scope} AS dealer_id,md5(to_jsonb(t)::text) AS row_hash FROM public.${identifier(table)} t ${join}) scoped GROUP BY dealer_id ORDER BY dealer_id`)).rows;
      for (const row of rows) dealerFor(row.dealer_id).tables[table] = { count: count(row.row_count), fingerprint: row.fingerprint };
    }
    const workspaceRows = (await client.query(workspaceSql)).rows;
    for (const row of workspaceRows) dealerFor(row.dealer_id).sales.push(classifyWorkspace(row));
    const enquiryRows = (await client.query(enquirySql)).rows;
    for (const row of enquiryRows) dealerFor(row.dealer_id).enquiries.push({
      id: row.id, revision: count(row.workspace_revision), fingerprint: row.row_fingerprint, status: row.status,
      referencesAndHistory: bookingFlags.filter(flag => row[flag] === true), deletionEligibility: 'not_assessed',
    });
    const facts = (await client.query(`SELECT l.dealer_id,
      count(*)::text AS leads,
      count(*) FILTER(WHERE l.deposit_pence>0 OR l.deposit_taken_at IS NOT NULL)::text AS deposit_leads,
      count(*) FILTER(WHERE l.stage IN ('reserved','sale_agreed','collected'))::text AS progressed_leads,
      count(*) FILTER(WHERE EXISTS(SELECT 1 FROM public.lead_events e WHERE e.lead_id=l.id AND e.payload->>'kind' IN ('online_reservation','online_stripe_reservation')))::text AS reservation_leads
      FROM public.leads l GROUP BY l.dealer_id ORDER BY l.dealer_id`)).rows;
    for (const row of facts) dealerFor(row.dealer_id).leadSummary = { total: count(row.leads), withDepositHistory: count(row.deposit_leads), progressed: count(row.progressed_leads), historicalOnlineReservations: count(row.reservation_leads) };
    const dependencies = (await client.query(`SELECT c.conname,c.conrelid::regclass::text AS child_table,c.confrelid::regclass::text AS parent_table,pg_get_constraintdef(c.oid) AS definition
      FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace
      WHERE n.nspname='public' AND c.contype='f' AND c.confrelid IN ('public.enquiries'::regclass,'public.leads'::regclass,'public.sale_workspace'::regclass,'public.sales'::regclass)
      ORDER BY parent_table,child_table,c.conname`)).rows;
    const dealers = [...dealerMap.values()].sort((a, b) => a.dealerId.localeCompare(b.dealerId));
    for (const dealer of dealers) {
      for (const table of [...directTables, ...childTables.map(([name]) => name)]) dealer.tables[table] ??= { count: 0, fingerprint: null };
      dealer.leadSummary ??= { total: 0, withDepositHistory: 0, progressed: 0, historicalOnlineReservations: 0 };
      dealer.summary = {
        enquiries: dealer.enquiries.length,
        futureBookings: dealer.enquiries.filter(row => row.referencesAndHistory.includes('has_future_booking')).length,
        bookingHistory: dealer.enquiries.filter(row => row.referencesAndHistory.includes('has_booking_history')).length,
        enquiriesWithReferencesOrHistory: dealer.enquiries.filter(row => row.referencesAndHistory.length>0).length,
        workspaceSales: dealer.sales.length,
        workspacePaymentEntries: dealer.sales.reduce((sum, row) => sum+row.payments, 0),
        workspaceDocumentEntries: dealer.sales.reduce((sum, row) => sum+row.documents, 0),
        workspaceInvoices: dealer.sales.reduce((sum, row) => sum+row.invoices, 0),
        workspaceMalformedOrUnknown: dealer.sales.filter(row => row.malformedOrUnknown.length>0).length,
        workspaceReservedOrSold: dealer.sales.filter(row => ['reserved','sold'].includes(row.lifecycle) || row.completed).length,
        workspaceWithStockOrFollowups: dealer.sales.filter(row => row.stockOwnership || row.soldFollowups).length,
        legacySales: dealer.tables.sales.count,
        legacyInvoices: dealer.tables.invoices.count,
        legacyPayments: dealer.tables.sale_payments.count,
        customerRecords: dealer.tables.customers.count,
      };
    }
    const report = {
      schemaVersion: 1, mode: 'all_dealerships_read_only_preflight', snapshotAt: new Date(transaction.at).toISOString(),
      transaction: { readOnly: true, isolation: 'repeatable read' },
      writesPerformed: 0, importsAttempted: 0, customerMessagesSent: 0,
      deletionAuthorized: false, deletionCandidatesAssessed: false,
      protectedScope: ['issued_invoices_and_documents','payments_and_refunds','invoice_number_counters','customer_records','stock_and_vehicle_status','reservations','settings_and_staff_access'],
      warnings: ['Counts include genuine and test records; labels are not proof of disposability.', 'A blank portal across all dealerships conflicts with retaining existing financial and linked customer history. Exact cleanup scope requires a separate review.', 'No eligibility or deletion authorization can be inferred from this report.', 'Fingerprints describe this snapshot only; a later operation must recheck current records and dependencies.'],
      dealers, foreignKeyDependencies: dependencies,
    };
    await client.query('ROLLBACK'); begun = false;
    return { ...report, reportFingerprint: createHash('sha256').update(JSON.stringify(report)).digest('hex') };
  } finally {
    if (begun) await client.query('ROLLBACK').catch(() => {});
  }
}

export function parseArguments(args) {
  if (args.length === 1 && args[0] === '--help') return { help: true };
  if (args[0] !== '--all-dealers') throw new PreflightError('invalid_arguments');
  if (args.length === 1) return { help: false, output: null };
  if (args.length !== 3 || args[1] !== '--output' || !args[2] || args[2].startsWith('--')) throw new PreflightError('invalid_arguments');
  return { help: false, output: path.resolve(args[2]) };
}

export async function main(args = process.argv.slice(2), environment = process.env) {
  const options = parseArguments(args);
  if (options.help) {
    console.log('Read only: node scripts/fresh-start-preflight.mjs --all-dealers [--output /private/path/report.json]');
    return;
  }
  if (!environment.DATABASE_URL) throw new PreflightError('missing_database_configuration');
  const { Client } = requireDatabase('pg');
  const client = new Client({ connectionString: environment.DATABASE_URL, connectionTimeoutMillis: 10_000,
    statement_timeout: 60_000, idle_in_transaction_session_timeout: 60_000, application_name: 'luxxy_fresh_start_preflight_read_only' });
  let report;
  try { await client.connect(); report = await collectPreflight(client); }
  finally { await client.end().catch(() => {}); }
  if (options.output) await writeFile(options.output, JSON.stringify(report, null, 2)+'\n', { flag: 'wx', mode: 0o600 });
  // Stdout is summary-only; exact opaque IDs/fingerprints stay in the private report.
  console.log(JSON.stringify({ mode: report.mode, snapshotAt: report.snapshotAt, writesPerformed: 0,
    deletionAuthorized: false, reportFingerprint: report.reportFingerprint,
    outputWritten: Boolean(options.output), dealers: report.dealers.map(dealer => ({ dealerId: dealer.dealerId, name: dealer.name, registered: dealer.registered, ...dealer.summary })) }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch(error => {
    // SQL/provider errors can contain private values. Never print their messages,
    // connection strings, configuration, stack or customer row contents.
    console.error(JSON.stringify({ status: 'failed', code: error instanceof PreflightError ? error.code : error?.code==='EEXIST' ? 'report_already_exists' : 'preflight_unavailable',
      message: 'Preflight did not complete. No database records were changed.' }));
    process.exitCode = 1;
  });
}
