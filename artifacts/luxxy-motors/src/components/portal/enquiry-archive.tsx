import { useEffect, useRef, useState } from 'react';
import { customFetch, type Enquiry } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel } from '@/components/ui/alert-dialog';
import { workspaceError } from './enquiry-workspace-tools';

async function changeArchive(entry:Enquiry, action:'archive'|'restore') {
  const result=await customFetch<Enquiry>(`/api/staff/enquiries/${encodeURIComponent(entry.id)}/${action}`, {
    method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({expectedRevision:entry.workspaceRevision??0}),
  });
  if(result.id!==entry.id || !Number.isSafeInteger(result.workspaceRevision) || Boolean(result.archivedAt)!==(action==='archive')) throw new Error('Unexpected archive response. Refresh the Inbox to check.');
  return result;
}

export function EnquiryArchiveDialog({entry,open,onOpenChange,onSaved,hasUnsavedDraft}: {
  entry:Enquiry;open:boolean;onOpenChange:(open:boolean)=>void;onSaved:(entry:Enquiry)=>void|Promise<void>;hasUnsavedDraft:()=>boolean;
}) {
  const [busy,setBusy]=useState(false), [error,setError]=useState('');
  const locked=useRef(false);
  useEffect(()=>{if(open)setError(hasUnsavedDraft()?'Save or discard your reply and private note before archiving.':'');},[open,entry.id]);
  async function archive() {
    if(locked.current)return;
    if(hasUnsavedDraft()){setError('Save or discard your reply and private note before archiving.');return;}
    locked.current=true;setBusy(true);setError('');
    try {const updated=await changeArchive(entry,'archive');await onSaved(updated);onOpenChange(false);}
    catch(cause){setError(workspaceError(cause));}
    finally{locked.current=false;setBusy(false);}
  }
  return <AlertDialog open={open} onOpenChange={value=>{if(!busy)onOpenChange(value);}}><AlertDialogContent onEscapeKeyDown={event=>{if(busy)event.preventDefault();}}>
    <AlertDialogHeader><AlertDialogTitle>Archive this enquiry?</AlertDialogTitle><AlertDialogDescription>
      It moves out of your active Inbox. You can restore it for 30 days before automatic deletion. Linked sales, payments and active bookings are protected and may be kept longer.
    </AlertDialogDescription></AlertDialogHeader>
    <div className="enquiry-archive-summary"><strong>{entry.customerName}</strong><span>{entry.vehicleTitle||'General enquiry'}</span></div>
    <p className="text-sm text-muted-foreground">Saved drafts stay with the enquiry. Automatic AI work and reminders pause while it is archived.</p>
    {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
    <AlertDialogFooter><AlertDialogCancel disabled={busy}>Keep in Inbox</AlertDialogCancel><Button disabled={busy||error.startsWith('Save or discard')} onClick={()=>void archive()}>{busy?'Archiving…':'Archive enquiry'}</Button></AlertDialogFooter>
  </AlertDialogContent></AlertDialog>;
}

export function RestoreEnquiryAction({entry,onSaved}:{entry:Enquiry;onSaved:(entry:Enquiry)=>void|Promise<void>}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const locked=useRef(false);
  return <div className="enquiry-restore-action"><Button size="sm" variant="outline" disabled={busy} onClick={async()=>{
    if(locked.current)return;locked.current=true;setBusy(true);setError('');
    try{await onSaved(await changeArchive(entry,'restore'));}catch(cause){setError(workspaceError(cause));}finally{locked.current=false;setBusy(false);}
  }}>{busy?'Restoring…':'Restore enquiry'}</Button>{error&&<p role="alert">{error}</p>}</div>;
}
