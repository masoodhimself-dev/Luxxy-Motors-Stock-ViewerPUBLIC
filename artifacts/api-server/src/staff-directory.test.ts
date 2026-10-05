import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import pino from 'pino';
// The driver below is an isolated fixture: no database connection is permitted.
process.env.DATABASE_URL='postgres://unused:unused@127.0.0.1:1/unused';
process.env.STOCK_DEALER_ID='luxxy-motors';
const {pool}=await import('@workspace/db');
const {default:router}=await import('./routes/enquiries');
test('disabled staff disappear from the assignment directory and cannot receive new enquiry assignments',async()=>{
  const now='2026-10-04T00:00:00Z';
  const staff=[['00000000-0000-4000-8000-000000000001','luxxy-motors','staff-active','active@example.test','Active staff','owner',null,now,now],['00000000-0000-4000-8000-000000000002','luxxy-motors','staff-disabled','disabled@example.test','Former staff','salesperson',now,now,now]];
  const originalQuery=pool.query,originalConnect=pool.connect;
  let connections=0;
  (pool as any).query=async(config:{text:string},parameters:unknown[])=>{
    assert.match(config.text,/from "portal_users"/i);
    const authId=parameters.find(value=>value==='staff-active'||value==='staff-disabled');
    return {rows:staff.filter(row=>(!authId||row[2]===authId)&&(!/"disabled_at"\s+is\s+null/i.test(config.text)||row[6]===null))};
  };
  (pool as any).connect=async()=>{connections++;throw new Error('The disabled assignment must be rejected before starting a database transaction.');};
  const app=express();app.use(express.json());app.use((req,_res,next)=>{req.staff={authUserId:'staff-active',name:'Active staff',email:'active@example.test',role:'owner'};req.log=pino({level:'silent'});next();});app.use('/api',router);
  const server=app.listen(0,'127.0.0.1');await new Promise<void>((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  const address=server.address();assert.ok(address&&typeof address!=='string');const base=`http://127.0.0.1:${address.port}`;
  try{
    const directory=await fetch(`${base}/api/staff/directory`);assert.equal(directory.status,200);
    assert.deepEqual((await directory.json() as {members:Array<{id:string;name:string}>}).members,[{id:'staff-active',name:'Active staff'}]);
    const assignment=await fetch(`${base}/api/staff/enquiries/00000000-0000-4000-8000-000000000010/workspace`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:0,assignedToId:'staff-disabled'})});
    assert.equal(assignment.status,409);assert.match((await assignment.json() as {error:string}).error,/Choose a staff member/);assert.equal(connections,0);
    assert.equal(staff[1][4],'Former staff');
  }finally{
    server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
    pool.query=originalQuery;pool.connect=originalConnect;await pool.end();
  }
});
