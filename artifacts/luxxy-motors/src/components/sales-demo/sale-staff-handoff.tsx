import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { customFetch, HttpApiError } from '@workspace/api-client-react';
import { saleHandoffIdentityChanged, type SaleHandoffTask, type SaleWorkspaceDraft, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { ChevronDown, ClipboardList } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { requestUuid } from '@/lib/request-uuid';
import './sale-staff-handoff.css';

type TaskKind = SaleHandoffTask['kind'];
type StaffDirectory = { members: Array<{ id: string; name: string }> };
type HandoffEdit = {
  kind: TaskKind; taskId?: string; assigneeId: string; note: string;
  baseRevision: number; baseAssigneeId: string; baseNote: string; baseDraft: SaleWorkspaceDraft;
};
type TaskCommand =
  | { action: 'assign'; kind: TaskKind; assigneeId: string; note: string }
  | { action: 'complete' | 'cancel'; taskId: string };

const taskLabels: Record<TaskKind, string> = {
  'check-payment': 'Check payment',
  'arrange-collection': 'Arrange collection',
};

function saleClosed(sale: SaleWorkspaceRecord) {
  return sale.lifecycle?.status === 'released' || sale.lifecycle?.status === 'returned' ||
    Boolean(sale.standaloneReturn) || sale.returnReplacement?.direction === 'returned';
}

function canEditTask(sale: SaleWorkspaceRecord, edit: HandoffEdit) {
  const openTask = sale.handoffTasks?.find(task => task.status === 'open' && task.kind === edit.kind);
  if (edit.kind === 'arrange-collection' && sale.draft?.fulfilment?.completedAt) return false;
  if (saleClosed(sale) && !(edit.kind === 'check-payment' && edit.taskId)) return false;
  return openTask?.id === edit.taskId;
}

function linkedTaskStatus(task: SaleHandoffTask | undefined, currentStaffId: string | undefined, canManage: boolean) {
  if (!task) return 'This staff task is no longer available.';
  if (task.status === 'completed') return 'This task has already been marked done.';
  if (task.status === 'cancelled') {
    if (task.resolutionReason === 'handover-completed') return 'This task was closed when the handover was recorded.';
    if (task.resolutionReason === 'sale-released') return 'This task was closed when the reservation was released.';
    if (task.resolutionReason === 'vehicle-returned') return 'This task was closed when the car was returned.';
    if (task.resolutionReason === 'buyer-or-car-changed') return 'This task was closed when the customer or car changed.';
    return 'This task has been cancelled.';
  }
  if (task.assigneeId !== currentStaffId) return `This task is assigned to ${task.assigneeName}.`;
  return task.kind === 'arrange-collection' && !canManage ? 'This task needs to be reassigned to someone with handover access.' : '';
}

type Props = {
  sale: SaleWorkspaceRecord;
  mode?: 'overview' | TaskKind;
  canManage: boolean;
  currentStaffId?: string;
  focusedTaskId?: string;
  focusRequest?: number;
  disabled?: boolean;
  onSaved: (sale: SaleWorkspaceRecord, options?: { reloaded: true }) => void;
  onSaving: (saving: boolean) => void;
  onDirtyChange: (dirty: boolean) => void;
};

export function SaleStaffHandoff({
  sale, mode = 'overview', canManage, currentStaffId, focusedTaskId, focusRequest, disabled = false, onSaved, onSaving, onDirtyChange,
}: Props) {
  const id = useId();
  const [expanded, setExpanded] = useState(mode !== 'overview' || Boolean(focusedTaskId));
  const [edit, setEdit] = useState<HandoffEdit | null>(null);
  const [saving, setSaving] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const [problem, setProblem] = useState('');
  const [message, setMessage] = useState('');
  const editorHeading = useRef<HTMLHeadingElement>(null);
  const summary = useRef<HTMLElement>(null);
  const taskFocus = useRef<HTMLElement>(null);
  const editorOpener = useRef<HTMLElement | null>(null);
  const returnEditorFocus = useRef(false);
  const active = useRef(true);
  const lock = useRef(false);
  const latest = useRef(sale);
  latest.current = sale;
  const retry = useRef<{ signature: string; requestId: string } | undefined>(undefined);
  const activeTasks = (sale.handoffTasks ?? []).filter(task => task.status === 'open' && (mode === 'overview' || task.kind === mode));
  const linkedTask = focusedTaskId ? sale.handoffTasks?.find(task => task.id === focusedTaskId) : undefined;
  const linkedStatus = focusedTaskId ? linkedTaskStatus(linkedTask, currentStaffId, canManage) : '';
  const focusLinkedRow = linkedTask?.status === 'open' && (canManage || !linkedStatus);
  const editing = Boolean(edit);
  const editingKind = edit?.kind;
  const editingTask = edit?.taskId ? activeTasks.find(task => task.id === edit.taskId) : undefined;
  const manageOverview = canManage && mode === 'overview';
  const closed = saleClosed(sale);
  const canAssign = manageOverview && !closed;
  const canArrangeCollection = !sale.draft?.fulfilment?.completedAt;
  const availableKinds = (Object.keys(taskLabels) as TaskKind[]).filter(kind =>
    (kind !== 'arrange-collection' || canArrangeCollection) && !activeTasks.some(task => task.kind === kind));
  const [nextKind] = availableKinds;
  const editIdentityChanged = Boolean(edit && saleHandoffIdentityChanged(edit.baseDraft, sale.draft));
  const editInvalid = Boolean(edit && (editIdentityChanged || !canEditTask(sale, edit)));
  const stale = Boolean(edit && edit.baseRevision !== sale.revision);
  const reloadNeeded = needsReload || (stale && !editInvalid);
  const directory = useQuery({
    queryKey: ['sale-workspace', 'handoff-assignees', sale.id, editingKind],
    queryFn: ({ signal }) => customFetch<StaffDirectory>(`/api/sale-workspace/${encodeURIComponent(sale.id)}/handoff-tasks?kind=${editingKind ?? ''}`, { signal }),
    enabled: manageOverview && Boolean(editingKind) && !editInvalid,
    retry: false,
  });
  const dirty = Boolean(edit && (edit.assigneeId !== edit.baseAssigneeId || edit.note.trim() !== edit.baseNote));
  const editingDisabled = disabled || saving || reloadNeeded || editInvalid || !manageOverview;
  const mutationDisabled = disabled || saving || reloadNeeded;
  const assignedMember = directory.data?.members.find(member => member.id === edit?.assigneeId);

  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  useEffect(() => {
    if (!focusedTaskId) return;
    setExpanded(true);
    const frame = requestAnimationFrame(() => (taskFocus.current ?? summary.current)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [focusedTaskId, focusRequest]);
  useEffect(() => {
    if (editing) editorHeading.current?.focus();
    else if (returnEditorFocus.current) {
      returnEditorFocus.current = false;
      const opener = editorOpener.current;
      (opener?.isConnected && !opener.matches(':disabled') ? opener : summary.current)?.focus();
    }
  }, [editing]);

  function startEdit(opener: HTMLElement, kind: TaskKind, task?: SaleHandoffTask) {
    editorOpener.current = opener;
    const assigneeId = task?.assigneeId ?? '';
    const note = task?.note ?? '';
    setEdit({
      kind, taskId: task?.id, assigneeId, note,
      baseRevision: sale.revision, baseAssigneeId: assigneeId, baseNote: note, baseDraft: sale.draft,
    });
    setProblem('');
    setMessage('');
  }

  function closeEditor() {
    returnEditorFocus.current = true;
    setEdit(null);
  }

  async function save(command: TaskCommand, expectedRevision = sale.revision) {
    if (mutationDisabled || lock.current) return;
    const input = { ...command, expectedRevision };
    const signature = JSON.stringify(input);
    if (retry.current?.signature !== signature) retry.current = { signature, requestId: requestUuid() };
    lock.current = true;
    setSaving(true);
    onSaving(true);
    setMessage('');
    setProblem('');
    try {
      const result = await customFetch<{ sale: SaleWorkspaceRecord }>(`/api/sale-workspace/${encodeURIComponent(sale.id)}/handoff-tasks`, {
        method: 'POST', body: JSON.stringify({ ...input, requestId: retry.current.requestId }),
      });
      if (result.sale?.id !== sale.id || !Array.isArray(result.sale.handoffTasks) || result.sale.revision <= expectedRevision) {
        throw new Error('Unexpected task response.');
      }
      if (!active.current || latest.current.id !== sale.id) return;
      if (latest.current.revision > result.sale.revision) {
        setNeedsReload(true);
        setProblem('The task changed while you were editing. Reload the sale to check it.');
        return;
      }
      onSaved(result.sale);
      if (command.action === 'assign') closeEditor();
      else summary.current?.focus();
      setMessage(command.action === 'assign' ? 'Task assigned.' : command.action === 'complete' ? 'Task marked done.' : 'Task cancelled.');
      retry.current = undefined;
    } catch (error) {
      if (!active.current) return;
      if (error instanceof HttpApiError && error.status < 500) retry.current = undefined;
      if (error instanceof HttpApiError && error.status === 409) setNeedsReload(true);
      const detail = (error as { data?: { error?: unknown } })?.data?.error;
      setProblem(typeof detail === 'string' ? detail : 'Could not save the task. Try again.');
    } finally {
      lock.current = false;
      if (active.current) setSaving(false);
      onSaving(false);
    }
  }

  async function reload() {
    if (disabled || lock.current) return;
    lock.current = true;
    setSaving(true);
    onSaving(true);
    setProblem('');
    setMessage('');
    try {
      const result = await customFetch<{ sale: SaleWorkspaceRecord }>(`/api/sale-workspace/${encodeURIComponent(sale.id)}`);
      if (!active.current || latest.current.id !== sale.id) return;
      if (result.sale?.id !== sale.id || !Number.isSafeInteger(result.sale.revision) || result.sale.revision < latest.current.revision) {
        throw new Error('Unexpected sale response.');
      }
      const canKeepEditing = edit && !saleHandoffIdentityChanged(edit.baseDraft, result.sale.draft) && canEditTask(result.sale, edit);
      onSaved(result.sale, { reloaded: true });
      if (canKeepEditing) {
        const currentTask = result.sale.handoffTasks?.find(task => task.id === edit.taskId);
        const baseAssigneeId = currentTask?.assigneeId ?? '';
        const baseNote = currentTask?.note ?? '';
        setEdit({
          ...edit, baseRevision: result.sale.revision, baseAssigneeId, baseNote, baseDraft: result.sale.draft,
          assigneeId: edit.assigneeId === edit.baseAssigneeId ? baseAssigneeId : edit.assigneeId,
          note: edit.note.trim() === edit.baseNote ? baseNote : edit.note,
        });
        void directory.refetch();
      }
      retry.current = undefined;
      setNeedsReload(false);
      setMessage(canKeepEditing ? 'Latest sale loaded. Review your changes before saving.' : 'Latest sale loaded.');
      requestAnimationFrame(() => (editorHeading.current ?? taskFocus.current ?? summary.current)?.focus());
    } catch {
      if (active.current) setProblem('Could not reload the sale. Try again.');
    } finally {
      lock.current = false;
      if (active.current) setSaving(false);
      onSaving(false);
    }
  }

  if (!activeTasks.length && !canAssign && !edit && !message && !focusedTaskId) return null;

  return <details className="sale-team-assignment sale-staff-handoff" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary ref={summary}>
      <ClipboardList size={17} aria-hidden="true" />
      <strong>Staff tasks</strong>
      <span>{activeTasks.length ? `${activeTasks.length} open` : 'No open tasks'}</span>
      <ChevronDown size={16} aria-hidden="true" />
    </summary>
    <div className="sale-team-assignment-fields">
      {linkedStatus && <p role="status" ref={focusLinkedRow ? undefined : node => { taskFocus.current = node; }}
        tabIndex={focusLinkedRow ? undefined : -1}>{linkedStatus}</p>}
      {activeTasks.length > 0 && <ul className="sale-staff-handoff-list" aria-label="Open staff tasks">
        {activeTasks.map(task => <li key={task.id}>
          <div className="sale-staff-handoff-details">
            <strong ref={task.id === focusedTaskId && focusLinkedRow ? taskFocus : undefined}
              tabIndex={task.id === focusedTaskId && focusLinkedRow ? -1 : undefined}>{taskLabels[task.kind]}</strong>
            <p>{task.assigneeName}{task.assigneeId === currentStaffId ? ' (you)' : ''}</p>
            {task.note && <p className="sale-team-note">{task.note}</p>}
          </div>
          <div className="sale-team-assignment-actions">
            {(canManage || (task.kind === 'check-payment' && task.assigneeId === currentStaffId)) && <Button type="button" variant="outline" size="sm"
              aria-label={`Mark ${taskLabels[task.kind].toLowerCase()} done`} disabled={mutationDisabled || editing}
              onClick={() => void save({ action: 'complete', taskId: task.id })}>Mark done</Button>}
            {manageOverview && (task.kind === 'check-payment' || (!closed && canArrangeCollection)) &&
              <Button type="button" variant="ghost" size="sm" aria-label={`Edit ${taskLabels[task.kind].toLowerCase()} task`}
                disabled={mutationDisabled || editing} onClick={event => startEdit(event.currentTarget, task.kind, task)}>Edit</Button>}
            {manageOverview && <Button type="button" variant="ghost" size="sm" aria-label={`Cancel ${taskLabels[task.kind].toLowerCase()} task`}
              disabled={mutationDisabled || editing} onClick={() => void save({ action: 'cancel', taskId: task.id })}>Cancel task</Button>}
          </div>
        </li>)}
      </ul>}
      {canAssign && !edit && nextKind && <div className="sale-team-assignment-actions">
        <Button type="button" size="sm" variant="outline" disabled={mutationDisabled} onClick={event => startEdit(event.currentTarget, nextKind)}>Assign a task</Button>
      </div>}
      {manageOverview && edit && <form className="sale-staff-handoff-form" aria-labelledby={`${id}-heading`}
        onSubmit={event => {
          event.preventDefault();
          if (!editingDisabled && !directory.isFetching && assignedMember && dirty) void save({ action: 'assign', kind: edit.kind, assigneeId: edit.assigneeId, note: edit.note.trim() }, edit.baseRevision);
        }}>
        <h3 id={`${id}-heading`} ref={editorHeading} tabIndex={-1}>{edit.taskId ? 'Edit staff task' : 'Assign a staff task'}</h3>
        {!edit.taskId && <label>Task
          <select value={edit.kind} disabled={editingDisabled}
            onChange={event => setEdit({ ...edit, kind: event.target.value as TaskKind, assigneeId: '' })}>
            {!availableKinds.includes(edit.kind) && <option value={edit.kind}>{taskLabels[edit.kind]}</option>}
            {availableKinds.map(kind => <option key={kind} value={kind}>{taskLabels[kind]}</option>)}
          </select>
        </label>}
        <label htmlFor={`${id}-assignee`}>Assign to</label>
        <select id={`${id}-assignee`} value={edit.assigneeId} disabled={editingDisabled || !directory.data}
          onChange={event => setEdit({ ...edit, assigneeId: event.target.value })}>
          <option value="">Choose a staff member</option>
          {edit.assigneeId && !assignedMember && <option value={edit.assigneeId}>{editingTask?.assigneeName ?? 'Previous assignee'}</option>}
          {directory.data?.members.map(member => <option key={member.id} value={member.id}>
            {member.name}{member.id === currentStaffId ? ' (you)' : ''}
          </option>)}
        </select>
        {directory.isPending && !editInvalid && <p role="status">Loading staff…</p>}
        {directory.data?.members.length === 0 && <p>No staff members are available for this task.</p>}
        {directory.isError && <p role="alert">Could not load the staff list. <Button type="button" variant="ghost" size="sm" onClick={() => void directory.refetch()}>Try again</Button></p>}
        <label htmlFor={`${id}-note`}>Staff note (optional)</label>
        <Textarea id={`${id}-note`} aria-describedby={`${id}-note-help`} rows={2} maxLength={600}
          readOnly={editingDisabled} value={edit.note} onChange={event => setEdit({ ...edit, note: event.target.value })} />
        <p id={`${id}-note-help`}>Visible to staff only.</p>
        <div className="sale-team-assignment-actions">
          <Button type="submit" size="sm" disabled={editingDisabled || directory.isFetching || !assignedMember || !dirty}>{saving ? 'Working…' : edit.taskId ? 'Save task' : 'Assign task'}</Button>
          <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={() => { closeEditor(); if (!needsReload) setProblem(''); }}>Discard changes</Button>
        </div>
        {editInvalid && <p role="alert">{editIdentityChanged
          ? 'The customer or car changed. Copy your note if you need it, then discard this edit.'
          : 'This task is no longer available for editing. You can copy your note before discarding it.'}</p>}
      </form>}
      {problem && <p role="alert">{problem}</p>}
      {reloadNeeded && <div className="sale-team-assignment-actions">
        {stale && !problem && <p role="alert">The sale changed while you were editing. Reload it to review your changes.</p>}
        <Button type="button" size="sm" variant="outline" disabled={disabled || saving} onClick={() => void reload()}>Reload latest sale</Button>
      </div>}
      {message && <p role="status">{message}</p>}
    </div>
  </details>;
}
