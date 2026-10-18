import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { ArrowLeft, CalendarDays, Phone } from 'lucide-react';
import { useGetStaffDirectory, useUpdateEnquiryWorkspace, type Enquiry } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { callOutcomes, nextAction, type CallOutcome } from '@/lib/enquiry-desk-model';
import { appointmentLabel } from '@/lib/test-drive-dates';
import { formatPrice } from '@/lib/utils';
import type { Car } from '@/lib/stock-context';
import { HistoryLinks } from './history-links';
import { Chip } from './portal-ui';
import { AppointmentExceptionLabels } from './enquiry-calendar';
import { AttendanceControls, NextAction, useRefreshDesk, workspaceError } from './enquiry-workspace-tools';
import { ConversationHistory } from './enquiry-conversation';
import { callbackTiming } from './enquiry-callback-model';
import { enquiryGroup, primaryEnquiry } from '@/lib/enquiry-groups';
import { EnquiryPhotoPeek } from './enquiry-photo-peek';
import { CustomerEmailSummary } from './customer-email-summary';
import './enquiry-record-browser.css';

export type EnquiryRecordActions = {
  onUpdate: (entry: Enquiry) => void;
  onConversation: (entry: Enquiry) => void;
  onFollowUp: (entry: Enquiry) => void;
  onAppointment: (entry: Enquiry) => void;
  onBook: (entry: Enquiry) => void;
  onVehicle: (car: Car) => void;
  onMerge?: (entry: Enquiry) => void;
  onEmail?: (entry: Enquiry) => void;
};

function enquiryStatus(entry: Enquiry) {
  return entry.appointmentCancelledAt ? 'Cancelled' : entry.appointmentAt ? entry.appointmentStatus === 'pending' ? 'Awaiting approval' : 'Confirmed' : 'Enquiry';
}
function ClaimEnquiry({ entry }: { entry: Enquiry }) {
  const directory = useGetStaffDirectory();
  const mutation = useUpdateEnquiryWorkspace();
  const refresh = useRefreshDesk();
  if (entry.assignedToId) return null;
  return <div className="enquiry-claim-action"><Button size="sm" variant="outline" disabled={mutation.isPending || !directory.data?.currentUserId} onClick={async () => { try { await mutation.mutateAsync({ id: entry.id, data: { expectedRevision: entry.workspaceRevision ?? 0, assignedToId: directory.data!.currentUserId } }); await refresh(); } catch {} }}>{mutation.isPending ? 'Assigning…' : 'Assign to me'}</Button>{directory.isError && <p role="alert" className="text-xs text-destructive">Staff directory unavailable. Refresh to retry.</p>}{mutation.isError && <p role="alert" className="text-xs text-destructive">{workspaceError(mutation.error)}</p>}</div>;
}

