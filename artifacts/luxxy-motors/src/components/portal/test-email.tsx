import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function TestEmailSettings({canEdit}:{canEdit:boolean}) {
  const client = useQueryClient();
  const key = ['test-email-settings',window.location.host];
  const settings = useQuery({queryKey:key,queryFn:({signal})=>customFetch<{email:string|null}>('/api/test-email-settings',{signal}),retry:false});
  const [email,setEmail]=useState('');
  const save = useMutation({mutationFn:()=>customFetch<{email:string}>('/api/test-email-settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})}),onSuccess:result=>{client.setQueryData(key,result);setEmail('');}});
  return <details className="mb-4 rounded border bg-card p-3"><summary className="cursor-pointer text-sm font-semibold">Test email destination{settings.data?.email ? `: ${settings.data.email}` : ''}</summary>
    <p className="mt-2 text-sm text-muted-foreground">Test messages go only to this dealership’s designated test address. This setting is shared by the dealership.</p>
    {settings.isError && <p role="alert">Could not load the test email destination.</p>}
    {canEdit && <form className="mt-3 flex flex-wrap gap-2" onSubmit={e=>{e.preventDefault();save.mutate();}}><label className="sr-only" htmlFor="test-email-destination">Test email address</label><input id="test-email-destination" type="email" required value={email} onChange={e=>setEmail(e.target.value)} placeholder={settings.data?.email || 'Enter test email address'} className="min-w-0 flex-1 rounded border bg-background p-2"/><Button type="submit" disabled={save.isPending}>Save destination</Button></form>}
    {!canEdit && !settings.data?.email && <p>Ask an owner to set the test email destination.</p>}{save.isError && <p role="alert">{save.error instanceof Error ? save.error.message : 'Could not save the destination.'}</p>}
  </details>;
}

type EmailPreview = {to:string;from?:string;subject:string;text:string;html?:string;previewId:string;photos?:string[]};
export function TestEmailButton({sessionId, enquiryId, templateId, message, saleId, documentId, teamMemberId, photos, onSent, label='Preview test email'}:{sessionId:string;enquiryId?:string;templateId?:string;message?:string;saleId?:string;documentId?:string;teamMemberId?:string;photos?:string[];onSent?:()=>void;label?:string}) {
  const [open,setOpen]=useState(false);
  const [preview,setPreview]=useState<EmailPreview|null>(null);
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(false);
  const [sent,setSent]=useState(false);
  async function prepare() {
    setError(''); setPreview(null); setSent(false); setLoading(true); setOpen(true);
    try {
      setPreview(await customFetch<EmailPreview>(`/api/sales-test/sessions/${encodeURIComponent(sessionId)}/email-preview`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(teamMemberId ? {teamMemberId} : enquiryId ? {enquiryId,templateId,...(documentId ? {documentId} : {}),...(message ? {message} : {}),...(photos?.length ? {photos} : {})} : {saleId,...(documentId ? {documentId} : {templateId})})}));
    } catch(cause) {setError(cause instanceof Error?cause.message:'Could not prepare the email.');} finally {setLoading(false);}
  }
  async function send() {
    if(!preview || loading || sent) return;
    setLoading(true);setError('');
    try { await customFetch(`/api/sales-test/sessions/${encodeURIComponent(sessionId)}/email-send`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({previewId:preview.previewId,confirmSend:true})}); setSent(true);onSent?.(); }
    catch(cause){setError(cause instanceof Error?cause.message:'Could not send the test email.');} finally{setLoading(false);}
  }
  return <><Button type="button" variant="outline" onClick={()=>void prepare()}>{label}</Button><Dialog open={open} onOpenChange={setOpen}><DialogContent>
    <DialogHeader><DialogTitle>Review test email</DialogTitle><DialogDescription>Check the message before sending it to the dealership’s test address.</DialogDescription></DialogHeader>
    {loading && !preview && <p role="status">Preparing…</p>}{preview && <div className="space-y-2 text-sm"><p><strong>To:</strong> {preview.to}</p>{preview.from && <p><strong>From:</strong> {preview.from}</p>}<p><strong>Subject:</strong> {preview.subject}</p><p className="max-h-44 overflow-auto whitespace-pre-wrap rounded border p-3">{preview.text}</p>{preview.html && <details><summary className="cursor-pointer">See email layout</summary><iframe title="Test email layout" sandbox="" className="mt-2 h-72 w-full rounded border bg-white" srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">${preview.html}`}/></details>}{documentId && <p>The test invoice PDF will be attached.</p>}{Boolean(preview.photos?.length) && <p>Photos attached: {preview.photos!.join(', ')}</p>}</div>}
    {error && <p role="alert">{error}</p>}{sent && <p role="status">The email was accepted for delivery to the test address.</p>}
    <DialogFooter><Button type="button" variant="outline" onClick={()=>setOpen(false)}>Close</Button><Button type="button" disabled={!preview || loading || sent} onClick={()=>void send()}>{loading?'Sending…':'Send test email'}</Button></DialogFooter>
  </DialogContent></Dialog></>;
}
