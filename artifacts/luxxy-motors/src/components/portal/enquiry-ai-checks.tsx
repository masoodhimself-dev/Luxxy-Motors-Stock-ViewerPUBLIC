import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { formatDateTime } from './portal-ui';

type Checks = {requestId:string;model:string;createdAt:string;contextAudit:{checkedAt:string;questions:{question:string;topic:string;outcome:string;source:string;checkedAt:string}[];lookups:{kind:string;status:string;source:string;checkedAt:string;errorCode?:string}[]}};
const outcomes:Record<string,string>={verified:'Verified',listing_only:'From the listing',not_recorded:'Needs confirmation',unavailable:'Could not verify'};
const topics:Record<string,string>={mot:'MOT',equipment:'Equipment',registration:'Registration',service_history:'Service history',ownership:'Ownership',warranty:'Warranty',availability:'Availability',price:'Price',appointment:'Appointment',delivery:'Delivery',other:'Customer question'};

/** Private evidence stays folded and is never inserted into a customer email. */
export function EnquiryAiChecks({id}:{id:string}) {
  const [open,setOpen]=useState(false);
  const query=useQuery({queryKey:['enquiry-ai-checks',id],enabled:open,retry:false,queryFn:async({signal})=>{
    try{return await customFetch<Checks>(`/api/staff/enquiries/${encodeURIComponent(id)}/ai-checks`,{signal,cache:'no-store'});}
    catch(error){if((error as {status?:number}).status===404)return null;throw error;}
  }});
  return <details className="enquiry-ai-checks" onToggle={event=>setOpen(event.currentTarget.open)}><summary>What AI checked</summary>{open&&<div>
    {query.isPending?<p role="status">Loading saved checks…</p>:query.isError?<><p role="alert">The saved checks couldn’t be loaded.</p><Button size="sm" variant="ghost" onClick={()=>void query.refetch()}>Try again</Button></>:query.data?<>
      <p className="enquiry-ai-checks-date">Checked {formatDateTime(query.data.contextAudit.checkedAt)} · {query.data.model}</p>
      <ul>{query.data.contextAudit.questions.map((check,index)=><li key={index} data-outcome={check.outcome}><strong>{topics[check.topic]??'Customer question'}</strong><span>{outcomes[check.outcome]??'Needs review'}</span><small>{check.source}</small></li>)}</ul>
      {query.data.contextAudit.lookups.some(check=>check.kind==='mot'&&check.status==='unavailable')&&<p>MOT details could not be verified. Check the record before confirming an expiry or history to the customer.</p>}
    </>:<p>No check history was saved for this draft. Older drafts keep their original text; a new draft records its checks.</p>}
  </div>}</details>;
}
