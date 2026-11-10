import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { Enquiry } from '@workspace/api-client-react';
import { ArrowLeft, CalendarDays, CheckCircle2, Inbox, Plus, RefreshCw, Search } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Car } from '@/lib/stock-context';
import { enquiryGroup, primaryEnquiry } from '@/lib/enquiry-groups';
import { enquiryPresentation, enquiryRequestText } from '@/lib/enquiry-presentation';
import { inboxCaseState, inboxFilter, inboxFolderEntries, inboxLastActivity, inboxRelativeTime, inboxState, isAiEnquiry, type InboxFilter, type InboxFolder } from '@/lib/inbox-model';
import type { InboxEnquiry } from '@/lib/enquiry-reply-attention';
import { EnquiryCustomerCase } from './enquiry-customer-case';
import type { EnquiryRecordActions } from './enquiry-record-browser';
import './inbox-workspace.css';
import './workspace-tools.css';

const filters: {id: InboxFilter; label: string}[] = [
  {id:'needs-you',label:'Needs you'}, {id:'all',label:'All'}, {id:'done',label:'Done'},
];
const folders: {id:InboxFolder;label:string}[] = [{id:'enquiries',label:'Enquiries'},{id:'ai',label:'AI enquiries'},{id:'archive',label:'Archive'}];

