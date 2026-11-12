import { SaleWorkspaceError, saleWorkspaceFingerprint, type SaleWorkspaceDraft, type SaleWorkspaceMutation, type SaleWorkspaceRecord } from './sale-workspace.ts';

export type SaleHandoffTaskKind = 'check-payment' | 'arrange-collection';
export type SaleHandoffTaskResolution = 'buyer-or-car-changed' | 'sale-released' | 'vehicle-returned' | 'handover-completed';
export type SaleHandoffAssignmentIssue = 'inactive' | 'role-changed';
export type SaleHandoffTask = {
  id: string;
  kind: SaleHandoffTaskKind;
  status: 'open' | 'completed' | 'cancelled';
  assigneeId: string;
  assigneeName: string;
  note: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  completedAt?: string;
  completedBy?: string;
  resolutionReason?: SaleHandoffTaskResolution;
};
export type SaleHandoffTaskSummary = { saleId: string; reference: string; customer: string; vehicle: string; task: SaleHandoffTask; assignmentIssue?: SaleHandoffAssignmentIssue };
type SaleHandoffTaskCursor = { createdAt: string; saleId: string; taskId: string };
export type SaleHandoffTaskListOptions = { offset: number; view: 'mine' | 'needs-reassignment'; cursor?: SaleHandoffTaskCursor };
export type SaleHandoffTaskPage = { tasks: SaleHandoffTaskSummary[]; hasMore: boolean; nextCursor?: string };
export const saleHandoffTaskPageSize = 100;

const taskNames: Record<SaleHandoffTaskKind, string> = { 'check-payment': 'Check payment', 'arrange-collection': 'Arrange collection' };
const taskIdPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const requestIdPattern = /^[A-Za-z0-9_-]{8,128}$/;
const resolutionDescriptions: Record<SaleHandoffTaskResolution, string> = {
  'buyer-or-car-changed': 'the buyer or car changed',
  'sale-released': 'the reservation was released',
  'vehicle-returned': 'the vehicle was returned',
  'handover-completed': 'collection or delivery was recorded',
};

export function isSaleHandoffTaskKind(kind: unknown): kind is SaleHandoffTaskKind {
  return kind === 'check-payment' || kind === 'arrange-collection';
}

export function saleHandoffTaskListOptions(input: { offset?: unknown; view?: unknown; cursor?: unknown }): SaleHandoffTaskListOptions {
  const raw = input.offset ?? '0';
  const offset = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(offset)) throw new SaleWorkspaceError('Choose a valid task page.', 400);
  const view = input.view ?? 'mine';
  if (view !== 'mine' && view !== 'needs-reassignment') throw new SaleWorkspaceError('Choose a valid task view.', 400);
  if (input.cursor == null) return { offset, view };
  const parts = typeof input.cursor === 'string' && input.cursor.length === 98 ? input.cursor.split('~') : [];
  const [createdAt, saleId, taskId] = parts;
  if (input.offset != null || parts.length !== 3 || !createdAt || !saleId || !taskId
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(createdAt) || !Number.isFinite(Date.parse(createdAt))
    || !taskIdPattern.test(saleId) || !taskIdPattern.test(taskId)) throw new SaleWorkspaceError('Choose a valid task page.', 400);
  return { offset, view, cursor: { createdAt, saleId: saleId.toLowerCase(), taskId: taskId.toLowerCase() } };
}

export function saleHandoffTaskSummary(sale: SaleWorkspaceRecord, task: SaleHandoffTask): SaleHandoffTaskSummary {
  return { saleId: sale.id, reference: sale.reference, customer: sale.draft.customer, vehicle: sale.draft.vehicle, task };
}

export function saleHandoffTaskKey(row: SaleHandoffTaskSummary): SaleHandoffTaskCursor {
  return { createdAt: row.task.createdAt, saleId: row.saleId, taskId: row.task.id };
}

export function compareSaleHandoffTaskKeys(a: SaleHandoffTaskCursor, b: SaleHandoffTaskCursor): number {
  const compare = (left: string, right: string) => left === right ? 0 : left < right ? -1 : 1;
  return compare(a.createdAt,b.createdAt) || compare(a.saleId,b.saleId) || compare(a.taskId,b.taskId);
}

