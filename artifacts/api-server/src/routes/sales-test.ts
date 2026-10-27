import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { pool } from '@workspace/db';
import { currentDealerId } from '../lib/tenant-context';
import { requireStaff, requirePermission, staffHasPermission, staffLabel } from '../middlewares/staff-auth';
import { readTestModeReport } from '../lib/test-mode-report';
import { defaultSettings } from './dealer-settings';
import { UpdateDealerSettingsBody } from '@workspace/api-zod';
import { bookingSettingsUpdate } from '../lib/booking-settings-update';
import { SettingsVersionError } from '../lib/settings-versions';
import { testModeTemplates } from '../lib/test-mode-templates';
import { defaultEmailTemplates, EmailTemplateError, validateEmailTemplate, emailTemplateVariables, compactInvoiceStyle, currentInvoiceSettings, invoiceTextLimits } from '@workspace/vehicle-meta';
import { dealerIntegrationsStore } from '../lib/dealer-integrations-store';
import { z } from 'zod/v4';
import { PostgresSaleWorkspaceStore, type SaleWorkspaceReadClient } from '../lib/sale-workspace-store';
import { SaleWorkspaceError, currentInvoiceBranding, defaultInvoiceSettings, saleWorkspaceBranding, type SaleWorkspaceCommand, type SaleWorkspaceDraft } from '@workspace/vehicle-meta';

