import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { customFetch, type Enquiry } from '@workspace/api-client-react';
import { GitMerge, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { deskMatches } from '@/lib/enquiry-desk-model';
import { appointmentLabel } from '@/lib/test-drive-dates';
import { differingMergeContacts, hasActiveAppointment, mergeGroup, mergeRequest, mergeRoot, overlappingMergeAppointments } from './enquiry-merge-model';
import './enquiry-merge.css';

export type MergeResult = { primaryId: string; recordIds: string[]; cancelledAppointmentIds: string[] };
function mergeError(error: unknown) {
  if (error && typeof error === 'object' && 'data' in error && error.data && typeof error.data === 'object' && 'error' in error.data && typeof error.data.error === 'string') return error.data.error;
  return 'The records could not be merged. Your selections are still here.';
}
const isConflict = (error: unknown) => Boolean(error && typeof error === 'object' && 'status' in error && error.status === 409);

function OriginalSummary({ entry, main = false }: { entry: Enquiry; main?: boolean }) {
  return <div className="enquiry-merge-source"><p className="enquiry-merge-source-heading"><strong>{entry.customerName}</strong>{main && <span>Main record</span>}</p><p>{entry.reference} · {entry.type.replace('_', ' ')} · {entry.source.replaceAll('_', ' ')}</p><p>{entry.phone || 'No phone'}{entry.email ? ` · ${entry.email}` : ''}</p><p>{entry.vehicleTitle || 'General showroom enquiry'}{entry.vehicleRegistration ? ` · ${entry.vehicleRegistration}` : ''}</p>{entry.createdAt && <p>Received {appointmentLabel(entry.createdAt)}</p>}{entry.followUpAt && !entry.followUpCompletedAt && <p>Follow-up {appointmentLabel(entry.followUpAt)}</p>}{entry.message && <p className="enquiry-merge-message">{entry.message}</p>}{entry.staffNote && <p className="enquiry-merge-message">Internal note: {entry.staffNote}</p>}</div>;
}

export function EnquiryMergeDialog({ entry, entries, onRefresh, onClose, onSaved }: { entry: Enquiry; entries: Enquiry[]; onRefresh: () => Promise<Enquiry[]>; onClose: () => void; onSaved: (result: MergeResult) => void | Promise<void> }) {
  const [snapshot, setSnapshot] = useState(entries);
  const [primaryId] = useState(() => mergeRoot(entry, entries)?.id ?? entry.id);
  const initialGroup = mergeGroup(entry, entries);
  const [selectedIds, setSelectedIds] = useState(() => initialGroup.map(item => item.id));
  const [keepIds, setKeepIds] = useState(() => initialGroup.filter(hasActiveAppointment).map(item => item.id));
  const [search, setSearch] = useState('');
  const [reason, setReason] = useState('');
  const [differentConfirmed, setDifferentConfirmed] = useState(false);
  const [overlapConfirmed, setOverlapConfirmed] = useState(false);
  const [cancelConfirmed, setCancelConfirmed] = useState(false);
  const [review, setReview] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const busy = useRef(false);
  const mutation = useMutation({ mutationFn: (data: ReturnType<typeof mergeRequest>) => customFetch<MergeResult>(`/api/staff/enquiries/${encodeURIComponent(primaryId)}/merge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), responseType: 'json' }), retry: false });
  const primary = snapshot.find(item => item.id === primaryId);
  const records = snapshot.filter(item => selectedIds.includes(item.id));
  const missing = selectedIds.some(id => !snapshot.some(item => item.id === id));
  const primaryGroup = primary ? mergeGroup(primary, snapshot) : [];
  const candidates = snapshot.filter(item => !mergeRoot(item, snapshot)?.mergedIntoId && mergeRoot(item, snapshot)?.id === item.id && item.id !== primaryId).filter(item => mergeGroup(item, snapshot).some(source => deskMatches(search, [source.customerName, source.email, source.phone, source.reference, source.vehicleTitle, source.vehicleRegistration])));
  const appointments = records.filter(hasActiveAppointment);
  const cancelled = appointments.filter(item => !keepIds.includes(item.id));
  const kept = appointments.filter(item => keepIds.includes(item.id));
  const different = differingMergeContacts(records);
  const overlaps = overlappingMergeAppointments(kept);
  const available = Boolean(primary && !('mergedIntoId' in primary && primary.mergedIntoId) && !missing && primaryGroup.every(item => selectedIds.includes(item.id)));
  const valid = available && records.length >= 2 && records.length <= 20 && reason.trim().length >= 2 && reason.trim().length <= 1000 && (!different || differentConfirmed) && (!overlaps.length || overlapConfirmed) && (!cancelled.length || cancelConfirmed);
  const locked = mutation.isPending || refreshing;
  function resetReview() { setReview(false); setDifferentConfirmed(false); setOverlapConfirmed(false); setCancelConfirmed(false); setError(''); }
  function toggleCandidate(candidate: Enquiry) {
    const group = mergeGroup(candidate, snapshot);
    const ids = group.map(item => item.id);
    const selected = ids.every(id => selectedIds.includes(id));
    resetReview();
    setSelectedIds(current => selected ? current.filter(id => !ids.includes(id)) : [...new Set([...current, ...ids])]);
    setKeepIds(current => selected ? current.filter(id => !ids.includes(id)) : [...new Set([...current, ...group.filter(hasActiveAppointment).map(item => item.id)])]);
  }
  async function refreshRecords() {
    if (busy.current) return;
    setRefreshing(true);
    try {
      const fresh = await onRefresh();
      // Keep staff choices and add newly linked originals to every selected group.
      const expanded = [...new Set(selectedIds.flatMap(id => { const source = fresh.find(item => item.id === id); return source ? mergeGroup(source, fresh).map(item => item.id) : [id]; }))];
      const newlySelected = fresh.filter(item => expanded.includes(item.id) && !selectedIds.includes(item.id));
      const newlyBooked = fresh.filter(item => expanded.includes(item.id) && hasActiveAppointment(item) && !snapshot.find(old => old.id === item.id && hasActiveAppointment(old)));
      setSelectedIds(expanded);
      setKeepIds(current => [...new Set([...current, ...newlySelected.filter(hasActiveAppointment).map(item => item.id), ...newlyBooked.map(item => item.id)])]);
      setSnapshot(fresh); setConflict(false); resetReview();
      setError('Records refreshed. Check the details and appointment choices, then review the merge again.');
    } catch { setError('Records could not be refreshed. Your selections are still here; try refreshing again.'); }
    finally { setRefreshing(false); }
  }
  async function submit() {
    if (!valid || !review || conflict || busy.current) return;
    busy.current = true; setError('');
    try { const result = await mutation.mutateAsync(mergeRequest(records, kept.map(item => item.id), reason, differentConfirmed, overlapConfirmed)); await onSaved(result); }
    catch (cause) { setError(mergeError(cause)); if (isConflict(cause)) { setConflict(true); setReview(false); } }
    finally { busy.current = false; }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy.current && !refreshing) onClose(); }}><DialogContent className="portal-action-dialog enquiry-action-dialog enquiry-merge-dialog">
    <DialogHeader><DialogTitle className="pr-12">Merge enquiries & appointments</DialogTitle><DialogDescription>Bring related records into one case. Original customer, car, messages and history stay on each record.</DialogDescription></DialogHeader>
    {!available && <p role="alert" className="enquiry-merge-warning">The main record or a linked original has changed or could not be loaded. Refresh records before continuing.</p>}
    {primary && <section aria-label="Main record" className="enquiry-merge-primary"><OriginalSummary entry={primary} main /><p>The merged case opens at {primary.reference}. Existing appointments and follow-ups remain on their original records.</p>{primaryGroup.length > 1 && <p>{primaryGroup.length - 1} already linked {primaryGroup.length === 2 ? 'record is' : 'records are'} included automatically.</p>}</section>}
    <fieldset disabled={locked || conflict} className="enquiry-merge-fields">
      {!review && <section aria-label="Choose records to merge"><h3>Choose records <span>{records.length} / 20</span></h3><label className="enquiry-merge-search"><Search aria-hidden className="h-4 w-4" /><span className="sr-only">Search records to merge</span><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Name, email, phone, reference or car" /></label><div className="enquiry-merge-candidates">{candidates.map(candidate => { const group = mergeGroup(candidate, snapshot); const checked = group.every(item => selectedIds.includes(item.id)); return <label key={candidate.id} className="enquiry-merge-choice"><input type="checkbox" checked={checked} disabled={!checked && records.length + group.length > 20} onChange={() => toggleCandidate(candidate)} aria-label={`Include ${candidate.reference}, ${candidate.customerName}`} /><div><OriginalSummary entry={candidate} />{group.length > 1 && <p>{group.length} linked original records included together</p>}</div></label>; })}{!candidates.length && <p className="text-sm text-muted-foreground">No other matching records. Try a customer contact or reference.</p>}</div></section>}
      <section aria-label={review ? 'Records included in merge review' : 'Selected original records'}><h3>{review ? 'Review these records' : 'Selected originals'} <span>{records.length}</span></h3><div className="enquiry-merge-originals">{records.map(item => <OriginalSummary key={item.id} entry={item} main={item.id === primaryId} />)}</div></section>
      <section aria-label="Appointments to keep"><h3>Appointments</h3><p className="text-sm text-muted-foreground">Checked appointments stay active with their current time and customer link. Unchecking an appointment explicitly cancels it.</p><div className="enquiry-merge-appointments">{appointments.map(item => <label key={item.id} className="enquiry-merge-choice"><input type="checkbox" checked={keepIds.includes(item.id)} disabled={review} aria-label={`Keep appointment ${item.reference}`} onChange={event => { resetReview(); setKeepIds(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id)); }} /><span><strong>{keepIds.includes(item.id) ? 'Keep' : 'Cancel'} · {item.reference}</strong><span>{appointmentLabel(item.appointmentAt!)} · {item.appointmentDurationMinutes ?? 30} minutes · {item.appointmentStatus === 'pending' ? 'Awaiting approval' : 'Confirmed'}</span><span>{item.customerName} · {item.vehicleTitle || 'Vehicle to be arranged'}</span></span></label>)}{!appointments.length && <p className="text-sm text-muted-foreground">No active appointments on these records.</p>}</div></section>
      <label className="grid gap-1.5 text-sm font-medium">Reason for merging<Textarea rows={2} required minLength={2} maxLength={1000} readOnly={review} value={reason} onChange={event => { resetReview(); setReason(event.target.value); }} placeholder="For example: same visit discussed in separate enquiries" /></label>
      {different && <div className="enquiry-merge-warning"><p>Customer contacts differ or cannot be matched. Check every original contact before combining the case.</p><label><input type="checkbox" checked={differentConfirmed} onChange={event => setDifferentConfirmed(event.target.checked)} />I have checked the different customer contacts and want one case.</label></div>}
      {overlaps.length > 0 && <div className="enquiry-merge-warning"><p>Kept appointments overlap: {overlaps.map(([a, b]) => `${a.reference} + ${b.reference}`).join('; ')}.</p><label><input type="checkbox" checked={overlapConfirmed} onChange={event => setOverlapConfirmed(event.target.checked)} />Keep these overlapping appointments.</label></div>}
      {cancelled.length > 0 && <div className="enquiry-merge-warning"><p>Cancel {cancelled.length} {cancelled.length === 1 ? 'appointment' : 'appointments'}: {cancelled.map(item => `${item.reference} — ${appointmentLabel(item.appointmentAt!)}`).join('; ')}.</p><label><input type="checkbox" checked={cancelConfirmed} onChange={event => setCancelConfirmed(event.target.checked)} />I confirm cancellation of the appointments listed above.</label></div>}
      {records.length > 20 && <p role="alert" className="text-sm text-destructive">Choose no more than 20 original records, including existing linked records.</p>}
    </fieldset>
    {review && <p className="enquiry-merge-review-note">{records.length} original records → {primary?.reference}. {kept.length} appointments kept; {cancelled.length} cancelled. Follow-up tasks and all conversation history are retained.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {conflict && <p className="text-sm">A record changed while you were reviewing. Refresh and review the latest details before submitting again.</p>}
    <div className="enquiry-merge-footer">{conflict || !available ? <Button type="button" disabled={locked} onClick={() => void refreshRecords()}>{refreshing ? 'Refreshing…' : 'Refresh records'}</Button> : review ? <><Button type="button" disabled={locked || !valid} onClick={() => void submit()}><GitMerge aria-hidden className="mr-2 h-4 w-4" />{mutation.isPending ? 'Merging…' : 'Merge records'}</Button><Button type="button" variant="outline" disabled={locked} onClick={() => setReview(false)}>Back to choices</Button></> : <Button type="button" disabled={locked || !valid} onClick={() => setReview(true)}>Review merge</Button>}<Button type="button" variant="outline" disabled={locked} onClick={onClose}>Cancel</Button></div>
  </DialogContent></Dialog>;
}