/** The query supplies at most one extra row to determine whether more work remains. */
export function saleHandoffTaskPage(rows: SaleHandoffTaskSummary[]): SaleHandoffTaskPage {
  const tasks = rows.slice(0, saleHandoffTaskPageSize);
  const hasMore = rows.length > saleHandoffTaskPageSize;
  const last = tasks.at(-1);
  if (!hasMore || !last) return { tasks, hasMore };
  const { createdAt, saleId, taskId } = saleHandoffTaskKey(last);
  return { tasks, hasMore, nextCursor: [createdAt, saleId, taskId].join('~') };
}

export function saleCollectionTaskResolution(sale: SaleWorkspaceRecord): Exclude<SaleHandoffTaskResolution, 'buyer-or-car-changed'> | undefined {
  if (sale.lifecycle?.status === 'released') return 'sale-released';
  if (sale.lifecycle?.status === 'returned' || sale.standaloneReturn || sale.returnReplacement?.direction === 'returned') return 'vehicle-returned';
  if (sale.draft.fulfilment?.completedAt) return 'handover-completed';
  return undefined;
}

export function saleHandoffIdentityChanged(previous: SaleWorkspaceDraft, next: SaleWorkspaceDraft): boolean {
  const normal = (value: string | undefined) => (value ?? '').trim().toLowerCase();
  if (normal(previous.vehicleId) !== normal(next.vehicleId) || normal(previous.customer) !== normal(next.customer)) return true;
  if (!previous.vehicleId && (normal(previous.vehicle) !== normal(next.vehicle) || normal(previous.registration).replace(/\s/g,'') !== normal(next.registration).replace(/\s/g,''))) return true;
  // A newly supplied detail can complete the same buyer's record. A conflicting
  // previously known contact or enquiry cannot safely retain the old task note.
  return (['email', 'phone', 'sourceEnquiryId', 'sourceReservationId'] as const).some(field => {
    const before = normal(previous[field]), after = normal(next[field]);
    return Boolean(before) && (field === 'phone' ? before.replace(/[^+\d]/g,'') !== after.replace(/[^+\d]/g,'') : before !== after);
  });
}

/** Keep the original note and assignee on history. A new task always starts separately. */
export function cancelSaleHandoffTasks(sale: SaleWorkspaceRecord, reason: SaleHandoffTaskResolution, context: { now: string; actor: string; nextId: () => string }) {
  for (const task of sale.handoffTasks ?? []) {
    if (task.status !== 'open' || (reason !== 'buyer-or-car-changed' && task.kind !== 'arrange-collection')) continue;
    task.status = 'cancelled';
    task.resolutionReason = reason;
    task.updatedAt = context.now;
    task.updatedBy = context.actor;
    sale.events.push({ id: context.nextId(), type: 'handoff-task-auto-cancelled', description: `${taskNames[task.kind]} task closed because ${resolutionDescriptions[reason]}.`, actor: context.actor, occurredAt: context.now });
  }
}

export function staffSaleHandoffTasks(sale: SaleWorkspaceRecord): SaleHandoffTask[] | undefined {
  const resolution = saleCollectionTaskResolution(sale);
  return sale.handoffTasks?.map(task => task.kind === 'arrange-collection' && task.status === 'open' && resolution
    ? { ...task, status: 'cancelled', resolutionReason: resolution }
    : { ...task });
}

