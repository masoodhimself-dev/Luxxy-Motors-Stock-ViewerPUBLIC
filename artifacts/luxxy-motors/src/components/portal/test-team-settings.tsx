import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { TestEmailButton } from './test-email';

type Role='owner'|'salesperson'|'accounts';
type Member={id:string;name:string|null;email:string|null;role:Role;active:boolean;invited:boolean};
type Team={members:Member[];revision:number};

export function TestTeamSettings({sessionId}:{sessionId:string}){
  const endpoint=`/api/sales-test/sessions/${encodeURIComponent(sessionId)}/team`,key=['sales-test',sessionId,'team'];
  const cache=useQueryClient();const team=useQuery({queryKey:key,queryFn:({signal})=>customFetch<Team>(endpoint,{signal}),retry:false});
  const [email,setEmail]=useState(''),[role,setRole]=useState<Role>('salesperson'),[edits,setEdits]=useState<Record<string,Role>>({});
  const change=useMutation({mutationFn:({method,body}:{method:'POST'|'PATCH';body:object})=>customFetch<Team>(endpoint,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,expectedRevision:team.data?.revision})}),onSuccess:data=>{cache.setQueryData(key,data);setEmail('');setEdits({});}});
  const dirty=Boolean(email || team.data?.members.some(member=>edits[member.id] && edits[member.id]!==member.role));
  return <section className="dealer-admin space-y-4" data-settings-dirty={dirty}><header className="admin-heading"><div><h3>Your team</h3><p>Practice using a copy of the staff list. No real access is changed.</p></div></header>
    {team.isLoading && <p role="status">Loading the test team…</p>}{team.isError && <p role="alert">Could not load the test team. <button onClick={()=>void team.refetch()}>Retry</button></p>}
    {team.data && <><form className="admin-card space-y-3" onSubmit={event=>{event.preventDefault();change.mutate({method:'POST',body:{email,role}});}}>
      <h4>Practice an invitation</h4><p className="text-sm text-muted-foreground">This records a practice invitation only; it does not create an account or send an invitation.</p>
      <label className="grid gap-1 text-sm">Staff email<input type="email" required maxLength={254} className="rounded border bg-background p-2" value={email} onChange={event=>setEmail(event.target.value)}/></label>
      <label className="grid gap-1 text-sm">Role<select className="rounded border bg-background p-2" value={role} onChange={event=>setRole(event.target.value as Role)}><option value="salesperson">Salesperson</option><option value="accounts">Accounts</option><option value="owner">Owner</option></select></label>
      <Button type="submit" disabled={change.isPending}>Create practice invitation</Button>
    </form><div className="admin-team-list">{team.data.members.map(member=><article className="admin-card space-y-2" key={member.id}><div><strong>{member.name||member.email||'Staff member'}</strong><p className="text-sm text-muted-foreground">{member.invited?'Practice invitation':member.active?'Access enabled':'Access disabled'}</p></div>
      <label className="grid gap-1 text-sm">Role for {member.name||member.email}<select className="rounded border bg-background p-2" value={edits[member.id]??member.role} onChange={event=>setEdits({...edits,[member.id]:event.target.value as Role})}><option value="owner">Owner</option><option value="salesperson">Salesperson</option><option value="accounts">Accounts</option></select></label>
      <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={change.isPending||!edits[member.id]||edits[member.id]===member.role} onClick={()=>change.mutate({method:'PATCH',body:{id:member.id,role:edits[member.id]}})}>Apply role</Button><Button type="button" variant="outline" disabled={change.isPending} onClick={()=>change.mutate({method:'PATCH',body:{id:member.id,active:!member.active}})}>{member.active?'Disable access':'Enable access'}</Button>{member.invited && <TestEmailButton sessionId={sessionId} teamMemberId={member.id} label="Preview practice invitation"/>}</div>
    </article>)}</div></>}
    {change.isError && <p role="alert">{change.error instanceof Error?change.error.message:'Could not update the test team.'}</p>}
  </section>;
}
