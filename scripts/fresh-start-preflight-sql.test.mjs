import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { collectPreflight, preflightSchemaRequirements } from './fresh-start-preflight.mjs';

// One disposable, in-memory engine. No DATABASE_URL or application startup code.
const requireApi = createRequire(new URL('../artifacts/api-server/package.json', import.meta.url));
const { PGlite } = requireApi('@electric-sql/pglite');

test('production read-only SQL handles unknown JSON and leaves its isolated fixture unchanged',async()=>{
  const db=new PGlite();
  const jsonColumns=new Set(['state','payload','content','audit_metadata','related_enquiry_ids']);
  const integers=new Set(['revision','workspace_revision','appointment_revision','deposit_pence']);
  const timestamps=new Set(['appointment_at','appointment_cancelled_at','deposit_taken_at','revoked_at','expires_at']);
  const uuids=new Set(['enquiry_id','lead_id','sale_id','revision_id','vehicle_id','merged_into_id']);
  const type=(table,column)=>jsonColumns.has(column)?'jsonb':integers.has(column)?'integer':timestamps.has(column)?'timestamptz':uuids.has(column)||column==='id'&&table!=='dealerships'?'uuid':'text';
  try {
    for (const [table,columns] of Object.entries(preflightSchemaRequirements)) await db.exec(`CREATE TABLE public."${table}" (${columns.map(column=>`"${column}" ${type(table,column)}`).join(',')})`);
    await db.query('INSERT INTO dealerships(id,name,status) VALUES($1,$2,$3)',['fixture-dealer','Fixture Dealer','active']);
    const valid={revision:1,draft:{},payments:[],documents:[],events:[]};
    const malformed={revision:1,draft:{},payments:[null,42,{id:'fixture',amountPence:1.2}],documents:[null,42],events:[]};
    for (const [id,state] of [['00000000-0000-4000-8000-000000000001',valid],['00000000-0000-4000-8000-000000000002','bad scalar'],['00000000-0000-4000-8000-000000000003',malformed]]) await db.query('INSERT INTO sale_workspace(id,dealer_id,revision,state) VALUES($1,$2,1,$3::jsonb)',[id,'fixture-dealer',JSON.stringify(state)]);
    await db.query("INSERT INTO enquiries(id,dealer_id,workspace_revision,type,status,attendance,appointment_revision) VALUES('00000000-0000-4000-8000-000000000004','fixture-dealer',0,'general','new','scheduled',0)");
    const snapshot=async()=>JSON.stringify((await db.query('SELECT state FROM sale_workspace ORDER BY id')).rows);
    const before=await snapshot(),report=await collectPreflight(db);
    assert.equal(report.dealers[0].summary.workspaceSales,3);
    assert.equal(report.dealers[0].summary.workspaceMalformedOrUnknown,2);
    assert.equal(report.dealers[0].summary.enquiries,1);
    assert.equal(await snapshot(),before);
    const results=await db.exec(await readFile(new URL('./fresh-start-counts.sql',import.meta.url),'utf8'));
    const aggregate=results.flatMap(part=>part.rows??[]).find(row=>row.dealer_id==='fixture-dealer');
    assert.equal(Number(aggregate.workspace_sales),3);
    assert.equal(Number(aggregate.workspace_malformed_or_unknown_ledgers),2);
    assert.equal(aggregate.read_only,'on');
    assert.equal(aggregate.isolation,'repeatable read');
    assert.equal(await snapshot(),before);
  } finally { await db.close(); }
});