function EnquiryDetail({ entry, car, actions }: { entry: Enquiry; car?: Car; actions: EnquiryRecordActions }) {
  const outstanding = Boolean(entry.followUpAt && !entry.followUpCompletedAt);
  const future = entry.appointmentAt && Date.parse(entry.appointmentAt) > Date.now() && !entry.appointmentCancelledAt;
  const visitFinished = entry.attendance === 'completed' || entry.attendance === 'no_show';
  const canBook = !future || visitFinished;
  return <>
    <header className="enquiry-detail-customer">
      <div className="enquiry-detail-heading"><div><p className="enquiry-detail-eyebrow">{entry.reference}</p><h3>{entry.customerName}</h3></div><Chip tone={entry.appointmentCancelledAt ? 'muted' : entry.appointmentAt && entry.appointmentStatus === 'pending' ? 'warning' : 'info'}>{enquiryStatus(entry)}</Chip></div>
      <div className="enquiry-detail-contact">{entry.phone ? <a href={`tel:${entry.phone.replace(/[^+\d]/g, '')}`}><Phone aria-hidden className="h-4 w-4" />{entry.phone}</a> : <p className="text-sm text-muted-foreground">No phone supplied</p>}{entry.email && <a href={`mailto:${entry.email}`}>{entry.email}</a>}</div>
      <div className="enquiry-detail-owner"><p className="text-xs text-muted-foreground">Assigned to <strong>{entry.assignedToName || 'Unassigned'}</strong></p><ClaimEnquiry entry={entry} /></div>
    </header>
    <div className="enquiry-detail-actions" aria-label="Selected enquiry actions">
      <Button size="sm" onClick={() => actions.onConversation(entry)}>Log another conversation</Button>
      <Button size="sm" variant="outline" onClick={() => actions.onFollowUp(entry)}>{outstanding ? 'Manage follow-up' : 'Request follow-up'}</Button>
    </div>
    <section className="enquiry-detail-car" aria-label="Enquiry vehicle">
      {car && <EnquiryPhotoPeek car={car} className="enquiry-detail-car-photo" />}
      <div className="enquiry-detail-car-copy"><h4>{entry.vehicleTitle || 'General showroom enquiry'}</h4>{entry.vehicleRegistration && <p className="text-sm font-medium">{entry.vehicleRegistration}</p>}{entry.vehicleId && <p className="enquiry-detail-availability">{car ? car.inventoryStatus === 'available' ? 'Available' : car.inventoryStatus === 'reserved' ? 'Reserved' : car.inventoryStatus === 'sold' ? 'Sold' : car.inventoryStatus === 'archived' ? 'Archived' : 'Availability unconfirmed' : 'No longer in current stock'}</p>}{car?.price != null && <p className="text-sm font-semibold">{formatPrice(car.price)}</p>}{!entry.vehicleId && entry.vehicleTitle && <p className="text-xs text-muted-foreground">Ad hoc vehicle — not showroom stock{entry.vehiclePrice != null ? ` · ${formatPrice(entry.vehiclePrice)}` : ''}</p>}</div>
      {car && <Button size="sm" variant="outline" onClick={() => actions.onVehicle(car)}>Vehicle information</Button>}
    </section>
    <section className="enquiry-detail-next-step" aria-label="Customer next step">
      <NextAction entry={entry} />
      {entry.followUpAt && <div className="enquiry-detail-followup"><p className="font-medium text-sm">{entry.followUpCompletedAt ? 'Follow-up completed' : callbackTiming(entry) === 'overdue' ? 'Follow-up overdue' : 'Upcoming follow-up'}</p>{entry.followUpCompletedAt && <p className="text-sm">{appointmentLabel(entry.followUpAt)}</p>}{entry.followUpNote && <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{entry.followUpNote}</p>}</div>}
      {entry.appointmentAt && <section className="enquiry-detail-appointment"><p className="text-sm font-medium">Appointment · {appointmentLabel(entry.appointmentAt)}</p><AppointmentExceptionLabels booking={entry} /><AttendanceControls entry={entry} /></section>}
      <div className="enquiry-detail-actions" aria-label="Appointment actions">{future && !visitFinished && <Button variant="outline" size="sm" onClick={() => actions.onAppointment(entry)}><CalendarDays aria-hidden className="mr-1 h-4 w-4" />Change appointment</Button>}{canBook && <Button variant="outline" size="sm" onClick={() => actions.onBook(entry)}>{entry.appointmentAt ? 'Book another test drive' : 'Book test drive'}</Button>}</div>
    </section>
    {actions.onEmail && <CustomerEmailSummary enquiryId={entry.id} reference={entry.reference} onPrepare={() => actions.onEmail?.(entry)} />}
    <details className="enquiry-desk-more enquiry-detail-more"><summary>More options</summary><div>
      <Button size="sm" variant="outline" onClick={() => actions.onUpdate(entry)}>Update enquiry</Button>
      <Button size="sm" variant="outline" asChild><Link href={`/portal?section=sales&enquiryId=${entry.id}`}>Start sale</Link></Button>
      {actions.onMerge && <Button size="sm" variant="outline" onClick={() => actions.onMerge?.(entry)}>Merge records</Button>}
      <HistoryLinks vehicleId={entry.vehicleId} recordType="enquiry" recordId={entry.id} vehicle={Boolean(entry.vehicleId || entry.vehicleTitle)} />
    </div></details>
    <div className="enquiry-detail-record-meta">
      {entry.callOutcome && <p><strong>Latest outcome: </strong>{callOutcomes[entry.callOutcome as CallOutcome] || entry.callOutcome}</p>}
      {entry.createdAt && <p>{entry.source === 'website_callback' ? 'Callback requested' : 'Received'} <time dateTime={entry.createdAt}>{appointmentLabel(entry.createdAt)}</time>{entry.preferredContact ? ` · Preferred contact: ${entry.preferredContact}` : ''}</p>}
    </div>
    <ConversationHistory entry={entry} loadOnDemand />
  </>;
}

