import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createServer } from 'node:http';
import { testModeRequestGuard } from './middlewares/test-mode-request-guard';

test('marked requests cannot mutate live paths and only the matching sandbox is allowed',async()=>{
  const app=express();app.use('/api',testModeRequestGuard);app.use((_req,res)=>res.json({ok:true}));
  const server=createServer(app);await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${(server.address() as any).port}/api`, id='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002';
  const request=(path:string,method:string,marker?:string)=>fetch(base+path,{method,...(marker?{headers:{'x-luxxy-test-session':marker}}:{})});
  try {
    assert.equal((await request('/sale-workspace','POST',id)).status,403);
    assert.equal((await request('/enquiries','POST',id)).status,403);
    assert.equal((await request('/dealer-settings','PATCH',id)).status,403);
    assert.equal((await request('/staff/team/123','DELETE',id)).status,403);
    assert.equal((await request(`/sales-test/sessions/${other}/email-send`,'POST',id)).status,403);
    assert.equal((await request(`/sales-test/sessions/${id}/email-preview`,'POST',id)).status,200);
    assert.equal((await request(`/sales-test/sessions/${id}/email-send`,'POST',id)).status,200);
    assert.equal((await request('/test-email-settings','PUT',id)).status,200);
    assert.equal((await request('/test-email-settings','POST',id)).status,403);
    assert.equal((await request('/sale-workspace','POST','invalid')).status,403);
    assert.equal((await request('/sale-workspace','POST')).status,200);
  } finally {server.close();}
});
