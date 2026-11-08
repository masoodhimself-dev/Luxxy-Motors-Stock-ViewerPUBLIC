import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import type { SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { ChevronDown, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { requestUuid } from '@/lib/request-uuid';

type StaffDirectory = { currentUserId: string; members: Array<{ id: string; name: string }> };

export function SaleTeamAssignment({ sale, canManage, disabled, onSaved, onSaving, onDirtyChange }: {
  sale: SaleWorkspaceRecord;
  canManage: boolean;
  disabled: boolean;
  onSaved: (sale: SaleWorkspaceRecord) => void;
  onSaving: (saving: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [edits, setEdits] = useState<{ ownerId: string; note: string; baseRevision: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [problem, setProblem] = useState('');
  const retry = useRef<{ signature: string; requestId: string } | null>(null);
  const directory = useQuery({
    queryKey: ['staff-directory', window.location.host],
    queryFn: ({ signal }) => customFetch<StaffDirectory>('/api/staff/directory', { signal }),
    enabled: expanded && canManage,
    retry: false,
  });
  const ownerId = edits?.ownerId ?? sale.team?.ownerId ?? '';
  const note = edits?.note ?? sale.team?.note ?? '';
  const members = directory.data?.members ?? [];
  const dirty = ownerId !== (sale.team?.ownerId ?? '') || note.trim() !== (sale.team?.note ?? '');
  const changedWhileEditing = dirty && edits?.baseRevision !== sale.revision;
  const canSave = dirty && !changedWhileEditing && !disabled && !saving;
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  const update = (next: { ownerId: string; note: string }) => {
    setEdits(current => next.ownerId === (sale.team?.ownerId ?? '') && next.note === (sale.team?.note ?? '')
      ? null : { ...next, baseRevision: current?.baseRevision ?? sale.revision });
    setMessage(''); setProblem('');
  };

  async function save() {
    if (!canSave || !edits) return;
    const input = { ownerId: ownerId || null, note: note.trim(), expectedRevision: edits.baseRevision };
    const signature = JSON.stringify(input);
    if (retry.current?.signature !== signature) retry.current = { signature, requestId: requestUuid() };
    setSaving(true); onSaving(true); setMessage(''); setProblem('');
    try {
      const result = await customFetch<{ sale: SaleWorkspaceRecord }>(`/api/sale-workspace/${encodeURIComponent(sale.id)}/team`, {
        method: 'POST', body: JSON.stringify({ ...input, requestId: retry.current.requestId }),
      });
      onSaved(result.sale); setEdits(null); retry.current = null; setMessage('Staff details saved.');
    } catch (error) {
      setProblem((error as { data?: { error?: string } })?.data?.error || 'Staff details could not be saved. Try again.');
    } finally { setSaving(false); onSaving(false); }
  }

  return <details className="sale-team-assignment" onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>
      <UserRound size={17} aria-hidden="true" />
      <strong>Sale owner</strong>
      <span>{sale.team?.ownerName || 'Unassigned'}{sale.team?.note ? ' · Staff note' : ''}</span>
      <ChevronDown size={16} aria-hidden="true" />
    </summary>
    <div className="sale-team-assignment-fields">
      {canManage ? <>
        <label htmlFor={`${id}-owner`}>Assigned to</label>
        <select id={`${id}-owner`} disabled={disabled || saving || !directory.data} value={ownerId} onChange={event => update({ ownerId: event.target.value, note })}>
          <option value="">Unassigned</option>
          {ownerId && !members.some(member => member.id === ownerId) && <option value={ownerId}>{ownerId === sale.team?.ownerId ? sale.team.ownerName : 'Previous owner'}{directory.data ? ' (unavailable)' : ''}</option>}
          {members.map(member => <option key={member.id} value={member.id}>{member.name}{member.id === directory.data?.currentUserId ? ' (you)' : ''}</option>)}
        </select>
        {directory.isPending && expanded && <p role="status">Loading staff…</p>}
        {directory.isError && <p role="alert">Staff list unavailable. <Button type="button" variant="ghost" onClick={() => void directory.refetch()}>Retry</Button></p>}
        <label htmlFor={`${id}-note`}>Staff handover note</label>
        <p id={`${id}-help`}>Only staff can see this note.</p>
        <Textarea id={`${id}-note`} aria-describedby={`${id}-help`} rows={3} maxLength={1200} disabled={disabled || saving} value={note} onChange={event => update({ ownerId, note: event.target.value })} />
        <div className="sale-team-assignment-actions"><Button type="button" variant="outline" disabled={!canSave} onClick={() => void save()}>{saving ? 'Saving…' : 'Save staff details'}</Button>
          {edits && <Button type="button" variant="ghost" disabled={saving} onClick={() => { setEdits(null); setProblem(''); }}>Discard changes</Button>}
        </div>
        {changedWhileEditing && <p role="alert">This sale changed while you were editing. Copy any text you need, then discard these changes to review the latest staff details.</p>}
        {disabled && !saving && edits && <p>Save or discard the other sale changes first.</p>}
      </> : <><strong>Staff handover note</strong><p className="sale-team-note">{sale.team?.note || 'No staff handover note.'}</p></>}
      {problem && <p role="alert">{problem}</p>}
      {message && <p role="status">{message}</p>}
      {sale.team?.updatedBy && <small>Last updated by {sale.team.updatedBy}</small>}
    </div>
  </details>;
}
