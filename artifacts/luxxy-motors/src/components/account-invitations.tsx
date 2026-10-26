import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Mail, RefreshCw, X } from '@/components/icons';
import './account-invitations.css';
export type AccountInvitation={id:string;email:string;role:'owner'|'salesperson'|'accounts';status:'pending'|'accepted'|'expired'|'cancelled';deliveryStatus:'pending'|'sending'|'sent'|'failed'|'unknown';expiresAt:string;acceptedAt?:string;managedBy?:'platform'|'staff'};
type Data={invitations:AccountInvitation[];email:{ready:boolean;message:string}};
export function AccountInvitations({dealerId,ownerOnly=false,demoSetup=false,onUpdated}:{dealerId?:string;ownerOnly?:boolean;demoSetup?:boolean;onUpdated?:()=>void|Promise<void>}) {
  const endpoint=dealerId?`/api/platform/dealers/${encodeURIComponent(dealerId)}/invitations`:'/api/staff/team/invitations';
  const cache=useQueryClient();
  const query=useQuery({queryKey:['account-invitations',endpoint],queryFn:()=>customFetch<Data>(endpoint),retry:false});
  const [email,setEmail]=useState(''),[role,setRole]=useState('salesperson'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  async function mutate(action?:{id:string;kind:'resend'|'cancel'}) {
    setBusy(true);setError('');setNotice('');
    try {
      const result=await customFetch<{invitation:AccountInvitation;previewUrl?:string}>(action?`${endpoint}/${action.id}/${action.kind}`:endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(action?{}:{email:email.trim(),role:ownerOnly?'owner':role})});
      if(!action)setEmail('');
      await query.refetch();await cache.invalidateQueries({queryKey:['staff-team']});await onUpdated?.();
      setNotice(action?.kind==='cancel'?'Invitation cancelled. Its link will no longer work.':result.previewUrl?'Fictional invitation prepared. No email was sent.':result.invitation.deliveryStatus==='sent'?'Invitation email sent. Access starts when they accept.':'The invitation is saved, but email delivery could not be confirmed. Check the address and use Resend after one minute.');
      if(result.previewUrl)setPreviewUrl(result.previewUrl);
    }catch(cause){setError(cause instanceof Error?cause.message:'Could not complete the invitation. Refresh before trying again.');}finally{setBusy(false);}
  }
  const [previewUrl,setPreviewUrl]=useState('');
  return <section className="account-invitations" aria-label={ownerOnly?'Dealership owner invitations':'Staff invitations'} data-settings-dirty={Boolean(email.trim())}>
    <header><h3>{ownerOnly?'Invite dealership owner':'Invite your team'}</h3><p>{ownerOnly?'Enter the owner’s email. They can create an account or sign in using the invitation—no registration beforehand. Your setup access stays in place.':'Send an invitation to each person’s own email address. They can create an account or use an existing one.'}</p></header>
    {ownerOnly&&demoSetup&&<p className="account-invite-help" role="note">This gives the owner setup access. The dealership stays a demonstration until conversion, and staff invitations become available after launch.</p>}
    {query.isError&&<div role="alert" className="admin-error">Invitations could not be loaded. <Button type="button" variant="outline" onClick={()=>void query.refetch()}>Retry invitations</Button></div>}
    {error&&<p role="alert" className="admin-error">{error}</p>}{notice&&<p role="status" className="account-invite-notice">{notice}</p>}
    {previewUrl&&<a href={previewUrl} target="_blank" rel="noreferrer" className="underline">Open fictional invitation preview</a>}
    {query.data&&<>
      {!query.data.email.ready&&<p role="status" className="admin-error">{query.data.email.message}</p>}
      <form className="account-invite-form" onSubmit={event=>{event.preventDefault();void mutate();}}>
        <label>Email address<Input type="email" autoComplete="email" required maxLength={254} disabled={busy} value={email} onChange={event=>setEmail(event.target.value)} placeholder={ownerOnly?'owner@dealership.co.uk':'colleague@dealership.co.uk'}/></label>
        {!ownerOnly&&<label>Access<NativeSelect aria-label="Invitation role" disabled={busy} value={role} onChange={event=>setRole(event.target.value)}><option value="salesperson">Salesperson</option><option value="accounts">Accounts</option><option value="owner">Owner</option></NativeSelect></label>}
        <Button type="submit" disabled={busy||!query.data.email.ready||!email.trim()}><Mail size={17}/>{busy?'Please wait…':ownerOnly?'Send owner invitation':'Send invitation'}</Button>
      </form>
      <p className="account-invite-help">Links last 7 days. Resending replaces the previous link. Invitations do not give platform administrator access. The invited email must be verified before access is added.</p>
      <div className="account-invite-list"><div className="account-invite-list-heading"><h4>Invitations</h4><Button type="button" variant="ghost" disabled={busy||query.isFetching} onClick={()=>void query.refetch().then(()=>onUpdated?.())}><RefreshCw size={15}/>Refresh</Button></div>
        {query.data.invitations.length===0&&<p className="account-invite-help">No invitations yet.</p>}
        {query.data.invitations.map(item=><article key={item.id} className="account-invite-row"><div><strong>{item.email}</strong><p>{item.role==='owner'?'Owner':item.role==='accounts'?'Accounts':'Salesperson'} <span className={`account-invite-status is-${item.status}`}>{item.status==='pending'?(item.deliveryStatus==='sent'?'Awaiting acceptance':item.deliveryStatus==='sending'?'Sending email':item.deliveryStatus==='unknown'?'Email not confirmed':'Email needs attention'):item.status==='accepted'?'Accepted':item.status==='expired'?'Expired':'Cancelled'}</span></p><small>{item.status==='accepted'&&item.acceptedAt?'Accepted '+new Date(item.acceptedAt).toLocaleDateString('en-GB'):'Expires '+new Date(item.expiresAt).toLocaleDateString('en-GB')}</small></div>
          {(item.status==='pending'||item.status==='expired')&&(!dealerId&&item.managedBy==='platform'?<small>Managed by the platform</small>:<div className="account-invite-row-actions"><Button type="button" variant="outline" disabled={busy||!query.data!.email.ready} onClick={()=>void mutate({id:item.id,kind:'resend'})}>Resend</Button><Button type="button" variant="ghost" disabled={busy} onClick={()=>{if(window.confirm(`Cancel the invitation for ${item.email}? Its link will stop working.`))void mutate({id:item.id,kind:'cancel'});}}><X size={15}/>Cancel</Button></div>)}
        </article>)}
      </div>
    </>}
    {query.isLoading&&<p role="status">Loading invitations…</p>}
  </section>;
}
