import './test/setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';

// Exercise the real application middleware order, before auth or any DB writes.
const {default:app}=await import('./app');
const server=createServer(app);
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${(server.address() as any).port}`;
test('actual application applies narrow JSON limits before the common parser',async()=>{
  const post=(path:string,n:number)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({padding:'x'.repeat(n)})});
  let response=await post('/api/sales-test/sessions',256_001);assert.equal(response.status,413);assert.match((await response.json() as any).error,/256 KB/);
  response=await post(`/api/sales-test/sessions/${randomUUID()}/email-preview`,4_100_001);assert.equal(response.status,413);assert.match((await response.json() as any).error,/4\.1 MB/);
  response=await post(`/api/sales-test/sessions/${randomUUID()}/email-preview`,256_001);assert.notEqual(response.status,413);
});
test.after(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));const {pool}=await import('@workspace/db');await pool.end();});
