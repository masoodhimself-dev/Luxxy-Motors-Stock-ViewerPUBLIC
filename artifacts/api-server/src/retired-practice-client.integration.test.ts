import './test/setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';

test('old practice tabs receive 410 before any live API, authentication or provider action',async()=>{
  const {default:app}=await import('./app');
  const {pool}=await import('@workspace/db');
  const server=createServer(app);
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${(server.address() as any).port}/api`;
  try {
    for (const marker of ['00000000-0000-4000-8000-000000000001','old-session','']) {
      for (const method of ['GET','POST','PUT','DELETE']) {
        for (const path of ['/platform/dealerships','/account-invitations','/webhooks/customer-email','/sale-workspace','/enquiries','/test-email-settings','/sales-test/sessions']) {
          const response=await fetch(base+path,{method,headers:{'x-luxxy-test-session':marker}});
          assert.equal(response.status,410,`${method} ${path} with marker ${JSON.stringify(marker)}`);
          assert.match((await response.json() as any).error,/Practice mode has been removed/);
        }
      }
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve=>server.close(()=>resolve()));
    await pool.end();
  }
});