/** The conversation is the workspace. Bookings, email delivery and car tools stay within reach. */
export function InboxWorkspace({ entries, cars, selectedId, onSelect, onBack, actions, loading=false,
  error=false, refreshing=false, onRefresh, onNewEnquiry, tools, missingRequested=false, currentStaffId, linkedReplyAction, enquiryReplyId,
}: {
  entries: Enquiry[]; cars: Car[]; selectedId: string|null; onSelect:(id:string)=>void;
  onBack:()=>void|boolean; actions:EnquiryRecordActions; loading?:boolean; error?:boolean;
  refreshing?:boolean; onRefresh:()=>void; onNewEnquiry?:()=>void; tools?:ReactNode; missingRequested?:boolean; currentStaffId?:string;
  linkedReplyAction?: "reply" | "fix-email";
  enquiryReplyId?: string;
}) {
  const [ownerView,setOwnerView]=useState<'all'|'mine'|'unassigned'>('all');
  const [filter,setFilter]=useState<InboxFilter>('needs-you');
  const [folder,setFolder]=useState<InboxFolder>('enquiries');
  const [search,setSearch]=useState('');
  const [now,setNow]=useState(Date.now);
  const [previewEntry,setPreviewEntry]=useState<Enquiry|null>(null);
  const [autoPreview,setAutoPreview]=useState(true);
  const detail=useRef<HTMLDivElement>(null), selectedButton=useRef<HTMLButtonElement>(null);
  const folderId=useId(), openedId=useRef<string|null>(null);
  useEffect(()=>{const timer=window.setInterval(()=>setNow(Date.now()),60_000);return()=>window.clearInterval(timer);},[]);
  const folderEntries=inboxFolderEntries(entries,folder);
  const visible=inboxFilter(folderEntries,folder==='archive'?'archive':filter,search,now).filter(entry=>{const members=enquiryGroup(entry,entries).filter(e=>folder==='archive'||!e.archivedAt);return ownerView==='all'||ownerView==='mine'&&Boolean(currentStaffId)&&members.some(e=>e.assignedToId===currentStaffId)||ownerView==='unassigned'&&members.every(e=>!e.assignedToId);});
  const explicit=entries.find(entry=>entry.id===selectedId);
  useEffect(()=>{
    if (!explicit || openedId.current===explicit.id) return;
    openedId.current=explicit.id;
    setFolder(current => {
      if (explicit.archivedAt) return 'archive';
      return current === 'ai' && enquiryGroup(explicit,entries).some(isAiEnquiry) ? 'ai' : 'enquiries';
    });
  },[explicit?.id]);
  const root=explicit ? primaryEnquiry(explicit,entries) : missingRequested || !autoPreview ? undefined : (entries.find(entry=>entry.id===previewEntry?.id) ?? previewEntry ?? visible[0]);
  useEffect(()=>{if(autoPreview && !previewEntry && root) setPreviewEntry(root);},[autoPreview,previewEntry,root]);
  const group=root ? enquiryGroup(root,entries) : [];
  const selected=explicit ?? root;
  const explicitSelection=Boolean(explicit);
  useEffect(()=>{
    if (!explicitSelection) return;
    detail.current?.scrollTo?.({top:0});
    if(window.matchMedia('(max-width: 899px)').matches) detail.current?.focus();
  },[selected?.id,explicitSelection]);
  function resetSelection(change:()=>void) { if(onBack()!==false) { setAutoPreview(false); setPreviewEntry(null); change(); } }
  const selectedVisible=root ? visible.some(entry=>entry.id===root.id):true;
  function open(entry:Enquiry) {
    const members=enquiryGroup(entry,entries);
    const next=[...members].sort((a,b)=>inboxState(a,now).priority-inboxState(b,now).priority)[0] ?? entry;
    onSelect(next.id);
  }
  function doneNext(entry: Enquiry) {
    const linked = enquiryGroup(entry, entries).find(member => member.id !== entry.id && !member.archivedAt && inboxState(member, now).key === 'needs-you');
    if (linked) { onSelect(linked.id); return; }

    const rootId = primaryEnquiry(entry, entries).id;
    const index = visible.findIndex(candidate => candidate.id === rootId);
    const remaining = [...visible.slice(index + 1), ...visible.slice(0, Math.max(index, 0))];
    const next = remaining.find(candidate => inboxCaseState(candidate, entries, now).key === 'needs-you');
    if (next) open(next);
    else resetSelection(() => {});
  }
  return <section className="inbox-desk" aria-label="Inbox conversations" data-selected={explicitSelection}>
    <header className="inbox-desk-heading">
      <h2>Inbox</h2>
      <label className="inbox-desk-search"><Search size={18} aria-hidden/><span className="sr-only">Search enquiries</span>
        <Input value={search} onChange={event=>resetSelection(()=>setSearch(event.target.value))} placeholder="Search name, car or reg"/>
      </label>
      <div className="inbox-desk-heading-actions">
        <Button variant="ghost" size="icon" aria-label="Refresh inbox" disabled={refreshing} onClick={onRefresh}><RefreshCw size={17} className={refreshing?'animate-spin':''} aria-hidden/></Button>
        {onNewEnquiry && <Button size="sm" onClick={onNewEnquiry}><Plus size={17} aria-hidden/>New enquiry</Button>}
      </div>
    </header>
    <div className="inbox-folder-tabs" role="tablist" aria-label="Inbox folders">
      {folders.map((item,index)=><button key={item.id} id={`${folderId}-${item.id}`} type="button" role="tab" aria-selected={folder===item.id}
        aria-controls={`${folderId}-panel`} tabIndex={folder===item.id?0:-1}
        onClick={()=>resetSelection(()=>{setFolder(item.id);setFilter('needs-you');setSearch('');})}
        onKeyDown={event=>{let next:number|undefined;if(event.key==='ArrowRight')next=(index+1)%folders.length;if(event.key==='ArrowLeft')next=(index+folders.length-1)%folders.length;if(event.key==='Home')next=0;if(event.key==='End')next=folders.length-1;if(next!==undefined){event.preventDefault();const button=event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=tab]')[next];button?.click();button?.focus();}}}
      >{item.label}</button>)}
    </div>
    <div className="inbox-desk-navigation">
      {folder==='archive' ? <p className="inbox-archive-note">Recover for 30 days. Linked business records are protected.</p> : <div className="inbox-desk-filters" role="group" aria-label="Filter conversations">
        {filters.map(item=><button type="button" key={item.id} aria-pressed={filter===item.id} data-filter={item.id}
          onClick={()=>resetSelection(()=>setFilter(item.id))}>{item.label}</button>)}
      </div>}
      <details className="inbox-tools-menu" onKeyDown={event=>{if(event.key==="Escape"){event.currentTarget.open=false;event.currentTarget.querySelector("summary")?.focus();}}}><summary>Tools</summary><nav className="inbox-desk-tools" aria-label="Inbox tools">
        <label className="workspace-owner-filter">Owner<select aria-label="Enquiry owner" value={ownerView} onChange={e=>resetSelection(()=>setOwnerView(e.target.value as typeof ownerView))}><option value="all">Everyone</option><option value="mine" disabled={!currentStaffId}>My enquiries</option><option value="unassigned">Unassigned</option></select></label>
        {folder!=='archive'&&<button type="button" aria-pressed={filter==='test-drives'} onClick={event=>{resetSelection(()=>setFilter('test-drives'));event.currentTarget.closest("details")?.removeAttribute("open");}}><CalendarDays size={16} aria-hidden/>Test drives</button>}
        {tools}
      </nav></details>
    </div>
    {loading ? <div className="inbox-desk-empty" role="status"><Inbox size={28} aria-hidden/><h3>Loading your Inbox…</h3></div>
    :error && !entries.length ? <div className="inbox-desk-empty" role="alert"><h3>Enquiries couldn’t be loaded</h3><p>Your saved conversations are unchanged.</p><Button variant="outline" onClick={onRefresh}>Retry enquiries</Button></div>
    : <>{error&&<div role="alert" className="inbox-outside-filter">The latest update couldn’t be loaded. Your conversation and draft are kept.<Button variant="ghost" size="sm" onClick={onRefresh}>Retry update</Button></div>}<div className="inbox-desk-columns">
      <aside className="inbox-desk-list" id={`${folderId}-panel`} role="tabpanel" aria-labelledby={`${folderId}-${folder}`}>
        <p className="inbox-desk-count" aria-live="polite">{visible.length} {visible.length===1?'conversation':'conversations'}{folder!=='archive'&&filter==='test-drives'?' · Test drives':''}{ownerView==='mine'?' · My enquiries':ownerView==='unassigned'?' · Unassigned':''}</p>
        {!visible.length ? <div className="inbox-desk-empty" role="status">
          {folder==='archive'&&!search ? <><Inbox size={28} aria-hidden/><h3>No archived enquiries</h3><p>Archived conversations stay recoverable here for 30 days.</p></> : folder==='ai'&&!folderEntries.length&&!search ? <><Inbox size={28} aria-hidden/><h3>No AI enquiries yet</h3><p>Enquiries appear here when connected provider automation prepares a reply. Website enquiries and manual AI drafts stay in Enquiries.</p></> : filter==='needs-you'&&!search ? <><CheckCircle2 size={28} aria-hidden/><h3>You’re up to date</h3><p>Nothing needs your attention right now.</p></> : <><Inbox size={28} aria-hidden/><h3>{search?'No matching conversations':entries.length?'Nothing here yet':'Your Inbox is ready'}</h3><p>{search?'Try a name, registration or email address.':entries.length?'Try All to see your other enquiries.':'Website enquiries and test-drive requests will appear here.'}</p></>}
          {(search||ownerView!=='all'||folder!=='archive'&&filter!=='all')&&<Button variant="outline" size="sm" onClick={()=>resetSelection(()=>{setSearch('');setFilter('all');setOwnerView('all');})}>{folder==='archive'?'Clear filters':'Show all enquiries'}</Button>}
        </div> : <ul>{visible.map(entry=>{
          const state=inboxCaseState(entry,entries,now);
          const members=enquiryGroup(entry,entries) as InboxEnquiry[];
          const latest=[...members].sort((a,b)=>Date.parse(inboxLastActivity(b)??'')-Date.parse(inboxLastActivity(a)??''))[0]??entry as InboxEnquiry;
          const at=inboxLastActivity(latest);
          const presentation = enquiryPresentation(entry);
          return <li key={entry.id} data-testid={`enquiry-${entry.id}`}><button type="button" ref={root?.id===entry.id?selectedButton:undefined}
            className="inbox-desk-row" aria-label={`Open enquiry for ${entry.customerName}, ${entry.vehicleTitle||'general enquiry'}`} aria-pressed={root?.id===entry.id} onClick={()=>open(entry)}>
            <span className="inbox-desk-row-top"><strong>{entry.customerName}</strong><time dateTime={at??undefined} title={at?new Date(at).toLocaleString('en-GB'):undefined}>{inboxRelativeTime(at,now)}</time></span>
            <span className="inbox-desk-row-car">{entry.vehicleTitle||'General enquiry'}{entry.vehicleRegistration&&` · ${entry.vehicleRegistration}`}</span>
            <span className="inbox-desk-row-preview">{latest.latestReplyText||enquiryRequestText(latest)||state.nextAction}</span>
            <span className="inbox-desk-row-tags"><span className="inbox-status" data-tone={state.tone}>{state.label}</span><span className="inbox-source">{presentation.source}{entry.type==='part_exchange'?' · Part exchange':''}</span>{members.some(member=>member.aiProvider&&member.aiDraftStatus==='ready')&&<span className="inbox-ai-status">Draft ready</span>}</span>
          </button></li>;
        })}</ul>}
      </aside>
      <div className="inbox-desk-conversation" ref={detail} tabIndex={-1} aria-label={selected?`Conversation with ${selected.customerName}`:'Conversation'}>
        {selected ? <>
          <div className="inbox-conversation-back"><Button size="sm" variant="ghost" onClick={()=>{if(onBack()!==false) {setAutoPreview(false);setPreviewEntry(null);requestAnimationFrame(()=>selectedButton.current?.focus());}}}><ArrowLeft size={17} aria-hidden/>Back to Inbox</Button></div>
          {!selectedVisible&&<div className="inbox-outside-filter" role="status">This conversation is outside your current filter.<Button variant="ghost" size="sm" onClick={()=>{setFolder(selected.archivedAt?'archive':'enquiries');setFilter('all');setSearch('');setOwnerView('all');}}>{selected.archivedAt?'View Archive':'Show in All'}</Button></div>}
          {group.length>1&&<details className="inbox-linked-records"><summary>{group.length} linked enquiries</summary><div>{group.map(original=><Button key={original.id} size="sm" variant={original.id===selected.id?'default':'outline'} onClick={()=>onSelect(original.id)}>{original.vehicleTitle||'General enquiry'} · {enquiryPresentation(original).purpose}</Button>)}</div></details>}
          <EnquiryCustomerCase compact key={selected.id} entry={selected} linkedReplyAction={explicitSelection ? linkedReplyAction : undefined} enquiryReplyId={explicitSelection ? enquiryReplyId : undefined} entries={entries} car={cars.find(car=>car.id===selected.vehicleId)} cars={cars} actions={{...actions,onDoneNext:doneNext}}/>
        </> : <div className="inbox-desk-empty">
          <Inbox size={32} aria-hidden/><h3>{missingRequested?'This enquiry is unavailable':'Choose a conversation'}</h3><p>{missingRequested?'It may have been removed or combined with another record. Search the Inbox or refresh to check.':'Open an enquiry to read and reply.'}</p>
          {missingRequested&&<Button variant="outline" onClick={onRefresh}>Refresh Inbox</Button>}
        </div>}
      </div>
    </div></>}
  </section>;
}
