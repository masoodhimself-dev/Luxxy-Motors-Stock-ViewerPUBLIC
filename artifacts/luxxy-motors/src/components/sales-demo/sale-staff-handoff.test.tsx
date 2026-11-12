import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import type { SaleHandoffTask, SaleWorkspaceDraft, SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { SaleStaffHandoff } from './sale-staff-handoff';

const request = vi.hoisted(() => vi.fn());
const ApiError = vi.hoisted(() => class extends Error {
  constructor(readonly status: number, readonly data: { error: string }) { super(data.error); }
});
vi.mock('@workspace/api-client-react', () => ({ customFetch: request, HttpApiError: ApiError }));

const saleId = '00000000-0000-4000-8000-000000000001';
const paymentTask: SaleHandoffTask = {
  id: '00000000-0000-4000-8000-000000000002', kind: 'check-payment', status: 'open',
  assigneeId: 'jo', assigneeName: 'Jo West', note: 'Look for the bank transfer reference.',
  createdAt: '2026-11-11T10:00:00Z', createdBy: 'Staff',
  updatedAt: '2026-11-11T10:00:00Z', updatedBy: 'Staff',
};
const collectionTask: SaleHandoffTask = {
  ...paymentTask, id: '00000000-0000-4000-8000-000000000003', kind: 'arrange-collection',
  assigneeId: 'alex', assigneeName: 'Alex Morgan', note: 'Ask the customer which morning works.',
};
const savedDraft: SaleWorkspaceDraft = {
  id: saleId, customer: 'Ellie Carter', email: '', phone: '', address: '',
  vehicleId: 'car-1', vehicle: 'BMW 2 Series', registration: 'LM18 JTX', price: '8990',
  partExchange: false, pxRegistration: '', pxDescription: '', pxValue: '', deposit: '',
  paymentMethod: '', notes: '', collection: '', preparation: false, documents: false, handover: false,
};
const sale = (tasks: SaleHandoffTask[] = [], revision = 1, updates: Partial<SaleWorkspaceDraft> = {}) =>
  ({ id: saleId, revision, draft: { ...savedDraft, ...updates }, handoffTasks: tasks } as SaleWorkspaceRecord);
const taskPath = `/api/sale-workspace/${saleId}/handoff-tasks`;

function mount(record: SaleWorkspaceRecord, {
  canManage = true, currentStaffId = 'alex', mode = 'overview', focusedTaskId,
}: { canManage?: boolean; currentStaffId?: string; mode?: 'overview' | SaleHandoffTask['kind']; focusedTaskId?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onSaved = vi.fn(), onSaving = vi.fn(), onDirtyChange = vi.fn();
  const tree = (next: SaleWorkspaceRecord) => <QueryClientProvider client={client}>
    <SaleStaffHandoff sale={next} canManage={canManage} currentStaffId={currentStaffId} mode={mode} focusedTaskId={focusedTaskId}
      onSaved={onSaved} onSaving={onSaving} onDirtyChange={onDirtyChange} />
  </QueryClientProvider>;
  const view = render(tree(record));
  return { onSaved, onSaving, onDirtyChange, unmount: view.unmount, rerender: (next: SaleWorkspaceRecord) => view.rerender(tree(next)) };
}

function openAssignment() {
  fireEvent.click(screen.getByText('Staff tasks', { exact: true }));
  fireEvent.click(screen.getByRole('button', { name: /^Assign a task$/ }));
}

beforeEach(() => { request.mockReset(); });

it('loads eligible staff for the selected kind and saves the exact task, assignee and private note', async () => {
  const updated = sale([collectionTask], 2);
  request.mockImplementation(async (url: string) => {
    if (url.endsWith('kind=check-payment')) return { members: [{ id: 'jo', name: 'Jo West' }] };
    if (url.endsWith('kind=arrange-collection')) return { members: [{ id: 'alex', name: 'Alex Morgan' }] };
    return { sale: updated };
  });
  const view = mount(sale());
  expect(request).not.toHaveBeenCalled();
  openAssignment();
  await screen.findByRole('option', { name: /^Jo West$/ });
  fireEvent.change(screen.getByRole('combobox', { name: 'Assign to' }), { target: { value: 'jo' } });
  const taskKind = screen.getByRole('combobox', { name: /^Task$/ });
  taskKind.focus();
  fireEvent.change(taskKind, { target: { value: 'arrange-collection' } });
  expect(taskKind).toHaveFocus();
  await screen.findByRole('option', { name: /^Alex Morgan \(you\)$/ });
  expect(screen.queryByRole('option', { name: /^Jo West$/ })).not.toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Assign to' })).toHaveValue('');
  fireEvent.change(screen.getByRole('combobox', { name: 'Assign to' }), { target: { value: 'alex' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Staff note (optional)' }), { target: { value: ' Ask the customer which morning works. ' } });
  expect(view.onDirtyChange).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole('button', { name: /^Assign task$/ }));
  await screen.findByText('Task assigned.');
  expect(request.mock.calls.map(([url]) => url)).toEqual([`${taskPath}?kind=check-payment`, `${taskPath}?kind=arrange-collection`, taskPath]);
  expect(JSON.parse(request.mock.calls[2][1].body)).toEqual({
    action: 'assign', kind: 'arrange-collection', assigneeId: 'alex', note: collectionTask.note,
    expectedRevision: 1, requestId: expect.any(String),
  });
  expect(view.onSaved).toHaveBeenCalledWith(updated);
  expect(view.onSaving.mock.calls).toEqual([[true], [false]]);
  expect(view.onDirtyChange).toHaveBeenLastCalledWith(false);
});

it('shows the exact destination task to an assignee and permits completion without managing the sale', async () => {
  const updated = sale([{ ...paymentTask, status: 'completed' }, collectionTask], 2);
  request.mockResolvedValue({ sale: updated });
  const view = mount(sale([paymentTask, collectionTask]), { canManage: false, currentStaffId: 'jo', mode: 'check-payment' });
  const tasks = screen.getByRole('list', { name: 'Open staff tasks' });
  expect(tasks).toHaveTextContent('Jo West (you)');
  expect(tasks).toHaveTextContent(paymentTask.note);
  expect(tasks).not.toHaveTextContent('Arrange collection');
  expect(screen.queryByRole('button', { name: /assign|cancel|edit/i })).not.toBeInTheDocument();
  fireEvent.click(within(tasks).getByRole('button', { name: 'Mark check payment done' }));
  await screen.findByText('Task marked done.');
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0][0]).toBe(taskPath);
  expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({ action: 'complete', taskId: paymentTask.id, expectedRevision: 1 });
  expect(view.onSaved).toHaveBeenCalledWith(updated);
  view.rerender(updated);
  expect(screen.queryByRole('list', { name: 'Open staff tasks' })).not.toBeInTheDocument();
});

it('blocks unrelated staff from completing a task and lets a manager reassign or cancel it', async () => {
  const regular = mount(sale([paymentTask]), { canManage: false, currentStaffId: 'alex', mode: 'check-payment' });
  expect(screen.queryByRole('button', { name: 'Mark check payment done' })).not.toBeInTheDocument();
  expect(regular.onSaved).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
  regular.unmount();

  const reassigned = sale([{ ...paymentTask, assigneeId: 'alex', assigneeName: 'Alex Morgan' }], 2);
  const cancelled = sale([{ ...reassigned.handoffTasks![0], status: 'cancelled' }], 3);
  request
    .mockResolvedValueOnce({ members: [{ id: 'alex', name: 'Alex Morgan' }] })
    .mockResolvedValueOnce({ sale: reassigned })
    .mockResolvedValueOnce({ sale: cancelled });
  const manager = mount(sale([paymentTask]));
  fireEvent.click(screen.getByText('Staff tasks', { exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit check payment task' }));
  await screen.findByRole('option', { name: /^Alex Morgan \(you\)$/ });
  expect(screen.getByRole('textbox', { name: 'Staff note (optional)' })).toHaveValue(paymentTask.note);
  fireEvent.change(screen.getByRole('combobox', { name: 'Assign to' }), { target: { value: 'alex' } });
  fireEvent.click(screen.getByRole('button', { name: /^Save task$/ }));
  await screen.findByText('Task assigned.');
  expect(JSON.parse(request.mock.calls[1][1].body)).toMatchObject({ action: 'assign', kind: 'check-payment', assigneeId: 'alex', note: paymentTask.note });
  manager.rerender(reassigned);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel check payment task' }));
  await screen.findByText('Task cancelled.');
  expect(JSON.parse(request.mock.calls[2][1].body)).toMatchObject({ action: 'cancel', taskId: paymentTask.id, expectedRevision: 2 });
  expect(manager.onSaved).toHaveBeenLastCalledWith(cancelled);
});

it('preserves the draft on uncertainty, retries the same operation, and blocks a stale revision', async () => {
  const result = sale([paymentTask], 2);
  let attempts = 0;
  request.mockImplementation(async (_url: string, options?: RequestInit) => {
    if (options?.method !== 'POST') return { members: [{ id: 'jo', name: 'Jo West' }] };
    if (++attempts === 1) throw new Error('Lost reply');
    return { sale: result };
  });
  const view = mount(sale());
  openAssignment();
  await screen.findByRole('option', { name: /^Jo West$/ });
  fireEvent.change(screen.getByRole('combobox', { name: 'Assign to' }), { target: { value: 'jo' } });
  const note = screen.getByRole('textbox', { name: 'Staff note (optional)' });
  fireEvent.change(note, { target: { value: paymentTask.note } });
  const submit = screen.getByRole('button', { name: /^Assign task$/ });
  fireEvent.click(submit);
  await screen.findByRole('alert');
  expect(note).toHaveValue(paymentTask.note);
  fireEvent.click(submit);
  await waitFor(() => expect(view.onSaved).toHaveBeenCalledWith(result));
  expect(JSON.parse(request.mock.calls[1][1].body).requestId).toBe(JSON.parse(request.mock.calls[2][1].body).requestId);

  view.rerender(result);
  fireEvent.click(screen.getByRole('button', { name: 'Edit check payment task' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Staff note (optional)' }), { target: { value: 'My newer note' } });
  view.rerender(sale([paymentTask], 3));
  await screen.findByText('The sale changed while you were editing. Reload it to review your changes.');
  expect(screen.getByRole('button', { name: /^Save task$/ })).toBeDisabled();
  expect(screen.getByRole('textbox', { name: 'Staff note (optional)' })).toHaveValue('My newer note');
  expect(attempts).toBe(2);
});

it('reloads a revision conflict, preserves a valid draft and saves only after staff review it', async () => {
  const latest = sale([{ ...paymentTask, assigneeId: 'alex', assigneeName: 'Alex Morgan', note: 'Another member added context.' }], 3, {
    email: 'ellie@example.test',
  });
  const conflict = new ApiError(409, { error: 'This sale changed on another device. Reload it before saving.' });
  const assignees = { members: [{ id: 'jo', name: 'Jo West' }, { id: 'alex', name: 'Alex Morgan' }] };
  let attempts = 0;
  request.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url.includes('?kind=')) return assignees;
    if (options?.method !== 'POST') return { sale: latest };
    if (++attempts === 1) throw conflict;
    return { sale: sale([{ ...latest.handoffTasks![0], note: 'Unsaved staff note' }], 4) };
  });
  const view = mount(sale([paymentTask]));
  fireEvent.click(screen.getByText('Staff tasks', { exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit check payment task' }));
  await screen.findByRole('option', { name: 'Jo West' });
  const note = screen.getByRole('textbox', { name: 'Staff note (optional)' });
  const submit = screen.getByRole('button', { name: 'Save task' });
  fireEvent.change(note, { target: { value: 'Unsaved staff note' } });
  fireEvent.click(submit);
  await screen.findByText(conflict.message);
  expect(submit).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Reload latest sale' }));
  await waitFor(() => expect(view.onSaved).toHaveBeenCalledWith(latest, { reloaded: true }));
  view.rerender(latest);
  await screen.findByText('Latest sale loaded. Review your changes before saving.');
  expect(note).toHaveValue('Unsaved staff note');
  expect(screen.getByRole('combobox', { name: 'Assign to' })).toHaveValue('alex');
  expect(screen.getByRole('list', { name: 'Open staff tasks' })).toHaveTextContent('Another member added context.');
  await waitFor(() => expect(submit).toBeEnabled());
  fireEvent.click(submit);
  await screen.findByText('Task assigned.');
  const posts = request.mock.calls.filter(([, options]) => options?.method === 'POST');
  expect(posts).toHaveLength(2);
  expect(JSON.parse(posts[1][1].body)).toMatchObject({ assigneeId: 'alex', note: 'Unsaved staff note', expectedRevision: 3 });
});

it.each([
  ['buyer', { customer: 'Sam Jones' }],
  ['car', { vehicleId: 'car-2', vehicle: 'Vauxhall Corsa', registration: 'AB12 CDE' }],
] as const)('keeps a new note read-only after the saved %s changes during a conflict', async (_kind, changes) => {
  const latest = sale([], 2, changes);
  request.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url.includes('?kind=')) return { members: [{ id: 'jo', name: 'Jo West' }] };
    if (options?.method === 'POST') throw new ApiError(409, { error: 'This sale changed on another device. Reload it before saving.' });
    return { sale: latest };
  });
  const view = mount(sale());
  openAssignment();
  await screen.findByRole('option', { name: 'Jo West' });
  fireEvent.change(screen.getByRole('combobox', { name: 'Assign to' }), { target: { value: 'jo' } });
  const note = screen.getByRole('textbox', { name: 'Staff note (optional)' });
  fireEvent.change(note, { target: { value: 'Check Ellie’s BMW payment.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Assign task' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Reload latest sale' }));
  await waitFor(() => expect(view.onSaved).toHaveBeenCalledWith(latest, { reloaded: true }));
  view.rerender(latest);
  await screen.findByText('The customer or car changed. Copy your note if you need it, then discard this edit.');
  expect(note).toHaveValue('Check Ellie’s BMW payment.');
  expect(note).toHaveAttribute('readonly');
  expect(screen.getByRole('button', { name: 'Assign task' })).toBeDisabled();
  expect(request.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  fireEvent.click(screen.getByRole('button', { name: 'Assign a task' }));
  expect(screen.getByRole('textbox', { name: 'Staff note (optional)' })).toHaveValue('');
});

it('opens and focuses the old collection task status when handover closed it', async () => {
  mount(sale([{ ...collectionTask, status: 'cancelled', resolutionReason: 'handover-completed' }]), {
    canManage: false, focusedTaskId: collectionTask.id,
  });
  const status = screen.getByText('This task was closed when the handover was recorded.');
  expect(status).toBeVisible();
  await waitFor(() => expect(status).toHaveFocus());
  expect(screen.queryByRole('button', { name: 'Mark arrange collection done' })).not.toBeInTheDocument();
});

it('offers a reassignment explanation when a previous collection assignee lacks handover access', async () => {
  mount(sale([collectionTask]), { canManage: false, currentStaffId: collectionTask.assigneeId, focusedTaskId: collectionTask.id });
  const status = screen.getByText('This task needs to be reassigned to someone with handover access.');
  await waitFor(() => expect(status).toHaveFocus());
  expect(screen.queryByRole('button', { name: 'Mark arrange collection done' })).not.toBeInTheDocument();
});

it('lets a manager reassign a payment check on a released sale', async () => {
  request.mockResolvedValue({ members: [{ id: 'jo', name: 'Jo West' }] });
  mount({ ...sale([paymentTask]), lifecycle: { status: 'released', changedAt: '2026-11-12T10:00:00Z', vehicleId: 'car' } }, {
    focusedTaskId: paymentTask.id,
  });
  expect(screen.queryByRole('button', { name: 'Assign a task' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Edit check payment task' }));
  await screen.findByRole('option', { name: 'Jo West' });
  fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  expect(screen.getByRole('button', { name: 'Edit check payment task' })).toHaveFocus();
});
