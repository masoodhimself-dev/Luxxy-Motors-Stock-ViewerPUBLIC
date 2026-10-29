import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { classifyWorkspace, collectPreflight, enquirySql, parseArguments, preflightSchemaRequirements, workspaceSql } from './fresh-start-preflight.mjs';

const script = fileURLToPath(new URL('./fresh-start-preflight.mjs', import.meta.url));
function workspace(overrides={}) {
  return { id:'sale-id', dealer_id:'dealer-a', revision:1, row_fingerprint:'opaque-row-fingerprint',
    state_type:'object',draft_type:'object',payments_type:'array',documents_type:'array',events_type:'array',
    archives_type:null,provider_payments_type:null,payment_count:0,document_count:0,invoice_count:'0',
    malformed_payment_count:'0',malformed_document_count:'0',lifecycle_status:null,...overrides };
}
function fakeClient(overrides={}) {
  const calls=[];
  return { calls, async query(sql) {
    calls.push(sql);
    if (overrides.reject?.(sql)) throw Error('Private provider detail must not become CLI output.');
    if (sql.startsWith('SELECT transaction_timestamp()')) return { rows:[{ at:new Date('2026-10-29T12:00:00Z'),read_only:overrides.readOnly??'on',isolation:'repeatable read' }] };
    if (sql.includes('FROM information_schema.columns')) return { rows:Object.entries(preflightSchemaRequirements).flatMap(([table_name,names]) => names.map(column_name=>({table_name,column_name}))).filter(row=>row.table_name!==overrides.missingTable) };
    if (sql==='SELECT id,name,status FROM public.dealerships ORDER BY id') return { rows:[{ id:'dealer-a',name:'Dealer A',status:'active' }] };
    if (sql===workspaceSql) return { rows:overrides.workspaces??[] };
    if (sql===enquirySql) return { rows:overrides.enquiries??[] };
    if (sql.startsWith('SELECT l.dealer_id,')) return { rows:[] };
    if (sql.startsWith('SELECT c.conname,')) return { rows:[] };
    return { rows:[] };
  }};
}

test('requires explicit all-dealership read-only scope and rejects every apply/deletion argument',()=>{
  assert.deepEqual(parseArguments(['--all-dealers']),{help:false,output:null});
  assert.equal(parseArguments(['--all-dealers','--output','/tmp/report.json']).output,'/tmp/report.json');
  assert.deepEqual(parseArguments(['--help']),{help:true});
  for (const args of [[],['--apply'],['--all-dealers','--apply'],['--dealer','dealer-a'],['--all-dealers','--output'],['--all-dealers','--output','--apply']]) assert.throws(()=>parseArguments(args));
});

