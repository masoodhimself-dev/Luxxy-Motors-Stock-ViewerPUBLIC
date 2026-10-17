// Isolated functional workload, not a Render load certificate. The build aliases
// every database import to PGlite; HTTP stays on loopback and no provider is used.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readdir,readFile,mkdir,writeFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createServer,request as httpRequest } from 'node:http';
import { performance } from 'node:perf_hooks';
import express from 'express';
import { sql } from 'drizzle-orm';
import { db,engine,dealershipsTable,dealerDomainsTable,dealerImportKeysTable } from './test/tenant-test-db';
import { importAdmission } from './lib/stock-import-admission';
import fixture from './test/fixtures/cazoo-stock.json';

process.env.NODE_ENV='test'; process.env.LOG_LEVEL='fatal';
process.env.MULTI_TENANT_ENABLED='true'; process.env.STOCK_IMPORT_API_HOST='imports.example.test';
process.env.INTEGRATIONS_ENCRYPTION_KEY=Buffer.alloc(32,31).toString('base64');
const sha=(value:string)=>createHash('sha256').update(value).digest('hex');
const ids=Array.from({length:200},(_,i)=>`capacity-${String(i+1).padStart(3,'0')}`);
const reports:unknown[]=[];
const sourceText='Fictional showroom fixture: service information and vehicle equipment. '.repeat(255);
function inventory(id:string,phase:string,scrapedAt:string) {
  const cars=Array.from({length:30},(_,i)=>({ ...fixture.cars[0],
    advertId:`${id}-car-${i}`,title:`${id} Fictional Vehicle ${i}`,make:'Fixture',model:'Capacity',
    price:10000+i,plate:null,vrm:null,vrmVerified:false,
    advertUrl:`https://www.autotrader.co.uk/car-details/${id}-${i}`,
    heroImage:`https://images.example.test/${id}/${i}/0.jpg`,
    images:Array.from({length:24},(_,n)=>({url:`https://images.example.test/${id}/${i}/${n}.jpg`,caption:n===0?'front':`Fictional view ${n}`})),
    sourceExtras:{sourcePlatform:'autotrader',description:sourceText,fixture:'No real dealer or customer data'},
  }));
  return JSON.stringify({...fixture,runId:`${phase}-${id}`,retailerId:id,dealerName:id,scrapedAt,cars,count:30,expectedAdvertCount:30});
}

