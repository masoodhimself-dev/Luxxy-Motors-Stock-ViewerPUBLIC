import { useEffect, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { NativeSelect } from './ui/native-select';
import { ArrowRight, CheckCircle2, Circle, Demo as DemoIcon, RefreshCw } from '@/components/icons';
import './platform-demo-conversion.css';
const api=<T,>(path:string,body?:unknown)=>customFetch<T>('/api/platform'+path,{method:body?'POST':'GET',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
type Provision={domain:string;emailDomain:string;recipients:string[];configured:boolean;emailReady:boolean;note:string};
type Demo={demo:boolean;converted?:boolean;recipient?:string;expiresAt?:string;revision?:number;baselineSaved?:boolean;lastResetAt?:string;sender?:string;emailReady?:boolean};
type ConversionReadiness = {
 demo: boolean;
 converted: boolean;
 revision: number;
 checks: {id: string; label: string; ready: boolean; detail: string}[];
 ready: boolean;
 domainOrigin: string | null;
 eligibleOrigins: string[];
 blockedReasons: string[];
};
type ConversionResult = {status: 'converted' | 'replayed'; dealerId: string; origin: string; notice: string};

function DemoConversion({dealerId,busy,onBusyChange,onConverted}:{
 dealerId:string;busy:boolean;onBusyChange:(busy:boolean)=>void;onConverted:(result:ConversionResult)=>void;
}) {
 const [open,setOpen]=useState(false);
 const [readiness,setReadiness]=useState<ConversionReadiness|null>(null);
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState('');
 const [confirm,setConfirm]=useState('');
 const [acknowledge,setAcknowledge]=useState(false);
 const path=`/dealers/${encodeURIComponent(dealerId)}/conversion`;

 async function refresh(origin?:string) {
  setLoading(true);setError('');setConfirm('');setAcknowledge(false);
  try {setReadiness(await api<ConversionReadiness>(origin?`${path}?origin=${encodeURIComponent(origin)}`:path));}
  catch {setReadiness(null);setError('Could not check conversion readiness. Refresh checks to retry.');}
  finally {setLoading(false);}
 }
 async function convert() {
  if(!readiness?.ready||!readiness.domainOrigin||readiness.converted||busy||confirm!==dealerId||!acknowledge)return;
  onBusyChange(true);setError('');
  try {
   const result=await api<ConversionResult>(path,{expectedRevision:readiness.revision,domainOrigin:readiness.domainOrigin,confirm,acknowledge:true});
   onConverted(result);
  } catch(e) {
   setError(e instanceof Error?e.message:'Could not convert this demo. Refresh checks before trying again.');
   setReadiness(null);setAcknowledge(false);setConfirm('');
  } finally {onBusyChange(false);}
 }

 return <section className="platform-conversion" aria-label="Convert demo to live dealership">
  <div className="platform-conversion-heading">
   <div><span className="platform-eyebrow">Ready for their own website?</span><h3>Convert to live dealership</h3><p>Keep the stock, branding and existing stock connection. Check the real domain, staff and settings before making this dealership live.</p></div>
   <Button variant="outline" disabled={busy} aria-expanded={open} aria-controls="demo-conversion-review" onClick={()=>{setOpen(!open);if(!open)void refresh();}}>Review live conversion<ArrowRight size={16}/></Button>
  </div>
  {open&&<div id="demo-conversion-review" className="platform-conversion-review">
   <div className="platform-conversion-toolbar"><strong>Launch checks</strong><Button variant="ghost" disabled={busy||loading} onClick={()=>void refresh(readiness?.domainOrigin??undefined)}><RefreshCw size={15}/>Refresh checks</Button></div>
   {loading&&<p role="status">Checking this dealership…</p>}
   {error&&<p role="alert" className="platform-alert">{error}</p>}
   {!loading&&readiness&&<>
    {readiness.eligibleOrigins?.length>0?<label className="platform-field platform-conversion-origin"><span>Live website domain</span><NativeSelect aria-label="Live website domain" disabled={busy} value={readiness.domainOrigin??''} onChange={e=>void refresh(e.target.value)}>{!readiness.domainOrigin&&<option value="">Choose a verified domain</option>}{readiness.eligibleOrigins.map(origin=><option key={origin} value={origin}>{origin}</option>)}</NativeSelect><small>Only verified domains outside the demo domain are available. DNS ownership alone does not confirm HTTPS, Clerk sign-in or email delivery.</small></label>:<p className="platform-conversion-domain">Live website <strong>No verified live domain yet</strong></p>}
    <ul className="platform-conversion-checks" aria-label="Conversion readiness checks">{readiness.checks.map(check=><li key={check.id} className={check.ready?'is-ready':'needs-attention'}>{check.ready?<CheckCircle2 size={19} aria-label="Ready"/>:<Circle size={19} aria-label="Needs attention"/>}<div><strong>{check.label}</strong><p>{check.detail}</p></div></li>)}</ul>
    {readiness.converted?<p role="status" className="platform-notice">This dealership has already been converted. Demo actions are no longer available.</p>:<>
     {!readiness.ready&&<div className="platform-conversion-blocked" role="status"><strong>Finish these checks before converting</strong>{readiness.blockedReasons.length>0&&<ul>{readiness.blockedReasons.map((reason,i)=><li key={i}>{reason}</li>)}</ul>}<p>Use the dealership’s Domains, Staff and Settings sections, then refresh these checks.</p></div>}
     <div className="platform-conversion-confirm">
      <h4>What happens when you convert</h4>
      <p>Recognised fictional customers, practice enquiries, appointments and sample sales documents are permanently removed. The saved demo starting point and reset option are removed too.</p>
      <p>Genuine stock, photos, approved branding and business details stay. The internal dealer ID and its stock credential stay connected. The old demo subdomain is disabled, demo expiry ends and email is no longer redirected to the test inbox.</p>
      <p>Stop practice activity and pause the dealer’s Grok worker before converting. This action does not pause or create a Grok schedule. Test the real website and email settings before resuming live stock updates.</p>
      <label className="platform-conversion-ack"><input type="checkbox" checked={acknowledge} disabled={busy||!readiness.ready} onChange={e=>setAcknowledge(e.target.checked)}/><span>I have stopped practice activity, paused this dealer’s Grok worker and checked the live settings. I understand that recognised fictional activity and the saved demo starting point will be permanently removed, the old demo subdomain will stop working and emails can go to real customers.</span></label>
      <label className="platform-field"><span>Type {dealerId} to convert to live</span><Input autoComplete="off" spellCheck={false} disabled={busy||!readiness.ready} value={confirm} onChange={e=>setConfirm(e.target.value)}/></label>
      <Button disabled={busy||loading||!readiness.ready||!readiness.domainOrigin||!acknowledge||confirm!==dealerId} onClick={()=>void convert()}>{busy?'Converting dealership…':'Convert to live dealership'}</Button>
     </div>
    </>}
   </>}
  </div>}
 </section>;
}
export function PlatformDemos({dealerId,onCreated}:{dealerId?:string;onCreated:(id:string)=>void}) {
 const [provision,setProvision]=useState<Provision|null>(null),[demo,setDemo]=useState<Demo|null>(null);
 const [recipient,setRecipient]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[confirmation,setConfirmation]=useState('');
 const [form,setForm]=useState({name:'',slug:'',platform:'autotrader',retailerId:'',sourceUrl:'',recipient:'',days:14,logoData:''});
 async function load(){try{if(dealerId){const d=await api<Demo>(`/dealers/${encodeURIComponent(dealerId)}/demo`);setDemo(d);setRecipient(d.recipient??'');setProvision(await api<Provision>('/demo-config'));}else {const p=await api<Provision>('/demo-config');setProvision(p);setForm(f=>({...f,recipient:p.recipients?.[0]??''}));}}catch{setError('Could not load demo setup. Refresh to retry.');}}
 useEffect(()=>{setDemo(null);setError('');setNotice('');setConfirmation('');void load();},[dealerId]);
 async function logo(file?:File){if(!file)return;setError('');setBusy(true);try{if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5_000_000)throw Error('Choose a PNG, JPEG or WebP smaller than 5 MB.');const bitmap=await createImageBitmap(file);try{const canvas=document.createElement('canvas'),scale=Math.min(1,600/Math.max(bitmap.width,bitmap.height));canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext('2d')!.drawImage(bitmap,0,0,canvas.width,canvas.height);const data=canvas.toDataURL('image/png');if(data.length>330000)throw Error('Logo is too detailed. Choose a simpler image smaller than 250 KB.');setForm(f=>({...f,logoData:data}));}finally{bitmap.close();}}catch(e){setError(e instanceof Error?e.message:'Could not prepare logo.');}finally{setBusy(false);}}
 async function create(){setBusy(true);setError('');try{const result=await api<{dealerId:string}>('/demos',form);onCreated(result.dealerId);}catch(e){setError(e instanceof Error?e.message:'Could not create demo.');}finally{setBusy(false);}}
 async function action(value:string){if(!dealerId||!demo)return;setBusy(true);setError('');setNotice('');try{await api(`/dealers/${encodeURIComponent(dealerId)}/demo`,{action:value,expectedRevision:demo.revision,confirm:confirmation,...(value==='extend'?{days:14}:value==='recipient'?{recipient}:{})});await load();setConfirmation('');setNotice(value==='recipient'?'Demo email recipient updated.':value==='baseline'?'Starting point saved. Fictional activity is ready.':value==='extend'?'Demo extended for 14 days.':'Demo reset. Fictional activity restored.');}catch(e){setError(e instanceof Error?e.message:'Could not change demo.');}finally{setBusy(false);}}
 return <section className="platform-demo" aria-label={dealerId?'Demo controls':'Create demo dealership'}>
  <header><span className="platform-eyebrow">Demonstrations</span><h2>{dealerId?(demo?.converted?'Live dealership':demo?.demo===false?'Dealership status':'Demo controls'):'Their name. Their stock. A ready-to-show demo.'}</h2><p>{dealerId&&demo?.demo===false?'Website and integration settings are managed in the dealer portal. Demo reset controls are unavailable.':'Separate from paying dealers. Fictional customers and sample invoices. Email goes only to your approved test address; real payments stay off.'}</p></header>
  {error&&<p role="alert" className="platform-alert">{error}</p>}{notice&&<p role="status" className="platform-notice">{notice}</p>}
  {dealerId ? !demo?<p>Loading demo controls…</p>:!demo.demo?<p>{demo.converted?'This demonstration is now a live dealership. Demo resets and expiry no longer apply.':'This is a regular dealership. Demo reset is unavailable.'}</p>:<>
   <dl className="platform-facts"><div><dt>Demo email sender</dt><dd>{demo.sender??'Demo email domain not configured'}</dd></div><div><dt>Only recipient</dt><dd>{demo.recipient}</dd></div><div><dt>Email delivery</dt><dd>{demo.emailReady?'Verified platform sender configured':'Disabled — platform email configuration needed'}</dd></div><div><dt>Expires</dt><dd>{new Date(demo.expiresAt!).toLocaleString('en-GB')}</dd></div><div><dt>Starting point</dt><dd>{demo.baselineSaved?'Saved':'Import stock, then save below'}</dd></div></dl>
   <DemoConversion key={`${dealerId}:${demo.revision}`} dealerId={dealerId} busy={busy} onBusyChange={setBusy} onConverted={result=>{setDemo({demo:false,converted:true});setNotice(result.notice||'Dealership converted to live. Fictional activity has been removed.');onCreated(result.dealerId);}}/>
   <p className="platform-help">Pause the demo worker before restoring original stock. A later import can replace the restored stock. Credentials, staff access and import history are preserved. These actions never change a Grok schedule.</p>
   <label className="platform-field"><span>Type {dealerId} to confirm changes</span><Input autoComplete="off" value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></label>
   <label className="platform-field"><span>Approved demo email inbox</span><NativeSelect aria-label="Approved demo email inbox" value={recipient} onChange={e=>setRecipient(e.target.value)}><option value="">Choose an approved recipient</option>{provision?.recipients?.map(r=><option key={r}>{r}</option>)}</NativeSelect><small>All demo email is redirected here. Stock, practice activity and the saved starting point are preserved.</small></label><Button variant="outline" disabled={busy||confirmation!==dealerId||!recipient||recipient===demo.recipient} onClick={()=>void action('recipient')}>Update demo inbox</Button>
   <div className="platform-demo-actions">{[{action:'baseline',label:demo.baselineSaved?'Replace starting point':'Save starting point',description:'Use the current stock and branding as the original. Recreates fictional activity.'},{action:'activity',label:'Reset demo activity',description:'Clear practice enquiries, appointments and sales. Keep current stock and branding.'},{action:'original',label:'Restore original demo',description:'Restore saved stock, photos and branding, then recreate fictional activity.'},{action:'extend',label:'Extend for 14 days',description:'Reopen an expired demo or give the prospect more time.'}].map(item=><article key={item.action}><h3>{item.label}</h3><p>{item.description}</p><Button variant="outline" disabled={busy||confirmation!==dealerId||(['activity','original'].includes(item.action)&&!demo.baselineSaved)} onClick={()=>void action(item.action)}>{item.label}</Button></article>)}</div>
  </> : !provision?<p>Loading demo configuration…</p>:<>
   {!provision.configured&&<div className="platform-notice"><strong>One-time platform setup required</strong><p>Configure DEMO_BASE_DOMAIN, wildcard DNS/TLS and Clerk domain access, then enable DEMO_DOMAINS_READY. No demo domain has been invented or connected.</p></div>}
   {!provision.emailReady&&<p className="platform-help">Demo email sends remain disabled until DEMO_EMAIL_DOMAIN, a verified Resend sender and DEMO_RESEND_API_KEY are configured.</p>}
   <div className="platform-demo-fields">
   <label className="platform-field"><span>Demo dealership name</span><Input maxLength={100} value={form.name} onChange={e=>setForm({...form,name:e.target.value,slug:e.target.value.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,41)})}/></label>
   <label className="platform-field"><span>Demo subdomain</span><Input maxLength={41} value={form.slug} onChange={e=>setForm({...form,slug:e.target.value})}/><small>{form.slug||'dealer'}.{provision.domain||'your configured demo domain'}</small></label>
   <label className="platform-field"><span>Dealership logo</span><Input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>void logo(e.target.files?.[0])}/><small>Resized to 600 pixels; stored under 250 KB.</small>{form.logoData&&<img src={form.logoData} alt="Demo logo preview" style={{maxHeight:64,maxWidth:180,objectFit:'contain'}}/>}</label>
   <label className="platform-field"><span>Demo marketplace</span><NativeSelect value={form.platform} onChange={e=>setForm({...form,platform:e.target.value})}><option value="autotrader">Auto Trader</option><option value="cazoo">Cazoo</option></NativeSelect></label>
   <label className="platform-field"><span>Demo retailer reference</span><Input maxLength={128} value={form.retailerId} onChange={e=>setForm({...form,retailerId:e.target.value})}/></label>
   <label className="platform-field"><span>Authorised demo stock source URL</span><Input type="url" value={form.sourceUrl} onChange={e=>setForm({...form,sourceUrl:e.target.value})}/></label>
   <label className="platform-field"><span>Approved test email recipient</span><NativeSelect value={form.recipient} onChange={e=>setForm({...form,recipient:e.target.value})}><option value="">Choose an approved recipient</option>{provision.recipients?.map(r=><option key={r}>{r}</option>)}</NativeSelect><small>Set the operator allowlist with DEMO_EMAIL_RECIPIENTS. Customer addresses are never used for delivery.</small></label>
   <label className="platform-field"><span>Expires after</span><NativeSelect value={form.days} onChange={e=>setForm({...form,days:Number(e.target.value)})}>{[7,14,30,60,90].map(days=><option key={days} value={days}>{days} days</option>)}</NativeSelect></label>
   </div><p className="platform-help">Your account owns this demo. Stock import uses a new dedicated credential. Grok collection and scheduling remain separate; nothing is started automatically.</p><Button disabled={busy||!provision.configured||!form.name||!form.slug||!form.sourceUrl||!form.retailerId||!form.recipient} onClick={()=>void create()}><DemoIcon size={16} aria-hidden="true"/>{busy?'Preparing demo…':'Create demo dealership'}</Button>
  </>}
 </section>;
}
