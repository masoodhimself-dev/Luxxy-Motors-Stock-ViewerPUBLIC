import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { pool } from '@workspace/db';
import { currentDealerId } from '../lib/tenant-context';
import { requireStaff, requirePermission, staffLabel } from '../middlewares/staff-auth';
import { PostgresSaleWorkspaceStore, type SaleWorkspaceReadClient } from '../lib/sale-workspace-store';
import { SaleWorkspaceError, currentInvoiceBranding, defaultInvoiceSettings, saleWorkspaceBranding, type SaleWorkspaceCommand, type SaleWorkspaceDraft } from '@workspace/vehicle-meta';

// Deliberately separate routes. No path here can send email, create a public
// capability, look up a real customer, or accept an arbitrary dealer ID.
const router = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const customer = Object.freeze({ name: '[TEST] Example Buyer', phone: '07700900123', email: '', address: '1 Example Road, Test Town, TE1 1ST' });
type Session = { id: string; parent_dealer_id: string; staff_user_id: string; sandbox_dealer_id: string; vehicle_id: string; expires_at: Date; cleaned_at: Date | null };
const vehicleFor = (id: string) => ({ id, title: '[TEST] Example Car', registration: 'TEST 01', price: 1000 });
const present = (s: Session) => ({ sessionId: s.id, expiresAt: s.expires_at, vehicle: vehicleFor(s.vehicle_id), customer });
const fail = (req: Request, res: Response, error: unknown) => {
  if (error instanceof SaleWorkspaceError) { res.status(error.status).json({ error: error.message }); return; }
  req.log.error({ err: error }, 'Sales test session failed');
  res.status(500).json({ error: 'The test session could not be completed.' });
};
router.use('/sales-test', requireStaff, requirePermission('sales.manage'), (req, res, next) => {
  res.set('Cache-Control', 'no-store, private');
  if (req.body && Buffer.byteLength(JSON.stringify(req.body)) > 256_000) { res.status(413).json({ error: 'Test request is too large.' }); return; }
  next();
});
router.post('/sales-test/sessions', async (req, res) => {
  // Underscores are not permitted in platform dealership IDs. Still check the
  // database to fail closed if a manually inserted dealer ever collides.
  const id = randomUUID(), vehicleId = randomUUID(), sandbox = `__sales_test__${randomUUID()}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`sales-test-owner:${currentDealerId()}:${req.staff!.authUserId}`]);
    if ((await client.query('SELECT 1 FROM dealerships WHERE id=$1',[sandbox])).rows.length) throw new SaleWorkspaceError('Unable to safely create a test session.',409);
    const existing = await client.query('SELECT * FROM sales_test_sessions WHERE parent_dealer_id=$1 AND staff_user_id=$2 AND cleaned_at IS NULL ORDER BY created_at DESC LIMIT 1', [currentDealerId(), req.staff!.authUserId]);
    if (existing.rows.length) { await client.query('ROLLBACK'); res.status(409).json({ error: 'Finish and clear your existing test session first.', sessionId: existing.rows[0].id }); return; }
    const row = (await client.query(`INSERT INTO sales_test_sessions(id,parent_dealer_id,staff_user_id,sandbox_dealer_id,vehicle_id,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '12 hours') RETURNING *`, [id, currentDealerId(), req.staff!.authUserId, sandbox, vehicleId])).rows[0] as Session;
    await client.query(`INSERT INTO vehicles(id,dealer_id,source,advert_id,title,registration,source_price,inventory_status,source_status) VALUES($1,$2,'isolated-test',$3,'[TEST] Example Car','TEST 01',1000,'available','live')`, [vehicleId, sandbox, id]);
    await client.query('COMMIT'); res.status(201).json(present(row));
  } catch (e) { await client.query('ROLLBACK'); fail(req, res, e); }
  finally { client.release(); }
});
router.get('/sales-test/sessions', async (req,res) => {
  try {
    const result=await pool.query('SELECT * FROM sales_test_sessions WHERE parent_dealer_id=$1 AND staff_user_id=$2 AND cleaned_at IS NULL ORDER BY created_at DESC LIMIT 1',[currentDealerId(),req.staff!.authUserId]);
    res.json({ session: result.rows[0] ? present(result.rows[0]) : null });
  } catch(e){fail(req,res,e);}
});
async function session(req: Request): Promise<Session> {
  if (!UUID.test(String(req.params.sessionId))) throw new SaleWorkspaceError('Test session not found.', 404);
  const result=await pool.query('SELECT s.*, EXISTS(SELECT 1 FROM dealerships d WHERE d.id=s.sandbox_dealer_id) AS namespace_collision FROM sales_test_sessions s WHERE s.id=$1 AND s.parent_dealer_id=$2 AND s.staff_user_id=$3', [req.params.sessionId,currentDealerId(),req.staff!.authUserId]);
  const row=result.rows[0] as Session|undefined;
  if(!row) throw new SaleWorkspaceError('Test session not found.',404);
  if(result.rows[0].namespace_collision) throw new SaleWorkspaceError('Test isolation could not be verified.',409);
  return row;
}
function active(s:Session) {
  if(s.cleaned_at) throw new SaleWorkspaceError('This test session has been cleared.',410);
  if(new Date(s.expires_at).getTime() <= Date.now()) throw new SaleWorkspaceError('This test session has expired. Clear it and start another.',410);
}
router.get('/sales-test/sessions/:sessionId', async(req,res)=>{try{const s=await session(req);active(s);res.json(present(s));}catch(e){fail(req,res,e);}});
router.get('/sales-test/sessions/:sessionId/stock', async(req,res)=>{
  try{
    const s=await session(req);active(s);
    const row=(await pool.query('SELECT inventory_status FROM vehicles WHERE id=$1 AND dealer_id=$2 AND source=$3 AND advert_id=$4',[s.vehicle_id,s.sandbox_dealer_id,'isolated-test',s.id])).rows[0];
    if(!row) throw new SaleWorkspaceError('Test vehicle not found.',404);
    res.json({cars:[{...vehicleFor(s.vehicle_id),inventoryStatus:row.inventory_status}]});
  }catch(e){fail(req,res,e);}
});
router.delete('/sales-test/sessions/:sessionId', async(req,res)=>{
  try {
    const s=await session(req), client=await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`sale-workspace:${s.sandbox_dealer_id}`]);
      const locked=(await client.query('SELECT * FROM sales_test_sessions WHERE id=$1 AND parent_dealer_id=$2 AND staff_user_id=$3 FOR UPDATE',[s.id,s.parent_dealer_id,s.staff_user_id])).rows[0] as Session|undefined;
      if(!locked) throw new SaleWorkspaceError('Test session not found.',404);
      if(!locked.cleaned_at){
        if ((await client.query('SELECT 1 FROM dealerships WHERE id=$1',[locked.sandbox_dealer_id])).rows.length) throw new SaleWorkspaceError('Test isolation could not be verified. No data was removed.',409);
        // Hold the vehicle row until deletion commits. Foreign-key inserts take
        // KEY SHARE locks, so none can appear between the check and deletion.
        const cars=(await client.query('SELECT id,source,advert_id FROM vehicles WHERE dealer_id=$1 FOR UPDATE',[locked.sandbox_dealer_id])).rows;
        const foreign=(await client.query(`SELECT 1 WHERE
          EXISTS(SELECT 1 FROM sold_vehicle_follow_ups WHERE dealer_id=$1) OR
          EXISTS(SELECT 1 FROM enquiries WHERE dealer_id=$1) OR
          EXISTS(SELECT 1 FROM leads WHERE dealer_id=$1) OR
          EXISTS(SELECT 1 FROM email_outbox WHERE dealer_id=$1) OR
          EXISTS(SELECT 1 FROM enquiry_emails WHERE dealer_id=$1) OR
          EXISTS(SELECT 1 FROM sale_workspace WHERE dealer_id<>$1 AND state#>>'{draft,vehicleId}'=$2)`,[locked.sandbox_dealer_id,locked.vehicle_id])).rows;
        const sales=(await client.query('SELECT state FROM sale_workspace WHERE dealer_id=$1',[locked.sandbox_dealer_id])).rows;
        if(cars.length!==1 || cars[0].id!==locked.vehicle_id || cars[0].source!=='isolated-test' || cars[0].advert_id!==locked.id || foreign.length || sales.some((row:any)=>row.state?.draft?.vehicleId!==locked.vehicle_id || row.state?.draft?.customer!==customer.name || row.state?.draft?.sourceEnquiryId || row.state?.draft?.sourceReservationId)) throw new SaleWorkspaceError('Test isolation could not be verified. No data was removed.',409);
        // Check every FK to vehicles.id, including old and future tables.
        // Identifiers come only from PostgreSQL's catalog and are quoted.
        const refs=(await client.query(`SELECT DISTINCT n.nspname AS schema_name, c.relname AS table_name, a.attname AS column_name
          FROM pg_catalog.pg_constraint f
          JOIN pg_catalog.pg_class c ON c.oid=f.conrelid
          JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
          JOIN LATERAL unnest(f.conkey, f.confkey) AS keys(child_num,parent_num) ON true
          JOIN pg_catalog.pg_attribute a ON a.attrelid=f.conrelid AND a.attnum=keys.child_num
          JOIN pg_catalog.pg_attribute p ON p.attrelid=f.confrelid AND p.attnum=keys.parent_num
          WHERE f.contype='f' AND f.confrelid='public.vehicles'::regclass AND p.attname='id'`)).rows;
        const quote=(name:string)=>`"${name.replaceAll('"','""')}"`;
        for(const ref of refs) {
          const exists=await client.query(`SELECT 1 FROM ${quote(ref.schema_name)}.${quote(ref.table_name)} WHERE ${quote(ref.column_name)}=$1::uuid LIMIT 1`,[locked.vehicle_id]);
          if(exists.rows.length) throw new SaleWorkspaceError('Test isolation could not be verified. No data was removed.',409);
        }
        // Delete precisely this server-generated namespace, never parent records.
        // Unexpected foreign keys make the transaction fail closed.
        await client.query('DELETE FROM sale_workspace WHERE dealer_id=$1',[locked.sandbox_dealer_id]);
        await client.query('DELETE FROM sale_workspace_counters WHERE dealer_id=$1',[locked.sandbox_dealer_id]);
        await client.query('DELETE FROM vehicles WHERE dealer_id=$1 AND id=$2',[locked.sandbox_dealer_id,locked.vehicle_id]);
        await client.query('DELETE FROM sales_test_sessions WHERE id=$1',[locked.id]);
      }
      await client.query('COMMIT');res.json({cleared:true});
    } catch(e){await client.query('ROLLBACK');throw e;} finally{client.release();}
  } catch(e){fail(req,res,e);}
});
function sandboxStore(s:Session) {
  const branding=currentInvoiceBranding(saleWorkspaceBranding({identity:{name:'TEST ONLY — NOT A REAL INVOICE',logoText:'TEST ONLY'},invoiceSettings:{...defaultInvoiceSettings,referencePrefix:'TEST',footer:'TEST ONLY — NOT A REAL INVOICE'}}),{...defaultInvoiceSettings,referencePrefix:'TEST',footer:'TEST ONLY — NOT A REAL INVOICE'});
  return new PostgresSaleWorkspaceStore(s.sandbox_dealer_id, async() => ({branding,vehicle:{id:s.vehicle_id,title:'[TEST] Example Car',registration:'TEST 01'},paperwork:{saleTerms:'TEST ONLY — NOT A CONTRACT',reservationTerms:'TEST ONLY — NO REAL PAYMENT'}}), pool, {
    omitInvoiceVerification:true, omitLogoEmbedding:true,
    afterLock:async(client:SaleWorkspaceReadClient)=>{
      const row=(await client.query('SELECT * FROM sales_test_sessions WHERE id=$1 AND parent_dealer_id=$2 AND staff_user_id=$3 AND sandbox_dealer_id=$4 FOR UPDATE',[s.id,s.parent_dealer_id,s.staff_user_id,s.sandbox_dealer_id])).rows[0] as Session|undefined;
      if(!row) throw new SaleWorkspaceError('Test session not found.',404);
      active(row);
      if ((await client.query('SELECT 1 FROM dealerships WHERE id=$1',[s.sandbox_dealer_id])).rows.length) throw new SaleWorkspaceError('Test isolation could not be verified.',409);
    },
  });
}
function validateDraft(value:unknown,s:Session) {
  if(!value || typeof value!=='object' || Array.isArray(value)) throw new SaleWorkspaceError('Use the fictional customer and car supplied for this test.');
  const d=value as Record<string,any>;
  if(d.vehicleId!==s.vehicle_id || d.vehicle!=='[TEST] Example Car' || d.registration!=='TEST 01' || d.customer!==customer.name || d.email!==customer.email || d.phone!==customer.phone || d.address!==customer.address || d.sourceEnquiryId || d.sourceReservationId || d.appointment || d.partExchange || d.vin || d.roadTaxGuide || (Array.isArray(d.exchanges) && d.exchanges.length)) throw new SaleWorkspaceError('Use only the fictional customer and vehicle supplied for this test.',400);
  return d as SaleWorkspaceDraft;
}
const route='/sales-test/sessions/:sessionId/sale-workspace';
router.get(route,async(req,res)=>{try{const s=await session(req);active(s);res.json({...await sandboxStore(s).list(),preview:false});}catch(e){fail(req,res,e);}});
router.post(route,async(req,res)=>{try{const s=await session(req);active(s);const result=await sandboxStore(s).mutate({requestId:req.body?.requestId,draft:validateDraft(req.body?.draft,s),actor:staffLabel(req)});res.status(result.replayed?200:201).json({...result,preview:false});}catch(e){fail(req,res,e);}});
router.get(route+'/:id',async(req,res)=>{try{const s=await session(req);active(s);if(!UUID.test(String(req.params.id)))throw new SaleWorkspaceError('Sale not found.',404);res.json({sale:await sandboxStore(s).get(String(req.params.id)),preview:false});}catch(e){fail(req,res,e);}});
router.put(route+'/:id',async(req,res)=>{try{const s=await session(req);active(s);if(!UUID.test(String(req.params.id)))throw new SaleWorkspaceError('Sale not found.',404);res.json({...await sandboxStore(s).mutate({id:String(req.params.id),requestId:req.body?.requestId,expectedRevision:req.body?.expectedRevision,command:{action:'update',draft:validateDraft(req.body?.draft,s)},actor:staffLabel(req)}),preview:false});}catch(e){fail(req,res,e);}});
const actions: Record<string,{permission:'payments.record'|'sales.manage'|'sales.handover'; command:(body:any)=>SaleWorkspaceCommand}> = {
  'invoice-payments':{permission:'payments.record',command:b=>({action:'invoice-payment',payment:b.payment})},
  'issue-invoice':{permission:'payments.record',command:b=>({action:'issue-invoice',kind:b.kind,acknowledge:b.acknowledge})},
  'finish-invoice-sale':{permission:'payments.record',command:b=>({action:'finish-invoice-sale',acknowledge:b.acknowledge,acknowledgeOutstanding:b.acknowledgeOutstanding===true})},
  'fulfilment':{permission:'sales.manage',command:b=>({action:'fulfilment',fulfilment:b.fulfilment})},
  'handover':{permission:'sales.handover',command:b=>({action:'handover',recipient:b.recipient,completedAt:b.completedAt,acknowledgeOutstanding:b.acknowledgeOutstanding})},
};
router.post(route+'/:id/:action',async(req,res,next)=>{const key=String(req.params.action);const action=Object.hasOwn(actions,key)?actions[key]:undefined;if(!action){res.status(404).json({error:'This action is unavailable in test mode.'});return;}requirePermission(action.permission)(req,res,next);},async(req,res)=>{
  try{const s=await session(req);active(s);if(!UUID.test(String(req.params.id)))throw new SaleWorkspaceError('Sale not found.',404);
    const action=actions[String(req.params.action)]!;
    if(req.params.action==='handover' && req.body?.recipient!==customer.name)throw new SaleWorkspaceError('Use the fictional customer for handover.');
    if(req.params.action==='fulfilment' && (req.body?.fulfilment?.method!=='collection' || (req.body?.fulfilment?.recipient && req.body.fulfilment.recipient!==customer.name) || (req.body?.fulfilment?.phone && req.body.fulfilment.phone!==customer.phone)))throw new SaleWorkspaceError('Use collection and the fictional customer for this test.');
    const result=await sandboxStore(s).mutate({id:String(req.params.id),requestId:req.body?.requestId,expectedRevision:req.body?.expectedRevision,command:action.command(req.body),actor:staffLabel(req)});res.json({...result,preview:false});
  }catch(e){fail(req,res,e);}
});
router.get(route+'/:id/documents/:documentId/pdf',async(req,res)=>{try{const s=await session(req);active(s);if(!UUID.test(String(req.params.id))||!UUID.test(String(req.params.documentId)))throw new SaleWorkspaceError('Document not found.',404);const {document,archive}=await sandboxStore(s).pdf(String(req.params.id),String(req.params.documentId));res.set({'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="TEST-${document.number.replace(/[^A-Za-z0-9_-]/g,'')}.pdf"`,'X-Robots-Tag':'noindex, nofollow'}).end(Buffer.from(archive.content,'base64'));}catch(e){fail(req,res,e);}});
export default router;
