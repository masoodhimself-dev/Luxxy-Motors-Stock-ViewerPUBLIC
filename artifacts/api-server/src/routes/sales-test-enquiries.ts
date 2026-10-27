import { createHash, randomUUID } from 'node:crypto';
import { Router, type Request } from 'express';
import { pool } from '@workspace/db';
import { currentDealerId, multiTenantEnabled } from '../lib/tenant-context';
import { readFeatureRules } from '../lib/dealer-features';
import { resolveDealerFeatures, type DealerFeatureKey } from '@workspace/vehicle-meta';
import { requireStaff, requirePermission } from '../middlewares/staff-auth';
import { addDays, bookingDateIsInWindow, bookingPolicyFromConfig, bookingTimezone, dateStringInTimezone, getSlotsForDate, isValidDateString, slotIsAvailable } from '../lib/booking-slots';
import { appointmentDiaryWindow } from '../lib/appointment-diary-window';

const router=Router();
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const route='/sales-test/sessions/:sessionId/enquiries';
router.use('/sales-test',requireStaff,requirePermission('sales.manage'));
class Problem extends Error {constructor(message:string,readonly status=400){super(message);}}
const present=(r:any)=>({id:r.id,reference:`TEST-${r.id.slice(0,8).toUpperCase()}`,vehicleId:r.vehicle_id,vehicleTitle:r.vehicle_title,vehicleRegistration:r.vehicle_registration,customerName:r.customer_name,phone:r.phone,email:r.email,type:r.type,message:r.message,partExchange:r.part_exchange,source:'website',status:'new',createdAt:r.created_at,appointmentAt:r.appointment_at,appointmentStatus:r.appointment_status,saleId:r.sale_id,revision:r.revision});
const validateDate=(value:unknown)=>{if(typeof value!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(value)||!Number.isFinite(Date.parse(value))) throw new Problem('Choose a valid appointment date and time.');return new Date(value).toISOString();};
async function lockedSession(client:any,req:Request){
 if(!uuid.test(String(req.params.sessionId))) throw new Problem('Test session not found.',404);
 const r=await client.query(`SELECT s.*,EXISTS(SELECT 1 FROM dealerships d WHERE d.id=s.sandbox_dealer_id) namespace_collision FROM sales_test_sessions s WHERE s.id=$1 AND s.parent_dealer_id=$2 AND s.staff_user_id=$3 FOR UPDATE`,[req.params.sessionId,currentDealerId(),req.staff!.authUserId]);
 const s=r.rows[0];if(!s)throw new Problem('Test session not found.',404);if(s.namespace_collision)throw new Problem('Test isolation could not be verified.',409);if(s.cleaned_at||new Date(s.expires_at).getTime()<=Date.now())throw new Problem('This test session has expired.',410);return s;
}
// Read the same dealer policy and diary as the public booking page, adding only
// this session's own practice appointments. The live diary is never changed.
async function testConfiguration(client:any,s:any) {
 const settings=await client.query('SELECT config FROM sales_test_settings WHERE session_id=$1 UNION ALL SELECT config FROM dealer_settings WHERE dealer_id=$2 AND NOT EXISTS (SELECT 1 FROM sales_test_settings WHERE session_id=$1) LIMIT 1',[s.id,s.parent_dealer_id]);
 return settings.rows[0]?.config ?? {};
}
async function requireTestFeatures(client:any,s:any,keys:DealerFeatureKey[]) {
 const rules=multiTenantEnabled()?await readFeatureRules(s.parent_dealer_id,client):{defaults:{},overrides:{}};
 const enabled=resolveDealerFeatures(rules.defaults,rules.overrides);
 if(keys.some(key=>!enabled.some(feature=>feature.key===key&&feature.enabled)))throw new Problem('This feature is currently unavailable for this dealership.',403);
}
async function testAvailability(client:any,s:any,date:string) {
 const policy=bookingPolicyFromConfig(await testConfiguration(client,s));
 if(!isValidDateString(date)||!bookingDateIsInWindow(date,policy))throw new Problem(`Choose a date within the next ${policy.daysAhead} days.`);
 const {from,to}=appointmentDiaryWindow(date);
 const live=await client.query(`SELECT id,appointment_at,appointment_duration_minutes,appointment_buffer_minutes FROM enquiries WHERE dealer_id=$1 AND type='viewing' AND appointment_cancelled_at IS NULL AND appointment_at >= $2 AND appointment_at < $3`,[s.parent_dealer_id,from,to]);
 const test=await client.query(`SELECT id,appointment_at FROM sales_test_enquiries WHERE session_id=$1 AND appointment_status IN ('confirmed','pending') AND appointment_at >= $2 AND appointment_at < $3`,[s.id,from,to]);
 const booked=[...live.rows.map((r:any)=>({id:r.id,appointmentAt:r.appointment_at,appointmentDurationMinutes:r.appointment_duration_minutes,appointmentBufferMinutes:r.appointment_buffer_minutes})),...test.rows.map((r:any)=>({id:r.id,appointmentAt:r.appointment_at,appointmentDurationMinutes:policy.durationMinutes,appointmentBufferMinutes:policy.bufferMinutes}))];
 return {policy,booked,slots:getSlotsForDate(date,policy)};
}
async function resolveTestVehicle(client:any,s:any,requested:unknown) {
 const id=requested==null?s.vehicle_id:String(requested);
 if(!uuid.test(id))throw new Problem('Choose a valid test car.');
 if(id===s.vehicle_id || id===s.source_vehicle_id) return {id:s.vehicle_id,title:s.vehicle_title,registration:s.vehicle_registration};
 // Only snapshot publicly available cars belonging to this dealership. Never
 // accept a title or registration supplied by the browser.
 const row=(await client.query(`SELECT id,COALESCE(NULLIF(website_title_override,''),title,'Vehicle') title,COALESCE(registration,plate,vrm,'') registration FROM vehicles WHERE id=$1 AND dealer_id=$2 AND inventory_status='available' AND source_status='live' AND archived_at IS NULL`,[id,s.parent_dealer_id])).rows[0];
 if(!row)throw new Problem('This car is no longer available for a test enquiry.',404);
 return row;
}
async function ensureTestVehicle(client:any,s:any,vehicleId:string) {
 const isCopied=vehicleId===s.vehicle_id;
 const vehicle=(await client.query(isCopied
  ? `SELECT inventory_status,source_status,archived_at FROM vehicles WHERE id=$1 AND dealer_id=$2 AND source='isolated-test' AND advert_id=$3 FOR SHARE`
  : `SELECT inventory_status,source_status,archived_at FROM vehicles WHERE id=$1 AND dealer_id=$2 FOR SHARE`,
  isCopied?[vehicleId,s.sandbox_dealer_id,s.id]:[vehicleId,s.parent_dealer_id])).rows[0];
 if(!vehicle||vehicle.inventory_status!=='available'||vehicle.source_status!=='live'||vehicle.archived_at)throw new Problem('This test car is no longer available for a test drive.',409);
}
async function requireTestSlot(client:any,s:any,value:string,vehicleId:string,excludeId?:string) {
 await ensureTestVehicle(client,s,vehicleId);
 const instant=new Date(value),date=dateStringInTimezone(instant);
 // Match live booking's transaction locks so a simultaneous live booking is
 // reflected before checking. This does not reserve a real slot after commit.
 for(const day of [-1,0,1].map(offset=>addDays(date,offset)).sort()) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',[`test-drive:${s.parent_dealer_id}:${day}`]);
 const {policy,booked}=await testAvailability(client,s,date);
 if(!slotIsAvailable(instant,policy,booked,new Date(),excludeId))throw new Problem('That test-drive time is no longer available. Please choose another.',409);
 return policy;
}
function failure(req:any,res:any,e:unknown){if(e instanceof Problem){res.status(e.status).json({error:e.message});return;}req.log.error({err:e},'Test enquiry failed');res.status(500).json({error:'The test enquiry could not be completed.'});}
router.get(route+'/availability',async(req,res)=>{const client=await pool.connect();try{await client.query('BEGIN');const s=await lockedSession(client,req);const date=typeof req.query.date==='string'?req.query.date:'';const {policy,booked,slots}=await testAvailability(client,s,date);const excludeId=typeof req.query.excludeId==='string'&&uuid.test(req.query.excludeId)?req.query.excludeId:undefined;if(excludeId && !(await client.query('SELECT 1 FROM sales_test_enquiries WHERE id=$1 AND session_id=$2',[excludeId,s.id])).rows.length)throw new Problem('Test enquiry not found.',404);const out=slots.map(slot=>({startAt:slot.startAt.toISOString(),label:slot.label,available:slotIsAvailable(slot.startAt,policy,booked,new Date(),excludeId)}));await client.query('COMMIT');res.set('Cache-Control','private, no-store').json({date,timezone:bookingTimezone,slots:out});}catch(e){await client.query('ROLLBACK');failure(req,res,e);}finally{client.release();}});
router.get(route,async(req,res)=>{const client=await pool.connect();try{await client.query('BEGIN');await lockedSession(client,req);const rows=(await client.query('SELECT * FROM sales_test_enquiries WHERE session_id=$1 ORDER BY created_at DESC',[req.params.sessionId])).rows;await client.query('COMMIT');res.set('Cache-Control','private, no-store').json({enquiries:rows.map(present)});}catch(e){await client.query('ROLLBACK');failure(req,res,e);}finally{client.release();}});
router.post(route,async(req,res)=>{const client=await pool.connect();try{
 const {requestId,type,message}=req.body??{};if(!uuid.test(String(requestId))||!['general','viewing','part_exchange'].includes(type)||typeof message!=='string'||!message.trim()||message.length>4000)throw new Problem('Enter a valid enquiry.');
 const appointmentAt=type==='viewing'?validateDate(req.body.appointmentAt):null;if(type!=='viewing'&&req.body.appointmentAt)throw new Problem('Only viewing enquiries can include an appointment.');
 const contact=req.body.contact;if(contact!==undefined && (!contact || typeof contact!=='object' || typeof contact.name!=='string' || contact.name.trim().length<2 || contact.name.trim().length>120 || typeof contact.email!=='string' || contact.email.length>254 || (contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) || typeof contact.phone!=='string' || (contact.phone && !/^\+?\d{7,15}$/.test(contact.phone))))throw new Problem('Check the customer contact details.');
 const cleanedContact=contact?{name:contact.name.trim(),email:contact.email.trim(),phone:contact.phone.trim()}:null;
 const exchange=req.body.partExchange;
 if(exchange!==undefined && exchange!==null && (!exchange || typeof exchange!=='object' || typeof exchange.registration!=='string' || !/^[A-Z0-9 ]{2,12}$/i.test(exchange.registration.trim()) || !Number.isInteger(exchange.mileage) || exchange.mileage<0 || exchange.mileage>1000000 || (exchange.condition!=null && !['excellent','good','fair','poor'].includes(exchange.condition))))throw new Problem('Check the part-exchange details.');
 const partExchange=exchange?{registration:exchange.registration.trim().toUpperCase(),mileage:exchange.mileage,condition:exchange.condition??null}:null;
 const hasVehicle=Object.prototype.hasOwnProperty.call(req.body,'vehicleId');
 const noVehicle=hasVehicle && req.body.vehicleId===null;
 if(noVehicle && (type!=='general'||partExchange))throw new Problem('Choose a car for this enquiry.');
 const requestedVehicle=noVehicle ? null : req.body.vehicleId ?? null;
 const fingerprint=createHash('sha256').update(JSON.stringify({type,message:message.trim(),appointmentAt,contact:cleanedContact,partExchange,vehicleId:noVehicle?'[no-car]':requestedVehicle})).digest('hex');
 await client.query('BEGIN');const s=await lockedSession(client,req);
 const existing=(await client.query('SELECT * FROM sales_test_enquiries WHERE session_id=$1 AND request_id=$2',[s.id,requestId])).rows[0];
 if(existing){if(existing.request_fingerprint!==fingerprint)throw new Problem('This request was already used for another enquiry.',409);await client.query('COMMIT');res.json({enquiry:present(existing),replayed:true});return;}
 const requestedFeature:DealerFeatureKey=type==='viewing'?'testDriveBookings':type==='part_exchange'?'partExchange':'publicEnquiries';
 await requireTestFeatures(client,s,[requestedFeature,...(partExchange?['partExchange' as const]:[])]);
 if((type==='part_exchange'||partExchange)&& (await testConfiguration(client,s))?.partExchange?.enabled!==true)throw new Problem('Part exchange is not available online.',403);
 const car=noVehicle?null:await resolveTestVehicle(client,s,requestedVehicle);
 const bookingPolicy=appointmentAt&&car?await requireTestSlot(client,s,appointmentAt,car.id):null;
 const row=(await client.query(`INSERT INTO sales_test_enquiries(id,session_id,request_id,request_fingerprint,vehicle_id,vehicle_title,customer_name,phone,email,type,message,appointment_at,appointment_status,part_exchange,vehicle_registration) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15) RETURNING *`,[randomUUID(),s.id,requestId,fingerprint,car?.id??null,car?.title??'',cleanedContact?.name??s.customer_name,cleanedContact?.phone??s.customer_phone,cleanedContact?.email??s.customer_email,type,message.trim(),appointmentAt,appointmentAt?(bookingPolicy?.confirmationMode==='approval'?'pending':'confirmed'):null,JSON.stringify(partExchange),car?.registration??''])).rows[0];
 await client.query('COMMIT');res.status(201).json({enquiry:present(row),replayed:false});
 }catch(e){await client.query('ROLLBACK');failure(req,res,e);}finally{client.release();}});
