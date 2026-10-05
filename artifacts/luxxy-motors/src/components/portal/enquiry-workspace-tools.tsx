import { useState } from 'react';
import { Link } from 'wouter';
import { customerHistoryHref } from './history-links';
import { useQueryClient } from '@tanstack/react-query';
import { useGetStaffDirectory, useUpdateEnquiryWorkspace, useChangeStaffFollowUp, getGetEnquiriesQueryKey, getGetTestDriveBookingsQueryKey, type Enquiry, type StaffOnlineReservation } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { appointmentLabel, londonDate } from '@/lib/test-drive-dates';
import { callOutcomes, sameCustomer, nextAction, type CallOutcome } from '@/lib/enquiry-desk-model';
import { attendanceError } from '../../../../api-server/src/lib/enquiry-workspace';
import { AppointmentExceptionLabels } from './enquiry-calendar';

export function workspaceError(error: unknown) {
  const e = error as { data?: { error?: string } };
  return e?.data?.error || 'Could not save. Refresh and try again; your notes are still here.';
}
export function useRefreshDesk() {
  const client = useQueryClient();
  return () => Promise.all([client.invalidateQueries({ queryKey: getGetEnquiriesQueryKey() }), client.invalidateQueries({ queryKey: getGetTestDriveBookingsQueryKey() })]);
}
export function OwnerSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const query = useGetStaffDirectory();
  return <label className="enquiry-field grid gap-1.5 text-sm font-medium">Assigned to
    <NativeSelect value={value} onChange={event => onChange(event.target.value)} disabled={query.isLoading || query.isError}>
      <option value="">Unassigned</option>
      {value && !query.data?.members.some(member => member.id === value) && <option value={value}>Current owner</option>}
      {query.data?.members.map(member => <option key={member.id} value={member.id}>{member.name}{member.id === query.data.currentUserId ? ' (you)' : ''}</option>)}
    </NativeSelect>{query.isError && <span className="text-xs text-destructive">Staff directory unavailable. Use Refresh to retry.</span>}
  </label>;
}

export function WorkspaceEditor({ entry, onClose }: { entry: Enquiry; onClose: () => void }) {
  const [owner, setOwner] = useState(entry.assignedToId ?? '');
  const [outcome, setOutcome] = useState(entry.callOutcome ?? '');
  const [note, setNote] = useState(entry.staffNote ?? '');
  const mutation = useUpdateEnquiryWorkspace();
  const refresh = useRefreshDesk();
  async function save() {
    try { await mutation.mutateAsync({ id: entry.id, data: { expectedRevision: entry.workspaceRevision ?? 0, assignedToId: owner || null, callOutcome: (outcome || null) as CallOutcome | null, staffNote: note || null } }); await refresh(); onClose(); } catch {}
  }
  return <Dialog open onOpenChange={open => { if (!open && !mutation.isPending) onClose(); }}><DialogContent className="portal-action-dialog enquiry-action-dialog"><DialogHeader><DialogTitle>Update enquiry</DialogTitle><DialogDescription>{entry.customerName} · {entry.reference}</DialogDescription></DialogHeader>
    <OwnerSelect value={owner} onChange={setOwner} />
    <label className="grid gap-1.5 text-sm font-medium">Call outcome<NativeSelect value={outcome} onChange={e => setOutcome(e.target.value)}><option value="">Not recorded</option>{Object.entries(callOutcomes).map(([value, label]) => <option key={value} value={value} disabled={value === 'test_drive_booked' ? !entry.appointmentAt || Boolean(entry.appointmentCancelledAt) : value === 'callback_requested' ? !entry.followUpAt || Boolean(entry.followUpCompletedAt) : false}>{label}</option>)}</NativeSelect></label>
    <label className="grid gap-1.5 text-sm font-medium">Internal note<Textarea value={note} onChange={e => setNote(e.target.value)} maxLength={2000} rows={4} /></label>
    <p className="text-xs text-muted-foreground">Original call notes are retained. Schedule a follow-up from the enquiry before choosing Callback requested.</p>
    {mutation.isError && <p role="alert" className="text-sm text-destructive">{workspaceError(mutation.error)}</p>}
    <Button onClick={() => void save()} disabled={mutation.isPending}>{mutation.isPending ? 'Saving…' : 'Save enquiry update'}</Button>
  </DialogContent></Dialog>;
}

