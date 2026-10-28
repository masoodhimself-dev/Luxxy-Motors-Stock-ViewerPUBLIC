import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import express from 'express';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { createPostcodeService, distanceMiles, normalisePostcode, validPostcodeSyntax, type PostcodeLocation } from './lib/postcodes';
import { postcodeRouter } from './routes/postcodes';
import { persistDealerLocation } from './lib/postcode-storage';
import { runWithTenant } from './lib/tenant-context';
const record={postcode:'HA2 7LU',latitude:51.573,longitude:-0.371,region:'London',admin_district:'Harrow'};
const result:PostcodeLocation={postcode:record.postcode,latitude:record.latitude,longitude:record.longitude,region:record.region,administrativeArea:record.admin_district};
const ok=(result:unknown)=>new Response(JSON.stringify({status:200,result}),{status:200,headers:{'Content-Type':'application/json'}});
const transport=(fn:(url:string,init?:RequestInit)=>Promise<Response>)=>fn as typeof fetch;
test('formatting is consistent, with syntactic checks distinct from provider verification',()=>{
 for(const input of ['ha27lu',' ha2  7lu ','HA2\t7LU']){assert.equal(normalisePostcode(input),'HA2 7LU');assert.ok(validPostcodeSyntax(input));}
 for(const pc of ['SW1A 1AA','GIR 0AA','BT1 5GS','EH1 1YZ','CF10 1EP'])assert.ok(validPostcodeSyntax(pc));
 for(const pc of ['','London','HA2','HA2 7LL<script>','123456','ZZ1 1ZZ','W1A 0CI'])assert.equal(validPostcodeSyntax(pc),false);
});
test('lookup caches successes, suppresses simultaneous duplicates and expires memory entries',async()=>{
 let calls=0,clock=0;const service=createPostcodeService({now:()=>clock,transport:transport(async()=>{calls++;await new Promise(r=>setTimeout(r,5));return ok(record);})});
 const values=await Promise.all([service.lookup('ha27lu'),service.lookup('HA2 7LU')]);assert.deepEqual(values[0],result);assert.equal(calls,1);
 values[0]!.region='Changed caller copy';assert.deepEqual(await service.lookup('HA2 7LU'),result);
 clock+=24*60*60*1000+1;await service.lookup('HA2 7LU');assert.equal(calls,2);
});
test('persistent cache is reused and cache failures do not discard successful lookups',async()=>{
 let calls=0,writes=0;const service=createPostcodeService({cache:{read:async()=>result,write:async()=>{writes++;}},transport:transport(async()=>{calls++;return ok(record);})});
 assert.deepEqual(await service.lookup('ha27lu'),result);assert.equal(calls,0);assert.equal(writes,0);
 const failed=createPostcodeService({cache:{read:async()=>{throw Error('db');},write:async()=>{throw Error('db');}},transport:transport(async()=>ok(record))});
 assert.deepEqual(await failed.lookup('ha27lu'),result);
});
test('unknown postcodes, bad responses, network errors and timeouts are distinct and not cached',async()=>{
 let calls=0;const invalid=createPostcodeService({transport:transport(async()=>{calls++;return new Response('',{status:404});})});
 await assert.rejects(invalid.lookup('not postcode'),{code:'invalid',status:400});assert.equal(calls,0);
 for(let i=0;i<2;i++)await assert.rejects(invalid.lookup('HA2 7LU'),{code:'not_found',status:404});assert.equal(calls,2);
 for(const response of [()=>ok({}),()=>new Response('bad json'),()=>new Response('',{status:429}),()=>ok({...record,postcode:'SW1A 1AA'})])await assert.rejects(createPostcodeService({transport:transport(async()=>response())}).lookup('HA2 7LU'),{code:'unavailable',status:503});
 await assert.rejects(createPostcodeService({transport:transport(async()=>{throw Error('offline');})}).lookup('HA2 7LU'),{code:'unavailable'});
 const timeout=createPostcodeService({timeoutMs:5,transport:transport(async(_url,init)=>new Promise((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(Error('aborted')))))});
 await assert.rejects(timeout.lookup('HA2 7LU'),{code:'timeout',status:504});
});
test('nullable geography is accepted without inventing a region or coordinates',async()=>{
 const service=createPostcodeService({transport:transport(async()=>ok({...record,latitude:null,longitude:null,region:null,admin_district:null}))});
 assert.deepEqual(await service.lookup('ha27lu'),{...result,latitude:null,longitude:null,region:null,administrativeArea:null});
});
test('suggestions are capped, cached, deduplicated and only use a fixed provider URL',async()=>{
 const urls:string[]=[];const service=createPostcodeService({transport:transport(async url=>{urls.push(url);return ok(Array.from({length:12},()=>record));})});
 assert.deepEqual(await service.autocomplete('h'),[]);assert.deepEqual(await service.autocomplete('ha2'),['HA2 7LU']);assert.deepEqual(await service.autocomplete('HA2'),['HA2 7LU']);assert.equal(urls.length,1);assert.equal(urls[0],'https://api.postcodes.io/postcodes?query=HA2&limit=6');
 await assert.rejects(service.autocomplete('https://evil.test'),{code:'invalid'});
});
test('distance in miles is accurate, symmetric and handles zero and extreme cases',()=>{
 const london={latitude:51.5074,longitude:-0.1278},edinburgh={latitude:55.9533,longitude:-3.1883};
 assert.equal(distanceMiles(london,london),0);assert.ok(Math.abs(distanceMiles(london,edinburgh)-332)<2);assert.equal(distanceMiles(london,edinburgh),distanceMiles(edinburgh,london));
 assert.ok(Number.isFinite(distanceMiles({latitude:0,longitude:0},{latitude:0,longitude:180})));
 assert.throws(()=>distanceMiles({latitude:NaN,longitude:0},london),RangeError);assert.throws(()=>distanceMiles({latitude:91,longitude:0},london),RangeError);
});
test('migration, dealer location isolation, changed postcodes, rollback and expiry work in an isolated database',async()=>{
 const db=new PGlite();try{
 await db.exec('CREATE TABLE dealer_settings(dealer_id text PRIMARY KEY,config jsonb NOT NULL)');
 await db.exec(await readFile('../../lib/db/drizzle/0072_postcode_locations.sql','utf8'));
 await db.query('INSERT INTO dealer_settings VALUES($1,$2),($3,$4)',['a',JSON.stringify({address:{postcode:'HA2 7LU'}}),'b',JSON.stringify({address:{postcode:'SW1A 1AA'}})]);
 const client={query:(sql:string,values?:any[])=>db.query<Record<string,any>>(sql,values)};
 await persistDealerLocation(client,'a',{address:{postcode:'HA2 7LU'}},result);
 await persistDealerLocation(client,'b',{address:{postcode:'SW1A 1AA'}},{...result,postcode:'SW1A 1AA',latitude:51.501,longitude:-0.142});
 assert.equal((await db.query('SELECT * FROM dealer_locations')).rows.length,2);
 await persistDealerLocation(client,'a',{address:{postcode:'HA2 7LU'}},null);
 assert.equal((await db.query('SELECT * FROM dealer_locations WHERE dealer_id=$1',['a'])).rows.length,1);
 await db.exec('BEGIN');await persistDealerLocation(client,'a',{address:{postcode:'SW1A 1AA'}},null);await db.exec('ROLLBACK');
 assert.equal((await db.query('SELECT * FROM dealer_locations WHERE dealer_id=$1',['a'])).rows.length,1);
 await persistDealerLocation(client,'a',{address:{postcode:'SW1A 1AA'}},result);
 assert.equal((await db.query('SELECT * FROM dealer_locations WHERE dealer_id=$1',['a'])).rows.length,0);
 assert.equal((await db.query('SELECT * FROM dealer_locations WHERE dealer_id=$1',['b'])).rows.length,1);
 await db.query("INSERT INTO postcode_lookup_cache VALUES($1,$2,now()-interval '1 second')",[result.postcode,JSON.stringify(result)]);
 assert.equal((await db.query('SELECT * FROM postcode_lookup_cache WHERE expires_at>now()')).rows.length,0);
 }finally{await db.close();}
});
test('HTTP distance uses the resolved tenant, throttles abuse and preserves provider errors',async()=>{
 const db=new PGlite(),server=createServer();try{
 await db.exec('CREATE TABLE dealer_settings(dealer_id text PRIMARY KEY,config jsonb NOT NULL)');await db.exec(await readFile('../../lib/db/drizzle/0072_postcode_locations.sql','utf8'));
 await db.query('INSERT INTO dealer_settings VALUES($1,$2),($3,$4)',['a',JSON.stringify({address:{postcode:'HA2 7LU'}}),'b',JSON.stringify({address:{postcode:'SW1A 1AA'}})]);
 const database={query:(sql:string,values?:any[])=>db.query<Record<string,any>>(sql,values)};
 await persistDealerLocation(database,'a',{address:{postcode:'HA2 7LU'}},result);
 await persistDealerLocation(database,'b',{address:{postcode:'SW1A 1AA'}},{...result,postcode:'SW1A 1AA',latitude:55,longitude:-3});
 const service=createPostcodeService({transport:transport(async()=>ok(record))});
 const app=express();app.use((req,_res,next)=>runWithTenant({dealerId:req.get('x-fixture-dealer')==='b'?'b':'a',canonicalOrigin:'https://example.test',platform:'cazoo',retailerId:'fixture',sourceUrl:'https://example.test'},next));app.use('/api',postcodeRouter(service,database as any));server.on('request',app);server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const body=async(response:Response)=>await response.json() as {location:PostcodeLocation;miles:number|null};
 const get=(path:string,dealer='a')=>fetch(base+path,{headers:{'x-fixture-dealer':dealer}});
 assert.equal((await get('/api/postcodes?postcode=no')).status,400);
 const valid=await get('/api/postcodes?postcode=ha27lu');assert.equal(valid.headers.get('cache-control'),'no-store');assert.deepEqual((await body(valid)).location,result);
 assert.equal((await get('/api/postcodes?postcode=ha27lu&query=HA')).status,400);
 assert.equal((await body(await get('/api/postcodes/distance?postcode=ha27lu&dealerId=b'))).miles,0);
 assert.ok((await body(await get('/api/postcodes/distance?postcode=ha27lu','b'))).miles!>200);
 await db.query('UPDATE dealer_settings SET config=$1 WHERE dealer_id=$2',[JSON.stringify({address:{postcode:'N1 1AA'}}),'a']);
 assert.equal((await body(await get('/api/postcodes/distance?postcode=ha27lu'))).miles,null);
 for(let i=0;i<61;i++)await get('/api/postcodes?query=H');
 const limited=await get('/api/postcodes?query=H');assert.equal(limited.status,429);assert.ok(limited.headers.get('retry-after'));
 assert.equal((await get('/api/postcodes?query=H','b')).status,200);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await db.close();}
});