router.post(route+'/:id/appointment',async(req,res)=>{const client=await pool.connect();try{
 const {requestId,expectedRevision,action}=req.body??{};if(!uuid.test(String(requestId))||!uuid.test(String(req.params.id))||!Number.isInteger(expectedRevision)||!['book','cancel','confirm'].includes(action))throw new Problem('Invalid appointment request.');
 const appointmentAt=action==='book'?validateDate(req.body.appointmentAt):null;const fingerprint=createHash('sha256').update(JSON.stringify({id:req.params.id,expectedRevision,action,appointmentAt})).digest('hex');
 await client.query('BEGIN');const s=await lockedSession(client,req);const previous=(await client.query('SELECT fingerprint,result FROM sales_test_enquiry_operations WHERE session_id=$1 AND request_id=$2',[s.id,requestId])).rows[0];
 if(previous){if(previous.fingerprint!==fingerprint)throw new Problem('This request was already used for another change.',409);await client.query('COMMIT');res.json({enquiry:previous.result,replayed:true});return;}
 if(action!=='cancel')await requireTestFeatures(client,s,['testDriveBookings']);
 const item=(await client.query('SELECT * FROM sales_test_enquiries WHERE id=$1 AND session_id=$2 FOR UPDATE',[req.params.id,s.id])).rows[0];if(!item)throw new Problem('Test enquiry not found.',404);if(item.revision!==expectedRevision)throw new Problem('This enquiry changed. Reload and try again.',409);if(!item.vehicle_id && action!=='cancel')throw new Problem('Choose a car before booking a test drive.',409);if(action==='cancel'&&!['confirmed','pending'].includes(item.appointment_status))throw new Problem('There is no appointment to cancel.',409);if(action==='confirm'&&item.appointment_status!=='pending')throw new Problem('There is no request to confirm.',409);
 const bookingPolicy=appointmentAt?await requireTestSlot(client,s,appointmentAt,item.vehicle_id,item.id):null;
 if(action==='confirm'){if(!item.appointment_at||new Date(item.appointment_at).getTime()<=Date.now())throw new Problem('Only a future test-drive request can be confirmed.',409);await ensureTestVehicle(client,s,item.vehicle_id);}
 const newStatus=action==='cancel'?'cancelled':action==='book'&&bookingPolicy?.confirmationMode==='approval'?'pending':'confirmed';
 const updated=(await client.query(`UPDATE sales_test_enquiries SET appointment_at=CASE WHEN $3::text='book' THEN $4::timestamptz ELSE appointment_at END,appointment_status=$5,revision=revision+1 WHERE id=$1 AND session_id=$2 RETURNING *`,[item.id,s.id,action,appointmentAt,newStatus])).rows[0];const result=present(updated);
 await client.query('INSERT INTO sales_test_enquiry_operations(session_id,request_id,enquiry_id,fingerprint,result) VALUES($1,$2,$3,$4,$5::jsonb)',[s.id,requestId,item.id,fingerprint,JSON.stringify(result)]);await client.query('COMMIT');res.json({enquiry:result,replayed:false});
 }catch(e){await client.query('ROLLBACK');failure(req,res,e);}finally{client.release();}});
export default router;