export function AttendanceControls({ entry }: { entry: Enquiry }) {
  const mutation = useUpdateEnquiryWorkspace();
  const refresh = useRefreshDesk();
  if (!entry.appointmentAt || entry.appointmentCancelledAt) return null;
  const current = entry.attendance ?? 'scheduled';
  const options = current === 'arrived' ? [{ value: 'completed' as const, label: 'Complete visit' }, { value: 'scheduled' as const, label: 'Undo arrival' }] : ['completed','no_show'].includes(current) ? [{ value: 'scheduled' as const, label: 'Undo attendance' }] : [{ value: 'arrived' as const, label: 'Mark arrived' }, { value: 'no_show' as const, label: 'Mark no-show' }];
  return <div className="enquiry-attendance space-y-2"><p className="text-xs font-semibold">Attendance: {current.replace('_', ' ')}</p><div className="flex flex-wrap gap-2">{options.map(option => <Button key={option.value} size="sm" variant="outline" disabled={mutation.isPending || Boolean(attendanceError(entry, option.value))} title={attendanceError(entry, option.value) ?? undefined} onClick={async () => { try { await mutation.mutateAsync({ id: entry.id, data: { expectedRevision: entry.workspaceRevision ?? 0, expectedAppointmentRevision: entry.appointmentRevision ?? 0, attendance: option.value } }); await refresh(); } catch {} }}>{option.label}</Button>)}</div>{mutation.isError && <p role="alert" className="text-xs text-destructive">{workspaceError(mutation.error)}</p>}</div>;
}

export function NextAction({ entry }: { entry: Enquiry }) {
  const mutation = useChangeStaffFollowUp();
  const refresh = useRefreshDesk();
  const outstanding = entry.followUpAt && !entry.followUpCompletedAt;
  return <div className="enquiry-next-action mt-3 flex flex-wrap items-center justify-between gap-2 rounded border border-blue-100 bg-blue-50/60 p-3 text-sm"><div><p className="text-xs font-semibold text-slate-600">Next action</p><p className="mt-1 font-medium">{nextAction(entry)}</p>{outstanding && <p className="text-xs text-slate-600">{appointmentLabel(entry.followUpAt!)}{Date.parse(entry.followUpAt!) <= Date.now() ? ' · Overdue' : ''}</p>}</div>{outstanding && <Button size="sm" variant="outline" disabled={mutation.isPending} onClick={async () => { try { await mutation.mutateAsync({ id: entry.id, data: { action: 'complete', expectedRevision: entry.followUpRevision ?? 0 } }); await refresh(); } catch {} }}>Done</Button>}{mutation.isError && <p role="alert" className="w-full text-destructive">{workspaceError(mutation.error)}</p>}</div>;
}

export type Contact = { customerName: string; phone?: string | null; email?: string | null };
export function CustomerHistory({ contact, enquiries, reservations, onReuse, compact = false }: { contact: Contact; enquiries: Enquiry[]; reservations: StaffOnlineReservation[]; onReuse?: (contact: Contact) => void; compact?: boolean }) {
  const matched = enquiries.filter(entry => sameCustomer(contact, entry));
  const holds = reservations.filter(entry => sameCustomer(contact, entry));
  const timeline = [...matched.map(entry => ({ id: `e-${entry.id}`, recordType: 'enquiry' as const, recordId: entry.id, at: entry.createdAt || entry.updatedAt || "", name: entry.customerName, phone: entry.phone, email: entry.email, title: `${entry.reference} · ${entry.vehicleTitle || 'General enquiry'}`, body: [entry.appointmentAt ? `${entry.appointmentCancelledAt ? 'Cancelled appointment' : 'Appointment'}: ${appointmentLabel(entry.appointmentAt)}` : 'Enquiry', entry.callOutcome ? callOutcomes[entry.callOutcome as CallOutcome] : null, entry.message, entry.staffNote, entry.assignedToName ? `Owner: ${entry.assignedToName}` : null].filter(Boolean).join(' · ') })), ...holds.map(entry => ({ id: `r-${entry.id}`, recordType: 'reservation' as const, recordId: entry.id, at: entry.createdAt || "", name: entry.customerName, phone: entry.phone, email: entry.email, title: `${entry.reference} · ${entry.vehicleTitle}`, body: `Online reservation · ${entry.status}` }))].sort((a,b) => b.at.localeCompare(a.at));
  if (!timeline.length) return null;
  const history = <section className="enquiry-customer-history rounded border border-blue-200 bg-blue-50/40 p-3"><h3 className="font-semibold">Customer history · {timeline.length} records</h3><p className="mt-1 text-xs text-muted-foreground">Matched by phone or email. Check the name before reusing details; a household may share contact details.</p><div className="mt-3 max-h-80 space-y-3 overflow-y-auto">{(compact ? timeline.slice(0, 3) : timeline).map(item => <article key={item.id} className="border-t border-blue-100 pt-2 text-sm"><p className="font-semibold">{item.name}</p><p>{item.title}</p><p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{item.body}</p><p className="mt-1 text-xs">{item.at ? new Date(item.at).toLocaleDateString('en-GB') : 'Date not supplied'}</p><Link className="mt-2 inline-flex min-h-11 items-center text-xs font-medium text-primary underline underline-offset-4" href={customerHistoryHref(item.recordType, item.recordId)}>Open full customer history</Link>{onReuse && <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => onReuse({ customerName: item.name, phone: item.phone, email: item.email })}>Use {item.name}’s details</Button>}</article>)}</div>{compact && timeline.length > 3 && <details className="mt-2 text-sm"><summary className="cursor-pointer py-2">View all {timeline.length} records</summary><CustomerHistory contact={contact} enquiries={enquiries} reservations={reservations} onReuse={onReuse} /></details>}</section>;
  return compact ? <details className="enquiry-linked-history"><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">Customer history · {timeline.length} records</summary>{history}</details> : history;
}