export function EnquiryRecordBrowser({ entries, allEntries = entries, cars, selectedId, onSelect, onBack, actions, callbacks = false, emptyMessage = 'No matching enquiries. Try another name or phone number.' }: { entries: Enquiry[]; allEntries?: Enquiry[]; cars: Car[]; selectedId: string | null; onSelect: (id: string) => void; onBack: () => void; actions: EnquiryRecordActions; callbacks?: boolean; emptyMessage?: string }) {
  const selected = entries.find(entry => entry.id === selectedId) ?? entries[0];
  const group = selected ? enquiryGroup(selected, allEntries) : [];
  const primary = selected ? primaryEnquiry(selected, allEntries) : undefined;
  const explicitSelection = Boolean(selectedId && entries.some(entry => entry.id === selectedId));
  const detail = useRef<HTMLDivElement>(null);
  const [openedOriginals, setOpenedOriginals] = useState<Set<string>>(() => new Set());
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { if (detail.current) detail.current.scrollTop = 0; if (explicitSelection && window.matchMedia('(max-width: 899px)').matches) { detail.current?.focus(); detail.current?.scrollIntoView({ block: 'start' }); } }, [selected?.id, selectedId, explicitSelection]);
  if (!entries.length) return <p className="py-6 text-center text-muted-foreground">{emptyMessage}</p>;
  return <div className="enquiry-record-browser" data-selected={explicitSelection ? 'true' : 'false'}>
    <div ref={list} tabIndex={-1} className="enquiry-record-list-pane" aria-label={callbacks ? 'Callback requests' : 'Enquiry records'}>
      <p className="enquiry-record-count">{entries.length} {callbacks ? entries.length === 1 ? 'callback' : 'callbacks' : entries.length === 1 ? 'enquiry' : 'enquiries'}</p>
      <ul className="enquiry-compact-list">{entries.map(entry => <li key={entry.id} data-testid={`enquiry-${entry.id}`}><button type="button" className="enquiry-record-select" aria-label={`Open enquiry for ${entry.customerName}, ${entry.reference}`} aria-pressed={selected?.id === entry.id} onClick={() => onSelect(entry.id)}>
        <span className="enquiry-record-row-heading"><strong>{entry.customerName}</strong>{callbacks && <span className={`enquiry-callback-badge enquiry-callback-${callbackTiming(entry)}`}>{callbackTiming(entry) === 'overdue' ? 'Overdue now' : callbackTiming(entry) === 'upcoming' ? 'Upcoming' : 'Needs a time'}</span>}</span>
        <span className="enquiry-record-row-car">{entry.vehicleTitle || 'General showroom enquiry'}{entry.vehicleRegistration ? ` · ${entry.vehicleRegistration}` : ''}</span>
        <span className="enquiry-record-row-meta">{entry.assignedToName || 'Unassigned'} · {entry.reference}{callbacks && entry.source === 'website_callback' ? ' · Website request' : ''}{!callbacks && enquiryGroup(entry, allEntries).length > 1 ? ` · ${enquiryGroup(entry, allEntries).length} merged records` : ''}</span>
        {callbacks && <span className="enquiry-record-row-meta">{entry.phone || entry.email || 'Contact not supplied'}{entry.createdAt ? ` · Requested ${appointmentLabel(entry.createdAt)}` : ''}</span>}
        <span className="enquiry-record-row-next">{callbacks && entry.followUpAt ? `Due ${appointmentLabel(entry.followUpAt)}` : nextAction(entry)}</span>
      </button></li>)}</ul>
    </div>
    <div ref={detail} tabIndex={-1} className="enquiry-record-detail-pane" role="region" aria-label={`Selected enquiry: ${selected.customerName}`}>
      <Button className="enquiry-record-back" size="sm" variant="outline" onClick={() => { onBack(); requestAnimationFrame(() => { list.current?.focus(); list.current?.scrollIntoView({ block: 'start' }); }); }}><ArrowLeft aria-hidden className="mr-1 h-4 w-4" />Back to {callbacks ? 'callbacks' : 'enquiries'}</Button>
      <EnquiryDetail key={selected.id} entry={selected} car={cars.find(car => car.id === selected.vehicleId)} actions={actions} />
      {group.length > 1 && <section className="enquiry-linked-originals" aria-label="Merged case original records"><h4>Merged case · {primary?.reference}</h4><p className="text-xs text-muted-foreground">Each original keeps its customer, car, appointments, follow-ups and conversation history.</p>{group.filter(item => item.id !== selected.id).map(original => <details key={original.id} className="enquiry-linked-original" onToggle={event => { const open = event.currentTarget.open; setOpenedOriginals(current => { const next = new Set(current); if (open) next.add(original.id); else next.delete(original.id); return next; }); }}><summary>{original.customerName} · {original.reference}{original.id === primary?.id ? ' · Main record' : ''}<span>{original.vehicleTitle || 'General showroom enquiry'}{original.vehicleRegistration ? ` · ${original.vehicleRegistration}` : ''}</span></summary>{openedOriginals.has(original.id) && <div><EnquiryDetail entry={original} car={cars.find(car => car.id === original.vehicleId)} actions={actions} /></div>}</details>)}</section>}
    </div>
  </div>;
}
