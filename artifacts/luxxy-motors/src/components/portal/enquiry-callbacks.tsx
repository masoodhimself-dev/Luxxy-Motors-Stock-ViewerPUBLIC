import type { Enquiry } from '@workspace/api-client-react';
import { deskMatches } from '@/lib/enquiry-desk-model';
import { enquiryGroupSearchText } from '@/lib/enquiry-groups';
import type { Car } from '@/lib/stock-context';
import { callbackTiming, isOutstandingCallback, sortCallbacks } from './enquiry-callback-model';
import { EnquiryRecordBrowser, type EnquiryRecordActions } from './enquiry-record-browser';
import { EnquiryMergeLabel } from './enquiry-merge-label';

export function CallbacksDesk({ entries, allEntries = entries, cars, selectedId, onSelect, onBack, actions, includeUnassigned, filter, search }: { entries: Enquiry[]; allEntries?: Enquiry[]; cars: Car[]; selectedId: string | null; onSelect: (id: string) => void; onBack: () => void; actions: EnquiryRecordActions; includeUnassigned?: boolean; filter: string; search: string }) {
  const callbacks = entries.filter(isOutstandingCallback);
  const now = Date.now();
  const overdue = callbacks.filter(entry => callbackTiming(entry, now) === 'overdue').length;
  const upcoming = callbacks.filter(entry => callbackTiming(entry, now) === 'upcoming').length;
  const noTime = callbacks.filter(entry => callbackTiming(entry, now) === 'unscheduled').length;
  const rows = callbacks.filter(entry => deskMatches(search, [enquiryGroupSearchText(entry, allEntries)]) && (filter === 'all' || (filter === 'website' ? entry.source === 'website_callback' : filter === 'unassigned' ? !entry.assignedToId : callbackTiming(entry, now) === filter))).sort(sortCallbacks);
  const selected = entries.find(entry => entry.id === selectedId);
  return <section className="enquiry-ledger-sheet enquiry-record-sheet enquiry-callback-sheet">
    <div className="enquiry-callback-heading"><div><h3>Callbacks</h3><p className="text-xs text-muted-foreground">Website callback requests and outstanding staff follow-ups · UK time</p></div><div className="enquiry-callback-counts"><span>{overdue} overdue now</span><span>{upcoming} upcoming</span>{noTime > 0 && <span>{noTime} need a time</span>}</div></div>
    {includeUnassigned && <p className="enquiry-callback-unassigned-note">My queue includes unassigned requests so they can be claimed.</p>}
    {selected && <EnquiryMergeLabel entry={selected} entries={allEntries} />}

    <EnquiryRecordBrowser entries={rows} allEntries={allEntries} cars={cars} selectedId={selectedId} onSelect={onSelect} onBack={onBack} actions={actions} callbacks emptyMessage={callbacks.length ? 'No callbacks match these filters.' : 'No outstanding callbacks. New website requests will appear here.'} />
  </section>;
}