export function TodayDesk({ entries, onOpen }: { entries: Enquiry[]; onOpen: (entry: Enquiry) => void }) {
  const today = londonDate();
  const appointments = entries.filter(e => e.appointmentAt && !e.appointmentCancelledAt && londonDate(new Date(e.appointmentAt)) === today).sort((a,b) => a.appointmentAt!.localeCompare(b.appointmentAt!));
  const due = entries.filter(e => e.followUpAt && !e.followUpCompletedAt && londonDate(new Date(e.followUpAt)) <= today).sort((a,b) => a.followUpAt!.localeCompare(b.followUpAt!));
  const waiting = entries.filter(e => e.status === 'new' && !e.callOutcome && !e.appointmentAt && !e.followUpAt);
  const overdue = due.filter(entry => Date.parse(entry.followUpAt!) <= Date.now()).length;
  return <section className="enquiry-today-desk space-y-5"><div><h3 className="text-xl font-semibold">Today in the showroom</h3><p className="text-sm text-muted-foreground">{new Date().toLocaleDateString('en-GB', { timeZone: 'Europe/London', dateStyle: 'full' })} · UK time</p></div><div className="grid gap-4 xl:grid-cols-3">{[{ title: 'Appointments today', rows: appointments }, { title: 'Follow-ups today', rows: due }, { title: 'Waiting for a reply', rows: waiting }].map(group => <section key={group.title} className="enquiry-today-group min-w-0 rounded border border-slate-200 bg-white p-4"><h4 className="mb-3 font-semibold">{group.title} <span className="ml-1 rounded-full bg-slate-100 px-2 py-1 text-sm">{group.rows.length}</span></h4>{group.title === 'Follow-ups today' && <p className="mb-3 text-xs text-muted-foreground">{overdue} overdue now · {due.length - overdue} later today</p>}<ul className="space-y-4">{group.rows.map(entry => <li key={entry.id} className="border-t pt-3"><button className="text-left font-semibold text-blue-900 underline underline-offset-4" onClick={() => onOpen(entry)}>{entry.customerName} · {entry.reference}</button><p className="mt-1 text-sm">{entry.vehicleTitle || 'General enquiry'}</p>{group.title === 'Appointments today' && <><p className="my-2 text-sm">{appointmentLabel(entry.appointmentAt!)}</p><AttendanceControls entry={entry} /><AppointmentExceptionLabels booking={entry} /></>}{group.title === 'Follow-ups today' && <p className="mt-2 text-xs font-medium">{Date.parse(entry.followUpAt!) <= Date.now() ? 'Overdue now' : 'Due later today'}</p>}<p className="mt-1 text-xs text-muted-foreground">{entry.assignedToName || 'Unassigned'}</p><NextAction entry={entry} /></li>)}</ul>{!group.rows.length && <p className="py-5 text-sm text-muted-foreground">Nothing to show here.</p>}</section>)}</div></section>;
}
