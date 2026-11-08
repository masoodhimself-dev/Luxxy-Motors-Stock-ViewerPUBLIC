import { useEffect, useId, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { NativeSelect } from './ui/native-select';
import { ArrowRight, CheckCircle2, Circle, Demo as DemoIcon, ExternalLink, RefreshCw, StockImport } from '@/components/icons';
import './platform-demo-conversion.css';
const api=<T,>(path:string,body?:unknown)=>customFetch<T>('/api/platform'+path,{method:body?'POST':'GET',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
type Provision={domain:string;emailDomain:string;recipients:string[];configured:boolean;emailReady:boolean;note:string};
type Demo={demo:boolean;privatePreview?:boolean;converted?:boolean;recipient?:string;expiresAt?:string;revision?:number;sender?:string;emailReady?:boolean};
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
      <p>Recognised fictional customers, practice enquiries, appointments and sample sales documents are permanently removed. Any legacy demo snapshot is discarded.</p>
      <p>Genuine stock, photos, approved branding and business details stay. The internal dealer ID and its stock credential stay connected. The old demo subdomain is disabled, demo expiry ends and email is no longer redirected to the test inbox.</p>
      <p>Stop practice activity and pause the dealer’s Grok worker before converting. This action does not pause or create a Grok schedule. Test the real website and email settings before resuming live stock updates.</p>
      <label className="platform-conversion-ack"><input type="checkbox" checked={acknowledge} disabled={busy||!readiness.ready} onChange={e=>setAcknowledge(e.target.checked)}/><span>I have stopped practice activity, paused this dealer’s Grok worker and checked the live settings. I understand that recognised legacy fictional activity will be permanently removed, the old demo subdomain will stop working and emails can go to real customers.</span></label>
      <label className="platform-field"><span>Type {dealerId} to convert to live</span><Input autoComplete="off" spellCheck={false} disabled={busy||!readiness.ready} value={confirm} onChange={e=>setConfirm(e.target.value)}/></label>
      <Button disabled={busy||loading||!readiness.ready||!readiness.domainOrigin||!acknowledge||confirm!==dealerId} onClick={()=>void convert()}>{busy?'Converting dealership…':'Convert to live dealership'}</Button>
     </div>
    </>}
   </>}
  </div>}
 </section>;
}
export function PlatformDemos({ dealerId, onCreated, onOpenStock }: { dealerId?: string; onCreated: (id: string) => void; onOpenStock?: () => void }) {
 const fieldId = useId();
 const [provision,setProvision]=useState<Provision|null>(null),[demo,setDemo]=useState<Demo|null>(null);
 const [recipient,setRecipient]=useState('');
 const [privatePreview, setPrivatePreview] = useState(true);
 const [provisionFailed, setProvisionFailed] = useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[confirmation,setConfirmation]=useState('');
 const [form,setForm]=useState({name:'',slug:'',platform:'autotrader',retailerId:'',sourceUrl:'',recipient:'',days:14,logoData:''});
 async function load() {
  setProvisionFailed(false);
  if (dealerId) {
   try {
    const record = await api<Demo>(`/dealers/${encodeURIComponent(dealerId)}/demo`);
    setDemo(record); setRecipient(record.recipient ?? '');
    if (record.privatePreview || !record.demo) return;
   } catch { setError('Could not load demo setup. Refresh to retry.'); return; }
  }
  try {
   const configuration = await api<Provision>('/demo-config');
   setProvision(configuration);
   if (!dealerId) setForm(current => ({ ...current, recipient: current.recipient || configuration.recipients?.[0] || '' }));
  } catch { setProvisionFailed(true); }
 }
 useEffect(()=>{setDemo(null);setError('');setNotice('');setConfirmation('');void load();},[dealerId]);
 async function logo(file?:File){if(!file)return;setError('');setBusy(true);try{if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5_000_000)throw Error('Choose a PNG, JPEG or WebP smaller than 5 MB.');const bitmap=await createImageBitmap(file);try{const canvas=document.createElement('canvas'),scale=Math.min(1,600/Math.max(bitmap.width,bitmap.height));canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext('2d')!.drawImage(bitmap,0,0,canvas.width,canvas.height);const data=canvas.toDataURL('image/png');if(data.length>330000)throw Error('Logo is too detailed. Choose a simpler image smaller than 250 KB.');setForm(f=>({...f,logoData:data}));}finally{bitmap.close();}}catch(e){setError(e instanceof Error?e.message:'Could not prepare logo.');}finally{setBusy(false);}}
 async function create() {
  setBusy(true); setError('');
  const { recipient, logoData, ...fields } = form;
  try {
   const result = await api<{ dealerId: string }>('/demos', {
    ...fields,
    ...(logoData ? { logoData } : {}),
    ...(privatePreview ? { privatePreview: true } : { recipient }),
   });
   onCreated(result.dealerId);
  } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create demo.'); }
  finally { setBusy(false); }
 }
 async function action(value:string){if(!dealerId||!demo)return;setBusy(true);setError('');setNotice('');try{await api(`/dealers/${encodeURIComponent(dealerId)}/demo`,{action:value,expectedRevision:demo.revision,confirm:confirmation,...(value==='extend'?{days:14}:value==='recipient'?{recipient}:{})});await load();setConfirmation('');setNotice(value==='recipient'?'Demo email recipient updated.':'Demo extended for 14 days.');}catch(e){setError(e instanceof Error?e.message:'Could not change demo.');}finally{setBusy(false);}}
 const canCreate = form.name.trim() && /^[a-z0-9][a-z0-9-]{1,40}$/.test(form.slug) && form.retailerId.trim() && form.sourceUrl.trim() && (privatePreview || (provision?.configured && form.recipient));
 return <section className="platform-demo" aria-label={dealerId ? 'Demo controls' : 'Create demo dealership'}>
  <header>
   <h2>{dealerId ? (demo?.converted ? 'Live dealership' : demo?.demo === false ? 'Dealership status' : 'Demo controls') : 'Create a dealer demo'}</h2>
   <p>{dealerId && demo?.demo === false ? 'Website and integration settings are managed in the dealer portal.' : dealerId ? 'Manage access and expiry for this dealership’s demonstration.' : 'Set up the dealership’s branding, then import its stock and open the website preview.'}</p>
  </header>
  {error && <p role="alert" className="platform-alert">{error}</p>}
  {notice && <p role="status" className="platform-notice">{notice}</p>}
  {dealerId ? !demo ? <p>Loading demo controls…</p> : !demo.demo ? <p>{demo.converted ? 'This demonstration is now a live dealership. Demo expiry no longer applies.' : 'This is a regular dealership.'}</p> : <>
   <dl className="platform-facts">
    <div><dt>Access</dt><dd>{demo.privatePreview ? 'Private preview' : 'Shareable demo'}</dd></div>
    {!demo.privatePreview && <>
     <div><dt>Demo email sender</dt><dd>{demo.sender ?? 'Demo email domain not configured'}</dd></div>
     <div><dt>Only recipient</dt><dd>{demo.recipient}</dd></div>
     <div><dt>Email delivery</dt><dd>{demo.emailReady ? 'Verified platform sender configured' : 'Disabled. Platform email setup needed.'}</dd></div>
    </>}
    <div><dt>Expires</dt><dd>{new Date(demo.expiresAt!).toLocaleString('en-GB')}</dd></div>
   </dl>
   <div className="platform-controls platform-demo-stock-actions">
    {onOpenStock && <Button variant="outline" disabled={busy} onClick={onOpenStock}><StockImport size={16} aria-hidden="true"/>Upload stock JSON</Button>}
    {demo.expiresAt && Date.parse(demo.expiresAt) > Date.now() && <Button asChild variant="outline"><a href={`/platform/preview/${encodeURIComponent(dealerId)}`} target="_blank" rel="noopener noreferrer">Open private preview <ExternalLink size={15} aria-hidden="true"/></a></Button>}
   </div>
   <DemoConversion key={`${dealerId}:${demo.revision}`} dealerId={dealerId} busy={busy} onBusyChange={setBusy} onConverted={result => { setDemo({ demo: false, converted: true }); setNotice(result.notice || 'Dealership converted to live. Fictional activity has been removed.'); onCreated(result.dealerId); }}/>
   <label className="platform-field"><span>Type {dealerId} to confirm changes</span><Input autoComplete="off" value={confirmation} onChange={e => setConfirmation(e.target.value)}/></label>
   {!demo.privatePreview && <>
    <label className="platform-field"><span>Approved demo email inbox</span><NativeSelect aria-label="Approved demo email inbox" value={recipient} onChange={e => setRecipient(e.target.value)}><option value="">Choose an approved recipient</option>{provision?.recipients?.map(r => <option key={r}>{r}</option>)}</NativeSelect><small>All demo email is redirected here.</small></label>
    {provisionFailed && <p className="platform-help">The approved inboxes could not be loaded. Refresh to try again.</p>}
    <Button variant="outline" disabled={busy || confirmation !== dealerId || !recipient || recipient === demo.recipient} onClick={() => void action('recipient')}>Update demo inbox</Button>
   </>}
   <div className="platform-demo-actions"><article><h3>Extend demo</h3><p>Keep this demonstration available for another 14 days.</p><Button variant="outline" disabled={busy || confirmation !== dealerId} onClick={() => void action('extend')}>Extend for 14 days</Button></article></div>
  </> : <form onSubmit={event => { event.preventDefault(); if (canCreate && !busy) void create(); }}>
   <fieldset className="platform-demo-access" disabled={busy}>
    <legend>Demo access</legend>
    <div className="platform-demo-access-options">
     <label><input type="radio" name="platform-demo-access" checked={privatePreview} onChange={() => setPrivatePreview(true)}/><span><strong>Private preview</strong><small>Only signed-in platform admins.</small></span></label>
     <label><input type="radio" name="platform-demo-access" checked={!privatePreview} onChange={() => setPrivatePreview(false)}/><span><strong>Shareable demo</strong><small>Uses the configured demo domain.</small></span></label>
    </div>
   </fieldset>
   {!privatePreview && <>
    {provisionFailed ? <p className="platform-help">Shareable demo setup could not be loaded. Refresh to try again.</p> : !provision ? <p role="status">Loading shareable demo setup…</p> : !provision.configured && <div className="platform-notice"><strong>One-time platform setup required</strong><p>Connect the demo domain, HTTPS and staff sign-in before creating a shareable demo.</p></div>}
    {provision && !provision.emailReady && <p className="platform-help">Demo email sends remain disabled until the platform demo email sender is configured.</p>}
   </>}
   <fieldset className="platform-demo-fields" disabled={busy}>
    <label className="platform-field"><span>Demo dealership name</span><Input required maxLength={100} value={form.name} onChange={e => setForm({ ...form, name: e.target.value, slug: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 41) })}/></label>
    <label className="platform-field"><span id={`${fieldId}-reference`}>{privatePreview ? 'Demo reference' : 'Demo subdomain'}</span><Input aria-labelledby={`${fieldId}-reference`} aria-describedby={`${fieldId}-reference-help`} required maxLength={41} value={form.slug} onChange={e => setForm({ ...form, slug: e.target.value })}/><small id={`${fieldId}-reference-help`}>{privatePreview ? 'Use at least two letters, numbers or hyphens.' : `${form.slug || 'dealer'}.${provision?.domain || 'your configured demo domain'}`}</small></label>
    <label className="platform-field"><span id={`${fieldId}-logo`}>Dealership logo (optional)</span><Input aria-labelledby={`${fieldId}-logo`} aria-describedby={`${fieldId}-logo-help`} type="file" accept="image/png,image/jpeg,image/webp" onChange={e => void logo(e.target.files?.[0])}/><small id={`${fieldId}-logo-help`}>PNG, JPEG or WebP.</small>{form.logoData && <img src={form.logoData} alt="Demo logo preview" style={{ maxHeight: 64, maxWidth: 180, objectFit: 'contain' }}/>}</label>
    <label className="platform-field"><span>Demo marketplace</span><NativeSelect value={form.platform} onChange={e => setForm({ ...form, platform: e.target.value })}><option value="autotrader">Auto Trader</option><option value="cazoo">Cazoo</option></NativeSelect></label>
    <label className="platform-field"><span id={`${fieldId}-retailer`}>Demo retailer reference</span><Input aria-labelledby={`${fieldId}-retailer`} aria-describedby={`${fieldId}-retailer-help`} required maxLength={128} value={form.retailerId} onChange={e => setForm({ ...form, retailerId: e.target.value })}/><small id={`${fieldId}-retailer-help`}>Use the retailer ID from the stock export.</small></label>
    <label className="platform-field"><span>Authorised demo stock source URL</span><Input required type="url" value={form.sourceUrl} onChange={e => setForm({ ...form, sourceUrl: e.target.value })}/></label>
    {!privatePreview && <label className="platform-field"><span>Approved test email recipient</span><NativeSelect required value={form.recipient} onChange={e => setForm({ ...form, recipient: e.target.value })}><option value="">Choose an approved recipient</option>{provision?.recipients?.map(r => <option key={r}>{r}</option>)}</NativeSelect></label>}
    <label className="platform-field"><span>Expires after</span><NativeSelect value={form.days} onChange={e => setForm({ ...form, days: Number(e.target.value) })}>{[7, 14, 30, 60, 90].map(days => <option key={days} value={days}>{days} days</option>)}</NativeSelect></label>
   </fieldset>
   <p className="platform-help">Import an existing stock JSON file after creating the demo. Grok collection and scheduling remain separate.</p>
   <Button type="submit" disabled={busy || !canCreate}><DemoIcon size={16} aria-hidden="true"/>{busy ? 'Preparing demo…' : 'Create demo dealership'}</Button>
  </form>}
 </section>;
}
