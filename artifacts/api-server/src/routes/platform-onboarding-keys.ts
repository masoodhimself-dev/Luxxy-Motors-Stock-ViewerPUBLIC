import { Router } from 'express';
import { getAuth } from '@clerk/express';
import { randomBytes } from 'node:crypto';
import { db,demoOnboardingKeysTable } from '@workspace/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod/v4';
import { importSecretDigest } from '../middlewares/tenant';
const router=Router();
// Mounted after the existing platform host/Clerk administrator/origin guard.
router.get('/onboarding-keys',async(_req,res)=>{res.json({keys:await db.select({id:demoOnboardingKeysTable.id,label:demoOnboardingKeysTable.label,maxDemos:demoOnboardingKeysTable.maxDemos,maxPerDay:demoOnboardingKeysTable.maxPerDay,expiresAt:demoOnboardingKeysTable.expiresAt,revokedAt:demoOnboardingKeysTable.revokedAt,createdAt:demoOnboardingKeysTable.createdAt}).from(demoOnboardingKeysTable)});});
router.post('/onboarding-keys',async(req,res)=>{
 const parsed=z.object({label:z.string().trim().min(1).max(80),days:z.number().int().min(1).max(90).default(30),maxDemos:z.number().int().min(1).max(100).default(20),maxPerDay:z.number().int().min(1).max(20).default(5)}).strict().safeParse(req.body);
 if(!parsed.success){res.status(400).json({error:'Choose a label, 1–90 days and bounded demo quotas.'});return;}
 const d=parsed.data,secret=randomBytes(32).toString('base64url');
 const [key]=await db.insert(demoOnboardingKeysTable).values({secretHash:importSecretDigest(secret),label:d.label,ownerAuthUserId:getAuth(req).userId!,expiresAt:new Date(Date.now()+d.days*86400000),maxDemos:d.maxDemos,maxPerDay:d.maxPerDay}).returning({id:demoOnboardingKeysTable.id,expiresAt:demoOnboardingKeysTable.expiresAt});
 res.status(201).json({...key,secret,header:'x-demo-onboarding-secret',baseUrl:`https://${process.env.STOCK_IMPORT_API_HOST}`,scope:'demo:create-and-read-own',notice:'Shown once. Enter directly in Master Bot’s secure secret storage. Never paste into chat or logs.'});
});
router.delete('/onboarding-keys/:id',async(req,res)=>{if(!z.uuid().safeParse(req.params.id).success){res.status(400).json({error:'Invalid credential ID.'});return;}await db.update(demoOnboardingKeysTable).set({revokedAt:new Date()}).where(eq(demoOnboardingKeysTable.id,req.params.id));res.json({revoked:true,notice:'Existing dealer stock credentials are unchanged; revoke those separately if necessary.'});});
export default router;
