import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { pool } from '@workspace/db';
import { normaliseTenantHost } from './tenant-context';
import { isPlatformAdmin } from './platform-admin';
import { InvitationDeliveryError, invitationEmailReadiness, sendAccountInvitation } from './account-invitation-email';
export type InvitationRole='owner'|'salesperson'|'accounts';
export type InvitationIssuer={id:string;kind:'platform'|'staff'};
export class InvitationError extends Error { readonly status:number; constructor(message:string,status=400){super(message);this.status=status;} }
export const invitationTokenHash=(token:string)=>createHash('sha256').update(token).digest('hex');
export const validInvitationToken=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const interval=7*86400000;
type Row=Record<string,any>;
export function invitationSummary(row:Row) {return {id:row.id,email:row.email,role:row.role,createdAt:row.created_at,expiresAt:row.expires_at,acceptedAt:row.accepted_at,deliveryStatus:row.delivery_status==='sending'&&row.last_sent_at&&Date.now()-Date.parse(row.last_sent_at)>60000?'unknown':row.delivery_status,managedBy:row.issuer_kind,status:row.accepted_at?'accepted':row.revoked_at?'cancelled':Date.parse(row.expires_at)<=Date.now()?'expired':'pending'};}
type InvitationScope={kind:InvitationIssuer['kind'];role:InvitationRole};
function checkInvitationDealer(row:Row,scope:InvitationScope) {
  if(!['draft','active'].includes(row.status))throw new InvitationError('This dealership is not available for invitations.',409);
  if(row.demo) {
    // A verified dealership owner is required before live conversion. Only the
    // platform can arrange that setup access; staff recruitment waits for launch.
    if(scope.kind!=='platform'||scope.role!=='owner')throw new InvitationError('Only the platform can invite the dealership owner during demo setup. Invite other staff after live conversion.',409);
    if(row.status!=='active')throw new InvitationError('Activate this demonstration before inviting its owner for setup.',409);
    const expiry=Date.parse(row.demo_expires_at);
    if(!Number.isFinite(expiry)||expiry<=Date.now())throw new InvitationError('This demonstration has expired. Extend it before setting up owner access.',410);
  }
}
async function dealerForInvite(dealerId:string,scope:InvitationScope,query=pool.query.bind(pool)) {
  const row=(await query('SELECT d.id,d.name,d.status,d.canonical_origin,m.dealer_id IS NOT NULL AS demo,m.expires_at AS demo_expires_at FROM dealerships d LEFT JOIN dealer_demos m ON m.dealer_id=d.id AND m.converted_at IS NULL WHERE d.id=$1',[dealerId])).rows[0];
  if(!row)throw new InvitationError('Dealership not found.',404);
  checkInvitationDealer(row,scope);
  return row;
}
export async function listAccountInvitations(dealerId:string) {
  const result=await pool.query('SELECT * FROM account_invitations WHERE dealer_id=$1 ORDER BY (accepted_at IS NULL AND revoked_at IS NULL) DESC,created_at DESC LIMIT 100',[dealerId]);
  return {invitations:result.rows.map(invitationSummary),email:invitationEmailReadiness()};
}
export async function issueAccountInvitation(dealerId:string,email:string,role:InvitationRole,issuer:InvitationIssuer,options:{resendId?:string;transport?:typeof fetch}={}) {
  if(!invitationEmailReadiness().ready)throw new InvitationError(invitationEmailReadiness().message,503);
  const platformHost=normaliseTenantHost(process.env.PLATFORM_ADMIN_HOST??'');
  const token=randomBytes(32).toString('hex'),id=randomUUID(),attempt=randomUUID(),expiresAt=new Date(Date.now()+interval);
  const client=await pool.connect();let saved:Row,dealer:Row,origin:string;
  try {
    await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`portal-staff:${dealerId}`]);
    if(issuer.kind==='staff') {const actor=(await client.query("SELECT id FROM portal_users WHERE dealer_id=$1 AND auth_user_id=$2 AND role='owner' AND disabled_at IS NULL",[dealerId,issuer.id])).rows[0];if(!actor)throw new InvitationError('Owner access is required.',403);}
    else if(!isPlatformAdmin(issuer.id))throw new InvitationError('Platform administrator access required.',403);
    if(options.resendId) {
      const old=(await client.query('SELECT * FROM account_invitations WHERE dealer_id=$1 AND id=$2 FOR UPDATE',[dealerId,options.resendId])).rows[0];
      if(!old)throw new InvitationError('Invitation not found.',404);
      if(old.accepted_at||old.revoked_at)throw new InvitationError('This invitation is no longer pending.',409);
      if(issuer.kind==='staff'&&old.issuer_kind!=='staff')throw new InvitationError('Only the platform can manage this owner invitation.',403);
      if(old.send_count>=5)throw new InvitationError('This invitation has been sent five times. Cancel it and create a new invitation if needed.',429);
      if(old.last_sent_at&&Date.now()-Date.parse(old.last_sent_at)<60000)throw new InvitationError('Wait one minute before resending this invitation.',429);
      email=old.email;role=old.role;
    }
    // Resends must use the locked invitation's role, not the route's placeholder.
    dealer=await dealerForInvite(dealerId,{kind:issuer.kind,role},client.query.bind(client));
    // A central join page works even while the dealership's domain is being prepared.
    origin=issuer.kind==='platform'?platformHost?`https://${platformHost}`:'':new URL(dealer.canonical_origin).origin;
    if(!origin)throw new InvitationError('The platform sign-in domain must be configured before sending an owner invitation.',503);
    const member=(await client.query('SELECT id FROM portal_users WHERE dealer_id=$1 AND lower(email)=$2',[dealerId,email])).rows[0];
    if(member)throw new InvitationError('This person is already on the team. Manage their access in the staff list instead.',409);
    if(!options.resendId) {
      const existing=(await client.query('SELECT * FROM account_invitations WHERE dealer_id=$1 AND email=$2 AND accepted_at IS NULL AND revoked_at IS NULL',[dealerId,email])).rows[0];
      if(existing)throw new InvitationError('An invitation already exists for this email. Use Resend or cancel it first.',409);
      const recent=(await client.query("SELECT count(*)::int AS count FROM account_invitations WHERE dealer_id=$1 AND created_at>now()-interval '1 day'",[dealerId])).rows[0];
      if(recent.count>=50)throw new InvitationError('The daily invitation limit has been reached. Try again tomorrow.',429);
    }
    saved=(await client.query(options.resendId
      ? "UPDATE account_invitations SET token_hash=$3,delivery_attempt=$4,expires_at=$5,last_sent_at=now(),delivery_status='sending',provider_id=NULL,send_count=send_count+1,created_by=$6,issuer_kind=$7 WHERE dealer_id=$1 AND id=$2 RETURNING *"
      : "INSERT INTO account_invitations(dealer_id,id,email,role,token_hash,delivery_attempt,expires_at,created_by,issuer_kind,last_sent_at,delivery_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),'sending') RETURNING *",options.resendId?[dealerId,options.resendId,invitationTokenHash(token),attempt,expiresAt,issuer.id,issuer.kind]:[dealerId,id,email,role,invitationTokenHash(token),attempt,expiresAt,issuer.id,issuer.kind])).rows[0];
    await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  let status='sent',providerId:string|null=null;
  try{providerId=await sendAccountInvitation({email,dealerName:dealer.name,role,url:`${origin}/join#${token}`,expiresAt,attempt,demoSetup:Boolean(dealer.demo)},options.transport);}
  catch(error){status=error instanceof InvitationDeliveryError?error.outcome:'unknown';}
  // A delayed provider reply must never overwrite a newer resend or cancellation.
  await pool.query('UPDATE account_invitations SET delivery_status=$3,provider_id=$4 WHERE id=$1 AND delivery_attempt=$2 AND revoked_at IS NULL AND accepted_at IS NULL',[saved.id,attempt,status,providerId]);
  return invitationSummary({...saved,delivery_status:status});
}
export async function cancelAccountInvitation(dealerId:string,id:string,issuer:InvitationIssuer) {
  const result=await pool.query("UPDATE account_invitations SET revoked_at=now() WHERE dealer_id=$1 AND id=$2 AND accepted_at IS NULL AND revoked_at IS NULL AND ($3='platform' OR issuer_kind='staff') RETURNING *",[dealerId,id,issuer.kind]);
  if(!result.rows[0])throw new InvitationError('Pending invitation not found, or it cannot be cancelled here.',404);return invitationSummary(result.rows[0]);
}
export async function readAccountInvitation(token:string,host:string) {
  if(!validInvitationToken(token))throw new InvitationError('This invitation link is incomplete. Ask for a fresh invitation.',400);
  const row=(await pool.query('SELECT i.*,d.name AS dealer_name,d.status AS dealer_status,d.canonical_origin,m.dealer_id IS NOT NULL AS demo,m.expires_at AS demo_expires_at FROM account_invitations i JOIN dealerships d ON d.id=i.dealer_id LEFT JOIN dealer_demos m ON m.dealer_id=d.id AND m.converted_at IS NULL WHERE token_hash=$1',[invitationTokenHash(token)])).rows[0];
  if(!row)throw new InvitationError('This invitation is unavailable. Ask for a fresh invitation.',404);
  const allowedHost=row.issuer_kind==='platform'?normaliseTenantHost(process.env.PLATFORM_ADMIN_HOST??''):normaliseTenantHost(new URL(row.canonical_origin).host);
  if(normaliseTenantHost(host)!==allowedHost)throw new InvitationError('Open this invitation using the link in your email.',403);
  if(row.revoked_at||Date.parse(row.expires_at)<=Date.now())throw new InvitationError('This invitation has expired or was cancelled. Ask for a new one.',410);
  if(!['draft','active'].includes(row.dealer_status))throw new InvitationError('This dealership is not currently available. Contact the person who invited you.',409);
  checkInvitationDealer({...row,status:row.dealer_status},{kind:row.issuer_kind,role:row.role});
  return row;
}
export async function acceptAccountInvitation(token:string,host:string,identity:{id:string;emails:string[];name:string}) {
  const initial=await readAccountInvitation(token,host);
  if(!identity.emails.some(email=>email.toLowerCase()===initial.email))throw new InvitationError('Sign in with the invited email address and verify it before accepting.',403);
  const client=await pool.connect();
  try {
    await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`portal-staff:${initial.dealer_id}`]);
    const row=(await client.query('SELECT * FROM account_invitations WHERE id=$1 FOR UPDATE',[initial.id])).rows[0];
    if(row.token_hash!==invitationTokenHash(token)||row.revoked_at||Date.parse(row.expires_at)<=Date.now())throw new InvitationError('This invitation is no longer available. Ask for a fresh invitation.',410);
    const dealer=await dealerForInvite(row.dealer_id,{kind:row.issuer_kind,role:row.role},client.query.bind(client));
    if(row.accepted_at){if(row.accepted_by!==identity.id)throw new InvitationError('This invitation has already been accepted.',410);const member=(await client.query('SELECT id FROM portal_users WHERE dealer_id=$1 AND auth_user_id=$2 AND disabled_at IS NULL',[row.dealer_id,identity.id])).rows[0];if(!member)throw new InvitationError('Your access is no longer active. Contact the dealership owner.',409);await client.query('COMMIT');return {accepted:true,dealerName:dealer.name,portalUrl:dealer.status==='active'?`${dealer.canonical_origin}/portal`:null,demo:Boolean(dealer.demo)};}
    if(row.issuer_kind==='platform'){if(!isPlatformAdmin(row.created_by))throw new InvitationError('The person who invited you no longer has permission. Ask for a new invitation.',410);}
    else {const actor=(await client.query("SELECT id FROM portal_users WHERE dealer_id=$1 AND auth_user_id=$2 AND role='owner' AND disabled_at IS NULL",[row.dealer_id,row.created_by])).rows[0];if(!actor)throw new InvitationError('The person who invited you no longer has owner access. Ask for a new invitation.',410);}
    const existing=(await client.query('SELECT * FROM portal_users WHERE dealer_id=$1 AND auth_user_id=$2',[row.dealer_id,identity.id])).rows[0];
    if(existing?.disabled_at)throw new InvitationError('Your access is disabled. Ask the dealership owner to review it.',409);
    // Acceptance never changes the role of an existing member or reactivates access.
    await client.query('INSERT INTO portal_users(dealer_id,auth_user_id,email,name,role) VALUES($1,$2,$3,$4,$5) ON CONFLICT(dealer_id,auth_user_id) DO NOTHING',[row.dealer_id,identity.id,row.email,identity.name,row.role]);
    await client.query('UPDATE account_invitations SET accepted_at=now(),accepted_by=$2 WHERE id=$1',[row.id,identity.id]);await client.query('COMMIT');
    return {accepted:true,dealerName:dealer.name,portalUrl:dealer.status==='active'?`${dealer.canonical_origin}/portal`:null,demo:Boolean(dealer.demo)};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