test('100 and 200 fictional dealerships import, replay, read and refresh without crossing tenant boundaries', {timeout:900_000}, async()=>{
  // A fresh embedded database is created by tenant-test-db, never DATABASE_URL.
  for(const name of (await readdir('../../lib/db/drizzle')).filter(n=>/^\d+.*\.sql$/.test(n)).sort())
    await engine.exec(await readFile(join('../../lib/db/drizzle',name),'utf8'));
  const {importSecretDigest,resolveTenant}=await import('./middlewares/tenant');
  await db.insert(dealershipsTable).values(ids.map(id=>({id,name:id,status:'active' as const,canonicalOrigin:`https://${id}.example.test`,stockPlatform:'autotrader' as const,retailerId:id,sourceUrl:`https://www.autotrader.co.uk/cars/retailer/stock?retailerId=${id}`})));
  await db.insert(dealerDomainsTable).values(ids.map(id=>({dealerId:id,hostname:`${id}.example.test`,verified:true,verificationToken:'fictional'})));
  await db.insert(dealerImportKeysTable).values(ids.map(id=>({dealerId:id,secretHash:importSecretDigest(`fictional-${id}`)})));
  const {default:stockRouter}=await import('./routes/stock');
  const app=express();
  let parsedBodies=0;
  app.use(importAdmission.middleware);
  app.use(express.json({limit:'25mb',verify:()=>{parsedBodies++;}}));
  app.use((req,_res,next)=>{(req as any).log={warn(){},error(){}};next();});
  app.use(resolveTenant);app.use('/api',stockRouter);
  app.use((error:unknown,_req:unknown,res:express.Response,_next:unknown)=>{res.status(500).json({error:error instanceof Error?error.message:'Fixture failed'});});
  const server=createServer(app);
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
  const address=server.address();assert.ok(address && typeof address!=='string');
  const origin=`http://127.0.0.1:${address.port}`;
  const request=(id:string,body?:string,path=body?`/api/stock/imports/${id}/grok`:'/api/stock',key=`fictional-${id}`):Promise<{status:number;json:any;bytes:number}>=>new Promise((done,fail)=>{
    const call=httpRequest(origin+path,{method:body?'POST':'GET',headers:{host:body?'imports.example.test':`${id}.example.test`,'Content-Type':'application/json',...(body?{'x-stock-import-secret':key,'Content-Length':String(Buffer.byteLength(body))}:{})}},response=>{
      let text='';response.setEncoding('utf8');response.on('data',part=>{text+=part;});response.on('end',()=>{try{done({status:response.statusCode!,json:JSON.parse(text),bytes:Buffer.byteLength(text)});}catch(error){fail(error);}});
    });call.on('error',fail);call.setTimeout(60_000,()=>call.destroy(new Error('Isolated request deadline')));call.end(body);
  });
  async function stage(dealers:string[],makeBody:(id:string)=>string,check:(id:string,result:any)=>void){
    let next=0,totalBytes=0,peakActive=0;const latencies:number[]=[],waits:number[]=[];const started=performance.now(),cpu=process.cpuUsage();let peakRss=process.memoryUsage().rss;
    const sampler=setInterval(()=>{peakRss=Math.max(peakRss,process.memoryUsage().rss);peakActive=Math.max(peakActive,importAdmission.status().active);},10);
    try{
      await Promise.all(Array.from({length:2},async()=>{while(next<dealers.length){const id=dealers[next++];waits.push(performance.now()-started);const body=makeBody(id),at=performance.now();totalBytes+=Buffer.byteLength(body);const result=await request(id,body);latencies.push(performance.now()-at);check(id,result);}}));
    }finally{clearInterval(sampler);}
    latencies.sort((a,b)=>a-b); waits.sort((a,b)=>a-b);const usedCpu=process.cpuUsage(cpu);
    assert.equal(importAdmission.status().active,0);assert.ok(peakActive<=2);
    return {dealers:dealers.length,clientConcurrency:2,wallMs:Math.round(performance.now()-started),p50Ms:Math.round(latencies[Math.floor(latencies.length*.5)]!),p95Ms:Math.round(latencies[Math.min(latencies.length-1,Math.floor(latencies.length*.95))]!),queueWaitP95Ms:Math.round(waits[Math.min(waits.length-1,Math.floor(waits.length*.95))]!),cpuMs:Math.round((usedCpu.user+usedCpu.system)/1000),requestBytes:totalBytes,peakRssBytes:peakRss,sampledActiveImports:peakActive,processImportHighWater:importAdmission.status().peakActive};
  }
  try{
    for(const count of [100,200]){
      // Start each measured size cold. This is the embedded fixture database only.
      await db.execute(sql`TRUNCATE vehicle_changes, vehicle_images, vehicles, stock_import_runs CASCADE`);
      const subset=ids.slice(0,count),phase=`initial-${count}`,date=new Date(Date.now()+count).toISOString();
      const hashes=new Map<string,string>();
      const initial=await stage(subset,id=>{const body=inventory(id,phase,date);hashes.set(id,sha(body));return body;},(id,result)=>{
        assert.equal(result.status,201,JSON.stringify(result.json).slice(0,500));assert.equal(result.json.received,30);
        assert.equal(result.json.created,30);assert.equal(result.json.unchanged,0);
      });
      const replay=await stage(subset,id=>{const body=inventory(id,phase,date);assert.equal(sha(body),hashes.get(id));return body;},(_id,result)=>{assert.equal(result.status,200);assert.equal(result.json.status,'replayed');});
      const later=new Date(new Date(date).getTime()+1000).toISOString();
      const quiet=await stage(subset,id=>inventory(id,`quiet-${count}`,later),(_id,result)=>{assert.equal(result.status,201);assert.equal(result.json.created,0);assert.equal(result.json.updated,0);assert.equal(result.json.unchanged,30);});
      for(const id of subset){
        const result=await request(id);assert.equal(result.status,200);assert.equal(result.json.count,30);
        assert.ok(result.json.cars.every((car:any)=>car.advertId.startsWith(`${id}-car-`) && car.plate===null && car.images.every((image:any)=>image.url.includes(`/${id}/`))));
      }
      const rows=await db.execute(sql`SELECT count(*)::int AS count FROM vehicles`);assert.equal(Number(rows.rows[0]!.count),count*30);
      const report={fixture:'PGlite/loopback only; no external provider traffic or production sizing claim',dealers:count,carsPerDealer:30,imagesPerCar:24,payloadBytes:Buffer.byteLength(inventory(subset[0]!,phase,date)),initial,replay,quiet};reports.push(report);console.log('CAPACITY_RESULT '+JSON.stringify(report));
    }
    const wrongKey=await request(ids[0]!,inventory(ids[0]!,'wrong-key',new Date().toISOString()),undefined,`fictional-${ids[1]}`);assert.equal(wrongKey.status,403);
    const own=await request(ids[0]!);const ownVehicle=own.json.cars[0].id;
    assert.equal((await request(ids[1]!,undefined,`/api/vehicles/${ownVehicle}`)).status,404);
    assert.equal(parsedBodies,901);
    const directory=resolve('../../output/capacity-2026-10-17');await mkdir(directory,{recursive:true});await writeFile(join(directory,'backend-capacity-results.json'),JSON.stringify({measuredAt:new Date().toISOString(),runtime:process.version,scope:'Isolated correctness and workload measurements only',reports},null,2));
  }finally{
    await new Promise<void>((done,fail)=>server.close(error=>error?fail(error):done()));await engine.close();
  }
});
