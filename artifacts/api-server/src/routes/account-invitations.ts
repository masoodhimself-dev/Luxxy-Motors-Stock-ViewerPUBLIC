import { Router, type Request, type Response } from 'express';
import { getAuth,clerkClient } from '@clerk/express';
import { z } from 'zod/v4';
import { currentDealerId, normaliseTenantHost } from '../lib/tenant-context';
import { acceptAccountInvitation,cancelAccountInvitation,InvitationError,issueAccountInvitation,listAccountInvitations,readAccountInvitation } from '../lib/account-invitations';
const emailInput=z.object({email:z.string().trim().toLowerCase().email().max(254),role:z.enum(['owner','salesperson','accounts'])}).strict();
function failure(req:Request,res:Response,error:unknown) {if(!(error instanceof InvitationError))req.log?.warn('Account invitation operation failed');res.status(error instanceof InvitationError?error.status:503).json({error:error instanceof InvitationError?error.message:'The invitation could not be completed. Refresh its status before trying again.'});}
export function accountInvitationManagementRouter(kind:'platform'|'staff') {
  const router=Router({mergeParams:true});
  const dealer=(req:Request)=>kind==='platform'?String(req.params.id):currentDealerId();
  const issuer=(req:Request)=>({id:kind==='platform'?getAuth(req).userId!:req.staff!.authUserId,kind});
  router.get('/',async(req,res)=>{res.set('Cache-Control','no-store');try{res.json(await listAccountInvitations(dealer(req)));}catch(error){failure(req,res,error);}});
  router.post('/',async(req,res)=>{try{const input=emailInput.safeParse(req.body);if(!input.success)throw new InvitationError('Enter a valid email and choose a staff role.');if(kind==='platform'&&input.data.role!=='owner')throw new InvitationError('The platform sends dealership owner invitations only.');res.status(201).json({invitation:await issueAccountInvitation(dealer(req),input.data.email,input.data.role,issuer(req))});}catch(error){failure(req,res,error);}});
  router.post('/:invitationId/resend',async(req,res)=>{try{if(!z.string().uuid().safeParse(req.params.invitationId).success)throw new InvitationError('Invalid invitation.');res.json({invitation:await issueAccountInvitation(dealer(req),'','salesperson',issuer(req),{resendId:String(req.params.invitationId)})});}catch(error){failure(req,res,error);}});
  router.post('/:invitationId/cancel',async(req,res)=>{try{if(!z.string().uuid().safeParse(req.params.invitationId).success)throw new InvitationError('Invalid invitation.');res.json({invitation:await cancelAccountInvitation(dealer(req),String(req.params.invitationId),issuer(req))});}catch(error){failure(req,res,error);}});
  return router;
}
const router=Router();
router.use((req,res,next)=>{res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'});const host=normaliseTenantHost(req.get('host')??'');const origin=req.get('origin');const site=req.get('sec-fetch-site');if(!host||(origin&&origin!==`https://${host}`)||(site&&!['same-origin','none'].includes(site))){res.status(403).json({error:'Open the invitation on its original website.'});return;}next();});
router.get('/preview',async(req,res)=>{try{const row=await readAccountInvitation(req.get('x-account-invitation-token')??'',req.get('host')??'');const [local,domain]=row.email.split('@');res.json({dealerName:row.dealer_name,role:row.role,emailHint:`${local.slice(0,1)}•••@${domain}`,expiresAt:row.expires_at,accepted:Boolean(row.accepted_at)});}catch(error){failure(req,res,error);}});
router.post('/accept',async(req,res)=>{try{const userId=getAuth(req).userId;if(!userId){res.status(401).json({error:'Sign in or create your account before accepting.'});return;}await readAccountInvitation(req.get('x-account-invitation-token')??'',req.get('host')??'');const profile=await clerkClient.users.getUser(userId);const emails=profile.emailAddresses.filter(email=>email.verification?.status==='verified').map(email=>email.emailAddress.toLowerCase());res.json(await acceptAccountInvitation(req.get('x-account-invitation-token')??'',req.get('host')??'',{id:userId,emails,name:[profile.firstName,profile.lastName].filter(Boolean).join(' ')||profile.username||'Staff member'}));}catch(error){failure(req,res,error);}});
export default router;