/** Changes only internal tasks, event history and the sale revision. */
export async function changeSaleHandoffTask(
  current: SaleWorkspaceRecord,
  input: { action?: unknown; kind?: unknown; assigneeId?: unknown; note?: unknown; taskId?: unknown; expectedRevision?: unknown; requestId?: unknown },
  context: {
    actorId: string; actor: string; canManage: boolean; canRecordPayments: boolean; now: string; nextId: () => string;
    resolveAssignee: (id: string, kind: SaleHandoffTaskKind) => Promise<string>;
  },
): Promise<SaleWorkspaceMutation> {
  const action = input.action;
  if (!context.actorId) throw new SaleWorkspaceError('Sign in to update a handoff task.', 403);
  if (action !== 'assign' && action !== 'complete' && action !== 'cancel') throw new SaleWorkspaceError('Choose a task action.');
  if (action !== 'complete' && !context.canManage) throw new SaleWorkspaceError('Your role cannot assign or cancel handoff tasks.', 403);
  const requestId = input.requestId;
  if (typeof requestId !== 'string' || !requestIdPattern.test(requestId) || Object.hasOwn(Object.prototype, requestId)) throw new SaleWorkspaceError('Check the task request reference.');
  const kind = input.kind, assigneeId = input.assigneeId, taskId = input.taskId;
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  if (action === 'assign' && (kind !== 'check-payment' && kind !== 'arrange-collection' || typeof assigneeId !== 'string' || !assigneeId.trim() || assigneeId.length > 150
    || input.note !== undefined && typeof input.note !== 'string' || note.length > 600)) throw new SaleWorkspaceError('Choose a task and a staff member. Keep notes to 600 characters.');
  if (action !== 'assign' && (typeof taskId !== 'string' || !taskIdPattern.test(taskId))) throw new SaleWorkspaceError('Choose a saved handoff task.');
  const fingerprint = saleWorkspaceFingerprint(action === 'assign'
    ? { action: 'handoff-task', actorId: context.actorId, transition: action, kind, assigneeId, note }
    : { action: 'handoff-task', actorId: context.actorId, transition: action, taskId });
  const previous = Object.hasOwn(current.requests ?? {}, requestId) ? current.requests?.[requestId] : undefined;
  if (previous) {
    if (previous.fingerprint !== fingerprint) throw new SaleWorkspaceError('This request reference has already been used for different details.', 409);
    return { sale: current, replayed: true };
  }
  if (input.expectedRevision !== current.revision) throw new SaleWorkspaceError('This sale changed on another device. Reload it before saving.', 409);
  const sale = structuredClone(current);
  const tasks = sale.handoffTasks ??= [];
  const now = context.now, actor = context.actor;
  let description: string;
  if (action === 'assign') {
    const taskKind = kind as SaleHandoffTaskKind, memberId = assigneeId as string;
    const existing = tasks.find(task => task.kind === taskKind && task.status === 'open');
    const resolution = saleCollectionTaskResolution(current);
    if (!existing && (resolution === 'sale-released' || resolution === 'vehicle-returned')) {
      throw new SaleWorkspaceError('Open an active sale before assigning a task.', 409);
    }
    if (taskKind === 'arrange-collection' && resolution) throw new SaleWorkspaceError('Collection no longer needs arranging for this sale.', 409);
    const assigneeName = await context.resolveAssignee(memberId, taskKind);
    const assignment = { assigneeId: memberId, assigneeName, note, updatedAt: now, updatedBy: actor };
    if (existing) Object.assign(existing, assignment);
    else tasks.push({ id: context.nextId(), kind: taskKind, status: 'open', ...assignment, createdAt: now, createdBy: actor });
    description = `${taskNames[taskKind]} task assigned to ${assigneeName}`;
  } else {
    const task = tasks.find(row => row.id === taskId);
    if (!task) throw new SaleWorkspaceError('Handoff task not found.', 404);
    if (!context.canManage && task.assigneeId !== context.actorId) throw new SaleWorkspaceError('Only the assigned staff member or a sales manager can complete this task.', 403);
    if (!context.canManage && (task.kind === 'arrange-collection' || !context.canRecordPayments)) throw new SaleWorkspaceError('Ask a sales manager to reassign this task. Your current role cannot complete it.', 403);
    if (task.status !== 'open') throw new SaleWorkspaceError('This handoff task is already closed.', 409);
    if (action === 'complete' && task.kind === 'arrange-collection' && saleCollectionTaskResolution(current)) throw new SaleWorkspaceError('Collection no longer needs arranging for this sale.', 409);
    task.status = action === 'complete' ? 'completed' : 'cancelled';
    task.updatedAt = now;
    task.updatedBy = actor;
    if (action === 'complete') {
      task.completedAt = now;
      task.completedBy = actor;
    }
    description = `${taskNames[task.kind]} task ${task.status}`;
  }
  sale.events.push({ id: context.nextId(), type: 'handoff-task-' + action, description, actor, occurredAt: now });
  sale.revision++;
  sale.updatedAt = now;
  (sale.requests ??= {})[requestId] = { fingerprint };
  return { sale };
}