// All test mutations are confined to a server-generated sandbox dealership.
const router = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type Session = { id: string; parent_dealer_id: string; staff_user_id: string; sandbox_dealer_id: string; vehicle_id: string; source_vehicle_id:string|null; vehicle_title:string; vehicle_registration:string; vehicle_price:number; customer_name:string; customer_phone:string; customer_email:string; customer_address:string; expires_at: Date; cleaned_at: Date | null };
const vehicleFor = (s: Session) => ({ id:s.vehicle_id, title:s.vehicle_title, registration:s.vehicle_registration, price:s.vehicle_price });
const customerFor = (s: Session) => ({name:s.customer_name,phone:s.customer_phone,email:s.customer_email,address:s.customer_address});
const present = (s: Session) => ({ sessionId: s.id, expiresAt: s.expires_at, vehicle: vehicleFor(s), sourceVehicleId:s.source_vehicle_id, customer:customerFor(s) });
const fail = (req: Request, res: Response, error: unknown) => {
  if (error instanceof SaleWorkspaceError) { res.status(error.status).json({ error: error.message }); return; }
  req.log.error({ err: error }, 'Sales test session failed');
  res.status(500).json({ error: 'The test session could not be completed.' });
};
router.use('/sales-test', requireStaff, requirePermission('sales.manage'), (req, res, next) => {
  res.set('Cache-Control', 'no-store, private');
  // Only the preview endpoint accepts up to two compressed image data URLs.
  // All other test mutations retain their smaller request limit.
  const photoPreview=req.method==='POST' && /^\/sessions\/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\/email-preview$/i.test(req.path);
  if (req.body && Buffer.byteLength(JSON.stringify(req.body)) > (photoPreview ? 4_100_000 : 256_000)) { res.status(413).json({ error: 'Test request is too large.' }); return; }
  next();
});
router.get('/sales-test/available-vehicles',async(req,res)=>{try{const r=await pool.query(`SELECT id,COALESCE(NULLIF(website_title_override,''),title,'Vehicle') title,COALESCE(registration,plate,vrm,'') registration,COALESCE(website_price_override,source_price,0) price FROM vehicles WHERE dealer_id=$1 AND inventory_status='available' AND source_status='live' ORDER BY title,id LIMIT 500`,[currentDealerId()]);res.json({cars:r.rows});}catch(e){fail(req,res,e);}});
router.get('/sales-test/available-customers',async(req,res)=>{try{const r=await pool.query(`SELECT id,name,phone,email,source FROM (SELECT id,name,COALESCE(phone,'') phone,COALESCE(email,'') email,'customer' AS source,created_at FROM customers WHERE dealer_id=$1 UNION ALL SELECT id,customer_name name,COALESCE(phone,'') phone,COALESCE(email,'') email,'enquiry' AS source,created_at FROM enquiries WHERE dealer_id=$1 AND merged_into_id IS NULL) choices ORDER BY created_at DESC LIMIT 500`,[currentDealerId()]);res.json({customers:r.rows});}catch(e){fail(req,res,e);}});
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
    const vehicleInput=String(req.body?.vehicleId||''),customerInput=String(req.body?.customerEnquiryId||''),customerSource=String(req.body?.customerSource||'enquiry');
    if(!UUID.test(vehicleInput)||!['enquiry','customer','test'].includes(customerSource)||(customerSource!=='test'&&!UUID.test(customerInput))) throw new SaleWorkspaceError('Choose a vehicle and customer for this test.',400);
    const car=(await client.query(`SELECT COALESCE(NULLIF(website_title_override,''),title,'Vehicle') title,COALESCE(registration,plate,vrm,'') registration,COALESCE(website_price_override,source_price,0) price FROM vehicles WHERE id=$1 AND dealer_id=$2 AND inventory_status='available' AND source_status='live'`,[vehicleInput,currentDealerId()])).rows[0];
    let person:any;
    if(customerSource==='test') {
      const contact=req.body?.testCustomer;
      if(!contact || typeof contact!=='object' || Array.isArray(contact) || Object.keys(contact).some(key=>!['name','phone','email'].includes(key)) || typeof contact.name!=='string' || !contact.name.trim() || contact.name.length>100 || typeof contact.phone!=='string' || contact.phone.length>40 || typeof contact.email!=='string' || contact.email.length>254 || contact.email && !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(contact.email)) throw new SaleWorkspaceError('Enter valid test customer details.',400);
      person={name:contact.name.trim(),phone:contact.phone.trim(),email:contact.email.trim(),address:null};
    } else person=(await client.query(customerSource==='customer'?`SELECT name,COALESCE(phone,'') phone,COALESCE(email,'') email,address FROM customers WHERE id=$1 AND dealer_id=$2`:`SELECT customer_name name,COALESCE(phone,'') phone,COALESCE(email,'') email,NULL::jsonb address FROM enquiries WHERE id=$1 AND dealer_id=$2 AND merged_into_id IS NULL`,[customerInput,currentDealerId()])).rows[0];
    if(!car||!person) throw new SaleWorkspaceError('Choose a vehicle and customer from this dealership.',404);
    const addr=person.address && typeof person.address==='object' && !Array.isArray(person.address) ? [person.address.line1,person.address.line2,person.address.city,person.address.county,person.address.postcode].filter((part:unknown):part is string=>typeof part==='string'&&part.trim().length>0).map((part:string)=>part.trim()).join(', ').slice(0,500) : '';
    const row = (await client.query(`INSERT INTO sales_test_sessions(id,parent_dealer_id,staff_user_id,sandbox_dealer_id,vehicle_id,vehicle_title,vehicle_registration,vehicle_price,customer_name,customer_phone,customer_email,customer_address,source_vehicle_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now()+interval '12 hours') RETURNING *`, [id,currentDealerId(),req.staff!.authUserId,sandbox,vehicleId,car.title,car.registration,car.price,person.name,person.phone,person.email,addr,vehicleInput])).rows[0] as Session;
    await client.query(`INSERT INTO vehicles(id,dealer_id,source,advert_id,title,registration,source_price,inventory_status,source_status,year,fuel,transmission,mileage,colour,owners,engine_size,body_type,doors,seats,emission_class,write_off_category)
      SELECT $1,$2,'isolated-test',$3,$4,$5,$6,'available','live',year,fuel,transmission,mileage,colour,owners,engine_size,body_type,doors,seats,emission_class,write_off_category FROM vehicles WHERE id=$7 AND dealer_id=$8`, [vehicleId,sandbox,id,car.title,car.registration,car.price,vehicleInput,currentDealerId()]);
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
export async function session(req: Request): Promise<Session> {
  if (!UUID.test(String(req.params.sessionId))) throw new SaleWorkspaceError('Test session not found.', 404);
  const result=await pool.query('SELECT s.*, EXISTS(SELECT 1 FROM dealerships d WHERE d.id=s.sandbox_dealer_id) AS namespace_collision FROM sales_test_sessions s WHERE s.id=$1 AND s.parent_dealer_id=$2 AND s.staff_user_id=$3', [req.params.sessionId,currentDealerId(),req.staff!.authUserId]);
  const row=result.rows[0] as Session|undefined;
  if(!row) throw new SaleWorkspaceError('Test session not found.',404);
  if(result.rows[0].namespace_collision) throw new SaleWorkspaceError('Test isolation could not be verified.',409);
  return row;
}
export function active(s:Session) {
  if(s.cleaned_at) throw new SaleWorkspaceError('This test session has been cleared.',410);
  if(new Date(s.expires_at).getTime() <= Date.now()) throw new SaleWorkspaceError('This test session has expired. Clear it and start another.',410);
}
router.get('/sales-test/sessions/:sessionId', async(req,res)=>{try{const s=await session(req);active(s);res.json(present(s));}catch(e){fail(req,res,e);}});
router.get('/sales-test/sessions/:sessionId/reports', async(req,res)=>{
  try {
    const period=req.query.period ?? '30d';
    if(period!=='30d' && period!=='90d') throw new SaleWorkspaceError('Choose a supported report period.',400);
    const s=await session(req); active(s);
    res.json(await readTestModeReport(pool,s.id,s.sandbox_dealer_id,period,staffHasPermission(req,'finance.export')));
  } catch(e) { fail(req,res,e); }
});
async function testSettingsTransaction(req:Request, update?:{group:string;config:unknown;expectedRevision:number}) {
  const s=await session(req);active(s);
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const locked=(await client.query('SELECT * FROM sales_test_sessions WHERE id=$1 AND parent_dealer_id=$2 AND staff_user_id=$3 FOR UPDATE',[s.id,s.parent_dealer_id,s.staff_user_id])).rows[0] as Session|undefined;
    if(!locked) throw new SaleWorkspaceError('Test session not found.',404);
    active(locked);
    const original=(await client.query('SELECT config FROM dealer_settings WHERE dealer_id=$1',[s.parent_dealer_id])).rows[0]?.config ?? {};
    const parsed=UpdateDealerSettingsBody.safeParse({...defaultSettings,...original});
    if(!parsed.success) throw new SaleWorkspaceError('The dealership settings could not be copied into this test.',409);
    await client.query('INSERT INTO sales_test_settings(session_id,config) VALUES($1,$2::jsonb) ON CONFLICT DO NOTHING',[s.id,JSON.stringify(parsed.data)]);
    const row=(await client.query('SELECT config,revision FROM sales_test_settings WHERE session_id=$1 FOR UPDATE',[s.id])).rows[0];
    if(update){
      if(!Number.isInteger(update.expectedRevision)||update.expectedRevision!==row.revision) throw new SaleWorkspaceError('Test settings changed elsewhere. Reload and try again.',409);
      if(!update.config || typeof update.config!=='object' || Array.isArray(update.config)) throw new SaleWorkspaceError('Check the test settings.',400);
      const draft=update.config as Record<string,any>, current=row.config as Record<string,any>;
      let next:Record<string,any>;
      if(update.group==='bookings') {
        try { next=bookingSettingsUpdate({testDriveBooking:draft.testDriveBooking},current); }
        catch(e) { if(e instanceof SettingsVersionError) throw new SaleWorkspaceError(e.message,e.status); throw e; }
      }
      else if(update.group==='dealership') next={...current,identity:{...current.identity,name:draft.identity?.name},contact:draft.contact,address:draft.address,hours:draft.hours,legal:draft.legal};
      else if(update.group==='website') next={...current,identity:{...current.identity,logoText:draft.identity?.logoText,brandColors:draft.identity?.brandColors},presentation:{...current.presentation,heroImageAlt:draft.presentation?.heroImageAlt ?? ''}};
      else throw new SaleWorkspaceError('This settings area is not available in test mode.',400);
      const checked=UpdateDealerSettingsBody.safeParse(next);
      if(!checked.success) throw new SaleWorkspaceError('Check the test settings.',400);
      const result=(await client.query('UPDATE sales_test_settings SET config=$2::jsonb,revision=revision+1 WHERE session_id=$1 RETURNING config,revision',[s.id,JSON.stringify(checked.data)])).rows[0];
      await client.query('COMMIT');return result;
    }
    await client.query('COMMIT');return row;
  } catch(e) {await client.query('ROLLBACK');throw e;} finally {client.release();}
}
router.get('/sales-test/sessions/:sessionId/settings',async(req,res)=>{try{res.json(await testSettingsTransaction(req));}catch(e){fail(req,res,e);}});
router.patch('/sales-test/sessions/:sessionId/settings',requirePermission('settings.publish'),async(req,res)=>{try{res.json(await testSettingsTransaction(req,{group:req.body?.group,config:req.body?.config,expectedRevision:req.body?.expectedRevision}));}catch(e){fail(req,res,e);}});
router.get('/sales-test/sessions/:sessionId/email-templates',requirePermission('integrations.manage'),async(req,res)=>{try{const s=await session(req);active(s);res.json(await testModeTemplates(s.id));}catch(e){fail(req,res,e);}});
router.put('/sales-test/sessions/:sessionId/email-templates',requirePermission('integrations.manage'),async(req,res)=>{
  try {
    const s=await session(req);active(s);
    const body=req.body??{}, supported=defaultEmailTemplates.find(item=>item.id===body.id);
    if(!supported || !Number.isInteger(body.expectedRevision) || Object.keys(body).some(key=>!['id','expectedRevision','subject','body','headline','reset'].includes(key))) throw new SaleWorkspaceError('Choose a supported email template.',400);
    let copy;try {copy=body.reset===true ? supported : validateEmailTemplate(body);}catch(e){if(e instanceof EmailTemplateError)throw new SaleWorkspaceError(e.message,e.status);throw e;}
    await testSettingsTransaction(req);
    const initial=await testModeTemplates(s.id);
    const client=await pool.connect();
    try {
      await client.query('BEGIN');const locked=(await client.query('SELECT * FROM sales_test_sessions WHERE id=$1 AND parent_dealer_id=$2 AND staff_user_id=$3 FOR UPDATE',[s.id,s.parent_dealer_id,s.staff_user_id])).rows[0] as Session|undefined;
      if(!locked)throw new SaleWorkspaceError('Test session not found.',404);active(locked);
      const row=(await client.query('SELECT templates,templates_revision FROM sales_test_settings WHERE session_id=$1 FOR UPDATE',[s.id])).rows[0];
      if(row.templates_revision!==body.expectedRevision)throw new SaleWorkspaceError('Test wording changed elsewhere. Reload and try again.',409);
      const templates=(row.templates??initial.templates).map((item:any)=>item.id===body.id ? {...item,...copy} : item);
      const result=(await client.query('UPDATE sales_test_settings SET templates=$2::jsonb,templates_revision=templates_revision+1 WHERE session_id=$1 RETURNING templates,templates_revision',[s.id,JSON.stringify(templates)])).rows[0];
      await client.query('COMMIT');res.json({templates:result.templates,revision:result.templates_revision,variables:emailTemplateVariables});
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }catch(e){fail(req,res,e);}
});
const testPaperworkSchema=z.object({expectedRevision:z.number().int().positive(),saleTerms:z.string().trim().max(20000),reservationTerms:z.string().trim().max(20000),correctionSettings:z.object({handling:z.literal('accountant'),instructions:z.string().trim().max(500)}).strict().optional(),invoiceSettings:z.object({layoutVersion:z.literal('classic-ledger-v1').optional(),style:z.enum(['classic','modern','premium','understated','branded']),useWebsiteColour:z.boolean(),accent:z.string().regex(/^#[0-9a-fA-F]{6}$/),showLogo:z.boolean(),logoSize:z.enum(['small','medium','large']),inkSaving:z.boolean(),footer:z.string().trim().max(600),paymentInstructions:z.string().trim().max(1200),referencePrefix:z.string().regex(/^[A-Z0-9]{0,12}$/),startingSequence:z.number().int().min(1).max(999999999)}).strict().optional()}).strict();
async function testPaperwork(s:Session) {
  const row=(await pool.query('SELECT paperwork,paperwork_revision FROM sales_test_settings WHERE session_id=$1',[s.id])).rows[0];
  if(row?.paperwork)return {...row.paperwork,revision:row.paperwork_revision};
  return {...await dealerIntegrationsStore.readSalesPaperwork(),revision:1};
}
router.get('/sales-test/sessions/:sessionId/paperwork',requirePermission('integrations.manage'),async(req,res)=>{try{const s=await session(req);active(s);res.json(await testPaperwork(s));}catch(e){fail(req,res,e);}});
router.put('/sales-test/sessions/:sessionId/paperwork',requirePermission('integrations.manage'),async(req,res)=>{
  try {
    const s=await session(req);active(s);const parsed=testPaperworkSchema.safeParse(req.body);if(!parsed.success)throw new SaleWorkspaceError('Check the test document settings.',400);
    await testSettingsTransaction(req);const previous=await testPaperwork(s),client=await pool.connect();
    try {
      await client.query('BEGIN');const locked=(await client.query('SELECT * FROM sales_test_sessions WHERE id=$1 AND parent_dealer_id=$2 AND staff_user_id=$3 FOR UPDATE',[s.id,s.parent_dealer_id,s.staff_user_id])).rows[0] as Session|undefined;
      if(!locked)throw new SaleWorkspaceError('Test session not found.',404);active(locked);
      const row=(await client.query('SELECT paperwork,paperwork_revision FROM sales_test_settings WHERE session_id=$1 FOR UPDATE',[s.id])).rows[0];
      if(row.paperwork_revision!==parsed.data.expectedRevision)throw new SaleWorkspaceError('Test document settings changed elsewhere. Reload and try again.',409);
      const {expectedRevision:_,...incoming}=parsed.data;
      const value={...previous,...(row.paperwork??{}),...incoming};delete value.revision;
      const options=currentInvoiceSettings(value.invoiceSettings);
      if(compactInvoiceStyle(options.style)) {
        const wording={saleTerms:value.saleTerms,reservationTerms:value.reservationTerms,footer:options.footer,paymentInstructions:options.paymentInstructions};
        for(const key of Object.keys(invoiceTextLimits) as Array<keyof typeof invoiceTextLimits>) if(wording[key].length>invoiceTextLimits[key]) throw new SaleWorkspaceError(`Shorten ${key.replace(/([A-Z])/g,' $1').toLowerCase()} to ${invoiceTextLimits[key]} characters for the A4 invoice.`,400);
      }
      const result=(await client.query('UPDATE sales_test_settings SET paperwork=$2::jsonb,paperwork_revision=paperwork_revision+1 WHERE session_id=$1 RETURNING paperwork,paperwork_revision',[s.id,JSON.stringify(value)])).rows[0];
      await client.query('COMMIT');res.json({...result.paperwork,revision:result.paperwork_revision});
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }catch(e){fail(req,res,e);}
});
router.all('/sales-test/sessions/:sessionId/team',requirePermission('team.manage'),async(req,res)=>{
  try {
    if(!['GET','POST','PATCH'].includes(req.method))throw new SaleWorkspaceError('Action unavailable.',405);
    const s=await session(req);active(s);await testSettingsTransaction(req);
    const originals=(await pool.query('SELECT email,name,role,disabled_at FROM portal_users WHERE dealer_id=$1 ORDER BY created_at',[s.parent_dealer_id])).rows.map(member=>({id:randomUUID(),email:member.email,name:member.name,role:member.role,active:!member.disabled_at,invited:false}));
    const client=await pool.connect();
    try {
      await client.query('BEGIN');const locked=(await client.query('SELECT * FROM sales_test_sessions WHERE id=$1 AND parent_dealer_id=$2 AND staff_user_id=$3 FOR UPDATE',[s.id,s.parent_dealer_id,s.staff_user_id])).rows[0] as Session|undefined;
      if(!locked)throw new SaleWorkspaceError('Test session not found.',404);active(locked);
      const row=(await client.query('SELECT team,team_revision FROM sales_test_settings WHERE session_id=$1 FOR UPDATE',[s.id])).rows[0];
      let members:Array<{id:string;email:string|null;name:string|null;role:string;active:boolean;invited:boolean}>=row.team??originals;
      let revision=row.team_revision;
      if(req.method!=='GET') {
        if(!Number.isInteger(req.body?.expectedRevision)||req.body.expectedRevision!==revision)throw new SaleWorkspaceError('Test team changed. Reload and try again.',409);
        const roles=['owner','salesperson','accounts'];
        if(req.method==='POST') {
          const email=typeof req.body?.email==='string'?req.body.email.trim().toLowerCase():'',role=req.body?.role;
          if(email.length>254 || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(email) || !roles.includes(role))throw new SaleWorkspaceError('Enter a valid email and role.',400);
          if(members.some(member=>member.email?.toLowerCase()===email))throw new SaleWorkspaceError('This email is already on the test team.',409);
          members=[...members,{id:randomUUID(),email,name:null,role,active:false,invited:true}];
        } else {
          const {id,role,active:enabled}=req.body??{};const index=members.findIndex(member=>member.id===id);
          if(index<0)throw new SaleWorkspaceError('Test staff member not found.',404);
          if((role!==undefined&&!roles.includes(role)) || (enabled!==undefined&&typeof enabled!=='boolean') || (role===undefined&&enabled===undefined))throw new SaleWorkspaceError('Choose a valid role or access state.',400);
          const member=members[index],nextRole=role??member.role,nextActive=enabled??member.active;
          if(member.role==='owner'&&member.active&&(nextRole!=='owner'||!nextActive)&&members.filter(item=>item.role==='owner'&&item.active).length<=1)throw new SaleWorkspaceError('Keep at least one active owner.',409);
          members=members.map((item,i)=>i===index?{...item,role:nextRole,active:nextActive}:item);
        }
        revision++;
      }
      // Save the initial copy as well so IDs remain stable through this session.
      await client.query('UPDATE sales_test_settings SET team=$2::jsonb,team_revision=$3 WHERE session_id=$1',[s.id,JSON.stringify(members),revision]);
      await client.query('COMMIT');res.json({members,revision});
    }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
  }catch(e){fail(req,res,e);}
});
router.get('/sales-test/sessions/:sessionId/stock', async(req,res)=>{
  try{
    const s=await session(req);active(s);
    const row=(await pool.query('SELECT inventory_status FROM vehicles WHERE id=$1 AND dealer_id=$2 AND source=$3 AND advert_id=$4',[s.vehicle_id,s.sandbox_dealer_id,'isolated-test',s.id])).rows[0];
    if(!row) throw new SaleWorkspaceError('Test vehicle not found.',404);
    res.json({cars:[{...vehicleFor(s),inventoryStatus:row.inventory_status}]});
  }catch(e){fail(req,res,e);}
});
export async function cleanupTestSession(s:Session,expiredOnly=false):Promise<boolean>{
  const client=await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`sale-workspace:${s.sandbox_dealer_id}`]);
      const locked=(await client.query('SELECT * FROM sales_test_sessions WHERE id=$1 AND parent_dealer_id=$2 AND staff_user_id=$3 FOR UPDATE',[s.id,s.parent_dealer_id,s.staff_user_id])).rows[0] as Session|undefined;
      if(!locked) throw new SaleWorkspaceError('Test session not found.',404);
      if(expiredOnly && new Date(locked.expires_at).getTime()>Date.now()) { await client.query('COMMIT'); return false; }
      // A crash can leave a send outcome unknown. Never retry it; after a
      // bounded grace period permit cleanup without pretending it failed.
      await client.query("UPDATE sales_test_email_previews SET status='unknown' WHERE session_id=$1 AND status='sending' AND coalesce(sending_at,created_at) < now()-interval '5 minutes'",[locked.id]);
      if((await client.query("SELECT 1 FROM sales_test_email_previews WHERE session_id=$1 AND status='sending' LIMIT 1",[locked.id])).rows.length)throw new SaleWorkspaceError('Wait for the test email to finish before clearing this session.',409);
      if(!/^__sales_test__[0-9a-f-]{36}$/i.test(locked.sandbox_dealer_id)) throw new SaleWorkspaceError('Test isolation could not be verified. No data was removed.',409);
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
        const linked=(await client.query('SELECT sale_id,customer_name FROM sales_test_enquiries WHERE session_id=$1 AND sale_id IS NOT NULL',[locked.id])).rows;
        const expectedNames=new Map(linked.map((item:{sale_id:string;customer_name:string})=>[item.sale_id,item.customer_name]));
        if(cars.length!==1 || cars[0].id!==locked.vehicle_id || cars[0].source!=='isolated-test' || cars[0].advert_id!==locked.id || foreign.length || sales.some((row:any)=>row.state?.draft?.vehicleId!==locked.vehicle_id || row.state?.draft?.customer!==(expectedNames.get(row.state?.id) ?? locked.customer_name) || row.state?.draft?.sourceEnquiryId || row.state?.draft?.sourceReservationId)) throw new SaleWorkspaceError('Test isolation could not be verified. No data was removed.',409);
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
      await client.query('COMMIT');return true;
    } catch(e){await client.query('ROLLBACK');throw e;} finally{client.release();}
}
router.delete('/sales-test/sessions/:sessionId', async(req,res)=>{
  try { const s=await session(req); await cleanupTestSession(s);res.json({cleared:true}); }
  catch(e){fail(req,res,e);}
});
let cleanupCursor:{expiresAt:Date; id:string}|null=null;
export async function cleanupExpiredTestSessions(log?:{error:(obj:unknown,message:string)=>void}):Promise<number>{
  // Keyset progress means a quarantined unsafe row cannot starve later sessions.
  const rows=(await pool.query(`SELECT * FROM sales_test_sessions WHERE cleaned_at IS NULL AND expires_at<=now() AND ($1::timestamptz IS NULL OR (expires_at,id)>($1::timestamptz,$2::uuid)) ORDER BY expires_at,id LIMIT 50`,[cleanupCursor?.expiresAt??null,cleanupCursor?.id??null])).rows as Session[];
  let cleaned=0;
  for(const row of rows){try{if(await cleanupTestSession(row,true))cleaned++;}catch(err){log?.error({err,sessionId:row.id},'Could not safely clear an expired test session');}}
  cleanupCursor=rows.length===50 ? {expiresAt:rows[rows.length-1]!.expires_at,id:rows[rows.length-1]!.id} : null;
  return cleaned;
}
export function startSalesTestCleanupWorker(log:{error:(obj:unknown,message:string)=>void}):()=>void{
  let stopped=false,running=false;
  const run=async()=>{if(stopped||running)return;running=true;try{await cleanupExpiredTestSessions(log);}catch(err){log.error({err},'Could not check expired test sessions');}finally{running=false;}};
  const timer=setInterval(()=>void run(),60*60*1000);timer.unref();void run();return ()=>{stopped=true;clearInterval(timer);};
}
export function sandboxStore(s:Session,linkEnquiryId?:string) {
  return new PostgresSaleWorkspaceStore(s.sandbox_dealer_id, async(_draft,client) => {
    const row=(await client.query('SELECT coalesce(t.config,d.config) AS config FROM (SELECT 1) seed LEFT JOIN sales_test_settings t ON t.session_id=$1 LEFT JOIN dealer_settings d ON d.dealer_id=$2',[s.id,s.parent_dealer_id])).rows[0];
    const dealer=saleWorkspaceBranding(row?.config);
    dealer.identity.name=`${dealer.identity.name || 'Dealership'} · TEST`;
    const saved=(await client.query('SELECT paperwork FROM sales_test_settings WHERE session_id=$1',[s.id])).rows[0]?.paperwork;
    const paperwork=saved ?? await dealerIntegrationsStore.readSalesPaperwork(client);
    const branding=currentInvoiceBranding(dealer,{...defaultInvoiceSettings,...paperwork.invoiceSettings,referencePrefix:'TEST',footer:'TEST ONLY — NOT A REAL INVOICE',paymentInstructions:''});
    const v=(await client.query('SELECT year,fuel,transmission,mileage,colour,owners,engine_size,body_type,doors,seats,emission_class,write_off_category FROM vehicles WHERE id=$1 AND dealer_id=$2',[s.vehicle_id,s.sandbox_dealer_id])).rows[0];
    return {branding,vehicle:{id:s.vehicle_id,title:s.vehicle_title,registration:s.vehicle_registration,year:v?.year,fuel:v?.fuel,transmission:v?.transmission,mileage:v?.mileage,colour:v?.colour,owners:v?.owners,engineSize:v?.engine_size,bodyType:v?.body_type,doors:v?.doors,seats:v?.seats,emissionClass:v?.emission_class,writeOffCategory:v?.write_off_category},paperwork:{saleTerms:paperwork.saleTerms || 'TEST ONLY — NOT A CONTRACT',reservationTerms:paperwork.reservationTerms || 'TEST ONLY — NO REAL PAYMENT'}};
  }, pool, {
    omitInvoiceVerification:true, logoOwnerDealerId:s.parent_dealer_id,
    onCreateReplay:linkEnquiryId ? async(client,sale)=>{
      const item=(await client.query('SELECT sale_id FROM sales_test_enquiries WHERE id=$1 AND session_id=$2 FOR UPDATE',[linkEnquiryId,s.id])).rows[0];
      if(!item || item.sale_id!==sale.id) throw new SaleWorkspaceError('This request was already used for another sale.',409);
    }:undefined,
    afterCreate:linkEnquiryId ? async(client,sale)=>{
      const item=(await client.query('SELECT sale_id FROM sales_test_enquiries WHERE id=$1 AND session_id=$2 FOR UPDATE',[linkEnquiryId,s.id])).rows[0];
      if(!item) throw new SaleWorkspaceError('Test enquiry not found.',404);
      if(item.sale_id) throw new SaleWorkspaceError('This test enquiry already has a sale.',409);
      await client.query('UPDATE sales_test_enquiries SET sale_id=$3,revision=revision+1 WHERE id=$1 AND session_id=$2',[linkEnquiryId,s.id,sale.id]);
    }:undefined,
    afterLock:async(client:SaleWorkspaceReadClient)=>{
      const row=(await client.query('SELECT * FROM sales_test_sessions WHERE id=$1 AND parent_dealer_id=$2 AND staff_user_id=$3 AND sandbox_dealer_id=$4 FOR UPDATE',[s.id,s.parent_dealer_id,s.staff_user_id,s.sandbox_dealer_id])).rows[0] as Session|undefined;
      if(!row) throw new SaleWorkspaceError('Test session not found.',404);
      active(row);
      if ((await client.query('SELECT 1 FROM dealerships WHERE id=$1',[s.sandbox_dealer_id])).rows.length) throw new SaleWorkspaceError('Test isolation could not be verified.',409);
    },
  });
}
async function validateDraft(value:unknown,s:Session,options:{enquiryId?:string;saleId?:string}={}) {
  if(!value || typeof value!=='object' || Array.isArray(value)) throw new SaleWorkspaceError('Use the customer and car copied into this test.');
  const d=value as Record<string,any>;
  let expected={name:s.customer_name,email:s.customer_email,phone:s.customer_phone};
  if(options.enquiryId || options.saleId){
    const linked=(await pool.query(`SELECT customer_name,email,phone,vehicle_id FROM sales_test_enquiries WHERE session_id=$1 AND ${options.enquiryId ? 'id' : 'sale_id'}=$2::uuid`,[s.id,options.enquiryId ?? options.saleId])).rows[0];
    if(options.enquiryId && !linked) throw new SaleWorkspaceError('Test enquiry not found.',404);
    if(linked && linked.vehicle_id!==s.vehicle_id) throw new SaleWorkspaceError('Start a separate test session for this car before creating its sale.',409);
    if(linked) expected={name:linked.customer_name,email:linked.email,phone:linked.phone};
  }
  if(d.vehicleId!==s.vehicle_id || d.vehicle!==s.vehicle_title || d.registration!==s.vehicle_registration || d.customer!==expected.name || d.email!==expected.email || d.phone!==expected.phone || d.sourceEnquiryId || d.sourceReservationId || d.appointment) throw new SaleWorkspaceError('Use the customer and vehicle in this test enquiry.',400);
  return d as SaleWorkspaceDraft;
}
const route='/sales-test/sessions/:sessionId/sale-workspace';
router.get(route,async(req,res)=>{try{const s=await session(req);active(s);res.json({...await sandboxStore(s).list(),preview:false});}catch(e){fail(req,res,e);}});
router.post(route,async(req,res)=>{try{const s=await session(req);active(s);const link=req.body?.testEnquiryId;if(link!==undefined&&!UUID.test(String(link)))throw new SaleWorkspaceError('Test enquiry not found.',404);const draft=await validateDraft(req.body?.draft,s,{enquiryId:link});const result=await sandboxStore(s,link).mutate({requestId:req.body?.requestId,draft,actor:staffLabel(req)});res.status(result.replayed?200:201).json({...result,preview:false});}catch(e){fail(req,res,e);}});
router.get(route+'/:id',async(req,res)=>{try{const s=await session(req);active(s);if(!UUID.test(String(req.params.id)))throw new SaleWorkspaceError('Sale not found.',404);res.json({sale:await sandboxStore(s).get(String(req.params.id)),preview:false});}catch(e){fail(req,res,e);}});
router.put(route+'/:id',async(req,res)=>{try{const s=await session(req);active(s);if(!UUID.test(String(req.params.id)))throw new SaleWorkspaceError('Sale not found.',404);const draft=await validateDraft(req.body?.draft,s,{saleId:String(req.params.id)});res.json({...await sandboxStore(s).mutate({id:String(req.params.id),requestId:req.body?.requestId,expectedRevision:req.body?.expectedRevision,command:{action:'update',draft},actor:staffLabel(req)}),preview:false});}catch(e){fail(req,res,e);}});
router.post(route+'/:id/payments/:paymentId/reverse',requirePermission('payments.refund'),async(req,res)=>{
  try{const s=await session(req);active(s);if(!UUID.test(String(req.params.id))||!UUID.test(String(req.params.paymentId)))throw new SaleWorkspaceError('Payment not found.',404);
    const result=await sandboxStore(s).mutate({id:String(req.params.id),requestId:req.body?.requestId,expectedRevision:req.body?.expectedRevision,command:{action:'reverse',paymentId:String(req.params.paymentId),amount:req.body?.amount,kind:req.body?.kind,reason:req.body?.reason,date:req.body?.date,method:req.body?.method,invoiceOnly:req.body?.invoiceOnly===true},actor:staffLabel(req)});res.json({...result,preview:false});
  }catch(e){fail(req,res,e);}
});
const actions: Record<string,{permission:'payments.record'|'sales.manage'|'sales.handover'; command:(body:any)=>SaleWorkspaceCommand}> = {
  'invoice-payments':{permission:'payments.record',command:b=>({action:'invoice-payment',payment:b.payment})},
  'issue-invoice':{permission:'payments.record',command:b=>({action:'issue-invoice',kind:b.kind,acknowledge:b.acknowledge})},
  'finish-invoice-sale':{permission:'payments.record',command:b=>({action:'finish-invoice-sale',acknowledge:b.acknowledge,acknowledgeOutstanding:b.acknowledgeOutstanding===true})},
  'fulfilment':{permission:'sales.manage',command:b=>({action:'fulfilment',fulfilment:b.fulfilment})},
  'handover':{permission:'sales.handover',command:b=>({action:'handover',recipient:b.recipient,completedAt:b.completedAt,acknowledgeOutstanding:b.acknowledgeOutstanding})},
  'lifecycle':{permission:'sales.manage',command:b=>({action:'lifecycle',status:b.status})},
  'corrections':{permission:'sales.manage',command:b=>({action:'correction-note',description:b.description,reference:b.reference})},
  'checklists':{permission:'sales.manage',command:b=>({action:'checklists',completion:b.completion,partExchanges:b.partExchanges})},
};
router.post(route+'/:id/:action',async(req,res,next)=>{const key=String(req.params.action);const action=Object.hasOwn(actions,key)?actions[key]:undefined;if(!action){res.status(404).json({error:'This action is unavailable in test mode.'});return;}requirePermission(action.permission)(req,res,next);},async(req,res)=>{
  try{const s=await session(req);active(s);if(!UUID.test(String(req.params.id)))throw new SaleWorkspaceError('Sale not found.',404);
    const action=actions[String(req.params.action)]!;
    if(req.params.action==='lifecycle' && req.body?.status!=='released')throw new SaleWorkspaceError('Only a test reservation can be released here.');
    const result=await sandboxStore(s).mutate({id:String(req.params.id),requestId:req.body?.requestId,expectedRevision:req.body?.expectedRevision,command:action.command(req.body),actor:staffLabel(req)});res.json({...result,preview:false});
  }catch(e){fail(req,res,e);}
});
router.get(route+'/:id/documents/:documentId/pdf',async(req,res)=>{try{const s=await session(req);active(s);if(!UUID.test(String(req.params.id))||!UUID.test(String(req.params.documentId)))throw new SaleWorkspaceError('Document not found.',404);const {document,archive}=await sandboxStore(s).pdf(String(req.params.id),String(req.params.documentId));res.set({'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="TEST-${document.number.replace(/[^A-Za-z0-9_-]/g,'')}.pdf"`,'X-Robots-Tag':'noindex, nofollow'}).end(Buffer.from(archive.content,'base64'));}catch(e){fail(req,res,e);}});
export default router;
