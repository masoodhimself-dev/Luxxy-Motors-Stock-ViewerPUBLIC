import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { importActivityDetails } from './lib/platform-import-activity';
test('scopes compact changes, price reductions, missing adverts and timing to the requested dealer', async () => {
 const engine = new PGlite();
 try {
 await engine.exec(`CREATE TABLE stock_import_runs (id text, run_id text, dealer_id text, source text, status text, received_at timestamptz, updated_at timestamptz, raw_snapshot jsonb);
 CREATE TABLE vehicles (id text, advert_id text, title text, dealer_id text);
 CREATE TABLE vehicle_changes (vehicle_id text, import_run_id text, field_name text, old_value jsonb, new_value jsonb);
 INSERT INTO stock_import_runs VALUES ('old','before','a','autotrader','completed','2026-10-12 08:00Z','2026-10-12 08:00:01Z','{"cars":[{"advertId":"gone","title":"Previous car"},{"advertId":"price"}]}'),('new','current','a','autotrader','completed','2026-10-12 20:00Z','2026-10-12 20:00:02Z','{"cars":[{"advertId":"added"},{"advertId":"price"}]}'),('held','held-run','a','autotrader','quarantined','2026-10-13 08:00Z','2026-10-13 08:00:01Z','{"cars":[]}');
 INSERT INTO vehicles VALUES ('v1','added','New car','a'),('v2','price','Car price','a'),('v3','other','Other dealer','b');
 ALTER TABLE stock_import_runs ADD COLUMN raw_snapshot_compacted_at timestamptz;
 INSERT INTO vehicle_changes VALUES ('v1','new','title',null,'"New car"'),('v2','new','sourcePrice','10000','9500'),('v2','new','sourceImages','[]','[{"url":"private-url"}]'),('v3','new','title',null,'"Other dealer"');`);
 const database = drizzle(engine) as any;
 const d = await importActivityDetails(database,'a','current') as any;
 assert.equal(Number(d.duration_ms),2000); assert.equal(Number(d.change_count),2);
 assert.equal(d.changes.find((c:any)=>c.advert_id==='added').added,true);
 assert.equal(d.changes.find((c:any)=>c.advert_id==='price').old_price,'10000');
 assert.deepEqual(d.newly_missing,[{advert_id:'gone',title:'Previous car'}]);
 assert.ok(!JSON.stringify(d).includes('private-url'));
 assert.equal(await importActivityDetails(database,'b','current'),null);
 const held = await importActivityDetails(database,'a','held-run') as any;
 assert.equal(held.duration_ms,null); assert.deepEqual(held.newly_missing,[]);
 await engine.exec("UPDATE stock_import_runs SET raw_snapshot=null,raw_snapshot_compacted_at='2026-10-17 10:00Z' WHERE id='old'");
 const compacted = await importActivityDetails(database,'a','current') as any;
 assert.equal(compacted.snapshot_details_available,false); assert.equal(compacted.newly_missing,null);
 assert.equal(Number(compacted.change_count),2);
 await engine.exec("UPDATE stock_import_runs SET raw_snapshot=null,raw_snapshot_compacted_at='2026-10-17 10:00Z' WHERE id='new'");
 const oldDetails = await importActivityDetails(database,'a','current') as any;
 assert.equal(oldDetails.newly_missing,null); assert.equal(Number(oldDetails.duration_ms),2000);
 } finally {await engine.close();}
});