test('opens a repeatable-read read-only transaction and always finishes with rollback',async()=>{
  const client=fakeClient(),report=await collectPreflight(client);
  assert.equal(client.calls[0],'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.ok(client.calls.includes("SET LOCAL statement_timeout='60s'"));
  assert.equal(client.calls.at(-1),'ROLLBACK');
  assert.ok(client.calls.every(sql=>/^(BEGIN TRANSACTION.*READ ONLY|SET LOCAL|SELECT|WITH|ROLLBACK)/.test(sql.trim())));
  assert.ok(!client.calls.some(sql=>/^\s*(DELETE|UPDATE|INSERT|TRUNCATE|ALTER|DROP|COMMIT)\b/.test(sql)));
  assert.equal(report.writesPerformed,0); assert.equal(report.importsAttempted,0);
  assert.equal(report.deletionAuthorized,false); assert.equal(report.deletionCandidatesAssessed,false);
  assert.equal(report.dealers.length,1); assert.equal(report.dealers[0].tables.invoices.count,0);
});

test('fails closed and rolls back when the database cannot confirm read-only operation',async()=>{
  const client=fakeClient({readOnly:'off'});
  await assert.rejects(collectPreflight(client),error=>error.code==='read_only_not_confirmed');
  assert.equal(client.calls.at(-1),'ROLLBACK');
  assert.ok(!client.calls.some(sql=>sql.includes('information_schema')));
});

test('schema drift is reported as a failure rather than treating an unknown ledger as empty',async()=>{
  const client=fakeClient({missingTable:'sale_payments'});
  await assert.rejects(collectPreflight(client),error=>error.code==='schema_mismatch');
  assert.equal(client.calls.at(-1),'ROLLBACK');
  assert.ok(!client.calls.includes(workspaceSql));
});

test('unknown tenants with operational rows remain visible and distinct',async()=>{
  const client=fakeClient({workspaces:[workspace({dealer_id:'unregistered-dealer'})],enquiries:[{id:'enquiry-id',dealer_id:'dealer-a',workspace_revision:3,status:'new',row_fingerprint:'opaque-enquiry',has_future_booking:true,has_booking_history:true,referenced_by_workspace:true}]});
  const report=await collectPreflight(client),known=report.dealers.find(dealer=>dealer.dealerId==='dealer-a'),unknown=report.dealers.find(dealer=>dealer.dealerId==='unregistered-dealer');
  assert.equal(known.summary.enquiries,1); assert.equal(known.summary.futureBookings,1);
  assert.equal(known.summary.workspaceSales,0); assert.equal(unknown.summary.workspaceSales,1);
  assert.equal(unknown.registered,false); assert.equal(unknown.name,null);
  assert.deepEqual(known.enquiries[0].referencesAndHistory,['has_booking_history','has_future_booking','referenced_by_workspace']);
  assert.equal(known.enquiries[0].deletionEligibility,'not_assessed');
});

test('financial document and ledger counts survive in the exact opaque scope report',async()=>{
  const client=fakeClient({workspaces:[workspace({payment_count:2,document_count:3,invoice_count:'1',lifecycle_status:'sold',completed_at:'2026-10-29T11:00:00Z',has_archives:true,has_provider_payments:true,source_enquiry_id:'source-enquiry'})]});
  const report=await collectPreflight(client),dealer=report.dealers[0];
  assert.equal(dealer.summary.workspacePaymentEntries,2); assert.equal(dealer.summary.workspaceDocumentEntries,3);
  assert.equal(dealer.summary.workspaceInvoices,1); assert.equal(dealer.summary.workspaceReservedOrSold,1);
  assert.equal(dealer.sales[0].sourceEnquiryId,'source-enquiry');
  assert.equal(dealer.sales[0].fingerprint,'opaque-row-fingerprint');
  assert.ok(!JSON.stringify(report).includes('Private provider detail'));
});

test('malformed JSON shapes, entries and divergent ledgers are never classified as disposable',()=>{
  const row=classifyWorkspace(workspace({state_type:'array',payments_type:'object',documents_type:'null',draft_type:null,events_type:'string',archives_type:'null',provider_payments_type:'array',malformed_payment_count:'1',malformed_document_count:'2',draft_ledger_disagrees:true,lifecycle_status:'unexpected'}));
  for (const reason of ['state_type:array','payments_type:object','documents_type:null','draft_type:missing','events_type:string','archives_type:null','provider_payments_type:array','malformed_payment_entries','malformed_document_entries','draft_ledger_disagrees','unknown_lifecycle_status']) assert.ok(row.malformedOrUnknown.includes(reason),reason);
  assert.equal(row.deletionEligibility,'not_assessed');
  assert.equal(classifyWorkspace(workspace()).deletionEligibility,'not_assessed');
});

test('query failure rolls back instead of returning a partial report',async()=>{
  const client=fakeClient({reject:sql=>sql===workspaceSql});
  await assert.rejects(collectPreflight(client));
  assert.equal(client.calls.at(-1),'ROLLBACK');
  assert.ok(!client.calls.includes(enquirySql));
});

test('CLI errors never echo configured connection strings or raw provider messages',()=>{
  const credential='postgresql://private-user:private-password@example.invalid/private-db';
  for (const args of [['--apply'],['--all-dealers','--apply']]) {
    const child=spawnSync(process.execPath,[script,...args],{env:{...process.env,DATABASE_URL:credential},encoding:'utf8'});
    assert.equal(child.status,1); assert.equal(child.stdout,'');
    assert.equal(JSON.parse(child.stderr).code,'invalid_arguments');
    assert.ok(!child.stderr.includes(credential)); assert.ok(!child.stderr.includes('private-password'));
  }
  const missing=spawnSync(process.execPath,[script,'--all-dealers'],{env:{...process.env,DATABASE_URL:''},encoding:'utf8'});
  assert.equal(missing.status,1); assert.equal(JSON.parse(missing.stderr).code,'missing_database_configuration');
});
