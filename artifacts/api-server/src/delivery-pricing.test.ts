import {GetDealerSettingsResponse,UpdateDealerSettingsBody} from '@workspace/api-zod';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import express from 'express';
import {createRoadDistanceService} from './lib/road-distance';
import {parseDeliveryPricing,deliveryEstimate} from './lib/delivery-pricing';
import {reserveRoadRoutingBudget} from './lib/road-distance-storage';
import {postcodeRouter} from './routes/postcodes';
import {createPostcodeService} from './lib/postcodes';
import {persistDealerLocation} from './lib/postcode-storage';
import {runWithTenant} from './lib/tenant-context';
const origin={latitude:51.57,longitude:-0.37},destination={latitude:51.501,longitude:-0.142};
const transport=(fn:(url:string,init?:RequestInit)=>Promise<Response>)=>fn as typeof fetch;
const response=(distance=16093.44)=>new Response(JSON.stringify({routes:[{summary:{distance}}]}),{status:200});
const pricing={enabled:true,basePrice:'50.00',pricePerMile:'1.50'};
test('prices use integer pence and displayed road mileage without changing payments',()=>{
 assert.deepEqual(deliveryEstimate(pricing,23.4*1609.344),{roadMiles:23.4,basePricePence:5000,pricePerMilePence:150,mileageChargePence:3510,totalPence:8510,currency:'GBP',distanceBasis:'driving',estimated:true});assert.equal(deliveryEstimate(pricing,0).totalPence,5000);
 assert.equal(deliveryEstimate({...pricing,basePrice:'0',pricePerMile:'0.01'},0.5*1609.344).totalPence,1);
 for(const bad of ['','-1','NaN','1e3','1.005','100000',' 1','01'])assert.equal(parseDeliveryPricing({...pricing,basePrice:bad}),null);
 for(const distance of [-1,NaN,Infinity])assert.throws(()=>deliveryEstimate(pricing,distance),RangeError);
});
test('car road routing preserves direction, coalesces requests, caches and keeps keys out of URLs',async()=>{
 const calls:{url:string;init:RequestInit}[]=[];let now=100000;
 const service=createRoadDistanceService({apiKey:()=> 'fixture-only-key',now:()=>now,transport:transport(async(url,init)=>{calls.push({url,init:init!});await new Promise(r=>setTimeout(r,5));return response();})});
 assert.deepEqual(await Promise.all([service.metres(origin,destination),service.metres(origin,destination)]),[16093.44,16093.44]);assert.equal(calls.length,1);
 assert.equal(calls[0]!.url,'https://api.openrouteservice.org/v2/directions/driving-car/json');assert.equal((calls[0]!.init.headers as Record<string,string>).Authorization,'fixture-only-key');assert.deepEqual(JSON.parse(calls[0]!.init.body as string).coordinates,[[-0.37,51.57],[-0.142,51.501]]);
 await service.metres(destination,origin);assert.equal(calls.length,2);now+=7*24*60*60000+1;await service.metres(origin,destination);assert.equal(calls.length,3);
});
test('missing keys, failures, timeouts and provider limits never become straight-line or free estimates',async()=>{
 let calls=0;const noKey=createRoadDistanceService({apiKey:()=>undefined,transport:transport(async()=>{calls++;return response();})});await assert.rejects(noKey.metres(origin,destination),{code:'routing_not_configured'});assert.equal(calls,0);
 for(const reply of [()=>new Response('',{status:500}),()=>new Response('',{status:400}),()=>new Response('bad json'),()=>response(-1),()=>response(Infinity)])await assert.rejects(createRoadDistanceService({apiKey:()=> 'fixture',transport:transport(async()=>reply())}).metres(origin,destination));
 await assert.rejects(createRoadDistanceService({apiKey:()=> 'fixture',transport:transport(async()=>new Response('',{status:429}))}).metres(origin,destination),{code:'routing_limit'});
 await assert.rejects(createRoadDistanceService({apiKey:()=> 'fixture',transport:transport(async()=>new Response('',{status:404}))}).metres(origin,destination),{code:'no_route'});
 const timeout=createRoadDistanceService({apiKey:()=> 'fixture',timeoutMs:5,transport:transport(async(_url,init)=>new Promise((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(Error('aborted')))))});await assert.rejects(timeout.metres(origin,destination),{code:'routing_unavailable'});
 const refused=createRoadDistanceService({apiKey:()=> 'fixture',reserve:async()=>false,transport:transport(async()=>{calls++;return response();})});await assert.rejects(refused.metres(origin,destination),{code:'routing_limit'});assert.equal(calls,0);
});
test('persistent caches avoid provider calls and cache failures do not discard real route responses',async()=>{
 const service=createRoadDistanceService({apiKey:()=>undefined,cache:{read:async()=>32000,write:async()=>{}},transport:transport(async()=>{throw Error('must not call');})});assert.equal(await service.metres(origin,destination),32000);
 const fallback=createRoadDistanceService({apiKey:()=> 'fixture',cache:{read:async()=>{throw Error('db');},write:async()=>{throw Error('db');}},transport:transport(async()=>response())});assert.equal(await fallback.metres(origin,destination),16093.44);
});
test('global free-plan budgets survive process restarts and are shared across instances',async()=>{
 const db=new PGlite();try{await db.exec(await readFile('../../lib/db/drizzle/0073_delivery_road_distance.sql','utf8'));const database={query:(sql:string,values?:any[])=>db.query(sql,values)} as any;
 for(let i=0;i<40;i++)assert.equal(await reserveRoadRoutingBudget(database),true);assert.equal(await reserveRoadRoutingBudget(database),false);
 await db.query("DELETE FROM road_routing_usage WHERE bucket LIKE 'minute:%'");await db.query("UPDATE road_routing_usage SET count=2000 WHERE bucket LIKE 'day:%'");assert.equal(await reserveRoadRoutingBudget(database),false);
 }finally{await db.close();}
});
test('public estimates use the resolved dealer prices and coordinates; disabled delivery and stale locations cannot produce a quote',async()=>{
 const db=new PGlite(),server=createServer();let routingCalls=0;try{
 await db.exec('CREATE TABLE dealer_settings(dealer_id text PRIMARY KEY,config jsonb NOT NULL)');await db.exec(await readFile('../../lib/db/drizzle/0072_postcode_locations.sql','utf8'));
 const config={address:{postcode:'HA2 7LU'},delivery:{enabled:true},deliveryPricing:pricing};await db.query('INSERT INTO dealer_settings VALUES($1,$2),($3,$4)',['a',JSON.stringify(config),'b',JSON.stringify({...config,deliveryPricing:{...pricing,basePrice:'100.00'}})]);
 const database={query:(sql:string,values?:any[])=>db.query<Record<string,any>>(sql,values)};for(const id of ['a','b'])await persistDealerLocation(database,id,config,{postcode:'HA2 7LU',...origin,region:'London',administrativeArea:'Harrow'});
 const postcodes=createPostcodeService({transport:transport(async()=>new Response(JSON.stringify({status:200,result:{postcode:'SW1A 1AA',...destination,region:'London',admin_district:'Westminster'}})))});
 const roads={metres:async()=>{routingCalls++;return 16093.44;}};
 const app=express();app.use((req,_res,next)=>runWithTenant({dealerId:req.get('x-fixture-dealer')==='b'?'b':'a',canonicalOrigin:'https://example.test',platform:'cazoo',retailerId:'fixture',sourceUrl:'https://example.test'},next));app.use('/api',postcodeRouter(postcodes,database as any,roads));server.on('request',app);server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const get=async(dealer='a')=>{const res=await fetch(base+'/api/postcodes/delivery-estimate?postcode=SW1A1AA&dealerId=b&basePrice=0',{headers:{'x-fixture-dealer':dealer}});return {status:res.status,body:await res.json() as Record<string,any>};};
 const a=await get();assert.equal(a.status,200);assert.equal(a.body.totalPence,6500);assert.equal(a.body.roadMiles,10);assert.equal(a.body.distanceBasis,'driving');assert.equal((await get('b')).body.totalPence,11500);
 await db.query('UPDATE dealer_settings SET config=$1 WHERE dealer_id=$2',[JSON.stringify({...config,delivery:{enabled:false}}),'a']);assert.equal((await get()).status,404);assert.equal(routingCalls,2);
 await db.query('UPDATE dealer_settings SET config=$1 WHERE dealer_id=$2',[JSON.stringify({...config,address:{postcode:'N1 1AA'}}),'a']);assert.equal((await get()).status,503);assert.equal(routingCalls,2);assert.equal((await db.query('SELECT * FROM dealer_settings')).rows.length,2);
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await db.close();}
});

test('settings retain backward compatibility and reject invalid delivery pricing at the API boundary',()=>{
 for(const schema of [GetDealerSettingsResponse.shape.deliveryPricing,UpdateDealerSettingsBody.shape.deliveryPricing]){
  assert.equal(schema.safeParse(undefined).success,true);assert.equal(schema.safeParse(pricing).success,true);
  for(const value of ['-1','1.005','NaN','100000',''])assert.equal(schema.safeParse({...pricing,pricePerMile:value}).success,false);
 }
});
