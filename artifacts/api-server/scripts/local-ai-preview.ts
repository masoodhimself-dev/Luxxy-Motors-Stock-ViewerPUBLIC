// Local-only development host. Never imports the application database or message services.
import express from 'express';
import cookieParser from 'cookie-parser';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { AiAssistanceStore } from '../src/lib/ai-assistance-store';
import { aiAssistanceRouter } from '../src/lib/ai-assistance-router';
import { runWithTenant } from '../src/lib/tenant-context';
import { generateAi } from '../src/lib/ai-assistance';
import { randomUUID } from 'node:crypto';
import { publicAiCar, publicAiDealer, publicAiMot } from '../src/lib/ai-public-facts';
const repo=process.cwd()+'/../..';
const config=JSON.parse(readFileSync(repo+'/.private/ai-assistance.json','utf8'));
process.env.OPENAI_API_KEY=config.OPENAI_API_KEY;process.env.AI_ASSISTANCE_ENABLED='true';
const settings=JSON.parse(readFileSync('/tmp/multi-panel-settings.json','utf8'));
const stock=JSON.parse(readFileSync('/tmp/multi-panel-stock.json','utf8')).cars;
const mot=JSON.parse(readFileSync('/tmp/multi-honda-mot.json','utf8'));
const db=new PGlite(repo+'/.private/ai-preview-db');
await db.waitReady;
if(!(await db.query("SELECT to_regclass('public.ai_browser_sessions') AS table_name")).rows[0]?.table_name)await db.exec(readFileSync(repo+'/lib/db/drizzle/0077_ai_assistance.sql','utf8'));
let tail=Promise.resolve();
const store=new AiAssistanceStore({query:(q,p)=>db.query(q,p),connect:async()=>{let unlock!:()=>void;const next=new Promise<void>(resolve=>unlock=resolve);const previous=tail;tail=next;await previous;return {query:(q,p)=>db.query(q,p),release:()=>unlock()};}});
await store.cleanup();
if(process.argv.includes('--proof-only')){
 const car=publicAiCar(stock.find((c:any)=>c.id==='fd1483f7-ac1c-4232-8b8d-03f55bb2c1e9'));
 const facts={dealer:publicAiDealer(settings),cars:[car]};
 for(const [task,question] of [['explain','What are heated leather seats?'],['reply','I am interested in this Honda. Is it automatic and can I arrange a viewing on Saturday?']] as const){
  const admitted=await store.reserve({dealer:'local-multi-choice-preview',session:'extra-proof-'+randomUUID(),ip:'extra-local-proof',requestId:randomUUID(),hash:randomUUID(),cacheKey:null,staff:task==='reply'});
  try{const generated=await generateAi(task,question,facts);await store.complete(admitted.id,'local-multi-choice-preview',generated.result,generated.cost,null);console.log(JSON.stringify({task,passed:true,answer:generated.result.answer,costUsd:generated.cost/1000000}));}catch{await store.fail(admitted.id,'local-multi-choice-preview');console.log(JSON.stringify({task,passed:false}));process.exitCode=1;}
 }
 const costs=(await db.query<any>('SELECT sum(cost_micro_usd)::int AS reserved_or_spent FROM ai_assistance_requests')).rows[0];console.log('Local ledger reserved/spent USD:',costs.reserved_or_spent/1000000);await db.close();process.exit(process.exitCode??0);
}
const app=express();app.disable('x-powered-by');app.use(express.json({limit:'8kb'}));app.use(cookieParser());
app.use((req,res,next)=>runWithTenant({dealerId:'local-multi-choice-preview',canonicalOrigin:'http://192.168.1.24:4286',platform:'cazoo',retailerId:'75497',sourceUrl:'https://www.cazoo.co.uk/',kind:'website'},next));
app.use('/api',aiAssistanceRouter({store,getSettings:async()=>settings,getCars:async()=>stock,getCar:async id=>stock.find((c:any)=>c.id===id)??null,getEnquiry:async()=>null,staffAccess:[(_req,res)=>{res.status(403).json({error:'Staff AI is tested with isolated fixtures; this customer preview has no staff access.'});}],motFact:async car=>publicAiMot(mot.history,car.registration??'')}));
app.listen(4291,'127.0.0.1',()=>console.log('Local AI preview ready on loopback port 4291. No keys or customer messages logged.'));
