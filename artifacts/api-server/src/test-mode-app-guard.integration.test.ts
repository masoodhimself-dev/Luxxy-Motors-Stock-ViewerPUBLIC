import './test/setup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';

test('test markers are enforced before the actual app direct API mounts',async()=>{
  const {default:app}=await import('./app');
  const {pool}=await import('@workspace/db');
  const server=createServer(app);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${(server.address() as any).port}/api`, id='00000000-0000-4000-8000-000000000001';
  try {
    for (const path of ['/platform/dealerships','/account-invitations','/demo-onboarding','/webhooks/customer-email','/sale-workspace','/enquiries']) {
      const response=await fetch(base+path,{method:'POST',headers:{'x-luxxy-test-session':id}});
      assert.equal(response.status,403,`Expected ${path} to be blocked before routing`);
      const data:any=await response.json();assert.match(data.error,/unavailable in test mode/);
    }
  } finally {server.close();await pool.end();}
});
