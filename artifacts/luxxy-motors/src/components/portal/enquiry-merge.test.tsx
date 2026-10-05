import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { customFetch, type Enquiry } from '@workspace/api-client-react';
import { EnquiryMergeDialog } from './enquiry-merge';
import { differingMergeContacts, mergeGroup, mergeRoot, overlappingMergeAppointments } from './enquiry-merge-model';
import { appointmentLabel } from '@/lib/test-drive-dates';

vi.mock('@workspace/api-client-react', async importOriginal => ({ ...await importOriginal<object>(), customFetch: vi.fn() }));
const post = vi.mocked(customFetch);
function record(id: string, extra: Partial<Enquiry> & { mergedIntoId?: string | null } = {}): Enquiry {
  return { id, reference: `REF-${id}`, customerName: 'Alex Customer', email: 'alex@example.test', phone: '07700900123', vehicleTitle: `Car ${id}`, vehicleRegistration: `${id}123 ABC`, appointmentAt: '2030-10-05T09:00:00.000Z', appointmentCancelledAt: null, type: 'viewing', source: 'phone', message: `Original note ${id}`, staffNote: `Internal note ${id}`, createdAt: '2026-10-01T09:00:00.000Z', workspaceRevision: 4, appointmentRevision: 3, followUpRevision: 2, ...extra } as Enquiry;
}
const a = record('a');
const b = record('b', { appointmentAt: '2030-10-05T10:00:00.000Z' });
beforeEach(() => { post.mockReset(); post.mockResolvedValue({ primaryId: 'a', recordIds: ['a', 'b'], cancelledAppointmentIds: [] }); });
function show(entries = [a, b], entry = a, refreshed = entries) {
  const onSaved = vi.fn();
  const onRefresh = vi.fn().mockResolvedValue(refreshed);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><EnquiryMergeDialog entry={entry} entries={entries} onRefresh={onRefresh} onClose={vi.fn()} onSaved={onSaved} /></QueryClientProvider>);
  return { onSaved, onRefresh };
}
function chooseB() { fireEvent.click(screen.getByRole('checkbox', { name: 'Include REF-b, Alex Customer' })); }
function addReason() { fireEvent.change(screen.getByRole('textbox', { name: 'Reason for merging' }), { target: { value: 'Same showroom visit' } }); }
function review() { fireEvent.click(screen.getByRole('button', { name: 'Review merge' })); }
function submit() { fireEvent.click(screen.getByRole('button', { name: 'Merge records' })); }

it('keeps every active appointment by default and submits all original revision checks only after review', async () => {
  const { onSaved } = show(); chooseB(); addReason();
  expect(screen.getByRole('checkbox', { name: 'Keep appointment REF-a' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Keep appointment REF-b' })).toBeChecked();
  expect(post).not.toHaveBeenCalled(); review();
  expect(screen.getByText('2 original records → REF-a. 2 appointments kept; 0 cancelled. Follow-up tasks and all conversation history are retained.')).toBeVisible();
  submit();
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  const [url, options] = post.mock.calls[0];
  expect(url).toBe('/api/staff/enquiries/a/merge');
  expect(JSON.parse(options!.body as string)).toEqual({ recordIds: ['a','b'], expectedRevisions: [{ id:'a',workspaceRevision:4,appointmentRevision:3,followUpRevision:2 },{ id:'b',workspaceRevision:4,appointmentRevision:3,followUpRevision:2 }], keepAppointmentIds: ['a','b'], reason: 'Same showroom visit', confirmDifferentCustomers: false, allowOverlappingAppointments: false });
});

it('requires explicit confirmation and lists the exact appointment before cancelling it', async () => {
  show(); chooseB(); addReason(); fireEvent.click(screen.getByRole('checkbox', { name: 'Keep appointment REF-b' }));
  expect(screen.getByRole('button', { name: 'Review merge' })).toBeDisabled();
  expect(screen.getByText(/Cancel 1 appointment: REF-b/)).toHaveTextContent(appointmentLabel(b.appointmentAt!));
  fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm cancellation of the appointments listed above.' })); review(); submit();
  await waitFor(() => expect(post).toHaveBeenCalledOnce());
  expect(JSON.parse(post.mock.calls[0][1]!.body as string).keepAppointmentIds).toEqual(['a']);
});

it('requires review of different customer contacts and overlapping kept appointments', async () => {
  show([a, record('b', { customerName: 'Another Customer', email: 'another@example.test', phone: '07700900999' })]);
  fireEvent.click(screen.getByRole('checkbox', { name: 'Include REF-b, Another Customer' })); addReason();
  expect(screen.getByRole('button', { name: 'Review merge' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: 'I have checked the different customer contacts and want one case.' }));
  expect(screen.getByRole('button', { name: 'Review merge' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Keep these overlapping appointments.' })); review(); submit();
  await waitFor(() => expect(post).toHaveBeenCalledOnce());
  expect(JSON.parse(post.mock.calls[0][1]!.body as string)).toMatchObject({ confirmDifferentCustomers: true, allowOverlappingAppointments: true });
});

it('includes existing groups automatically and resolves a merged child to its main record', async () => {
  const child = record('child', { mergedIntoId: 'a', appointmentAt: null });
  show([a, child, b], child); addReason(); review(); submit();
  await waitFor(() => expect(post).toHaveBeenCalledOnce());
  expect(post.mock.calls[0][0]).toBe('/api/staff/enquiries/a/merge');
  expect(JSON.parse(post.mock.calls[0][1]!.body as string).recordIds).toEqual(['a','child']);
});

it('finds a case by an original child and includes that entire case when selected', async () => {
  const child = record('child', { mergedIntoId: 'b', vehicleTitle: 'Searchable original Porsche', appointmentAt: null });
  show([a,b,child]);
  fireEvent.change(screen.getByRole('textbox', { name: 'Search records to merge' }), { target: { value: 'original Porsche' } });
  chooseB(); addReason(); review(); submit();
  await waitFor(() => expect(post).toHaveBeenCalledOnce());
  expect(JSON.parse(post.mock.calls[0][1]!.body as string).recordIds).toEqual(['a','b','child']);
});

it('blocks selecting a case when its automatically included originals would exceed twenty', () => {
  const children = Array.from({ length: 19 }, (_, index) => record(`child-${index}`, { mergedIntoId: 'b', appointmentAt: null }));
  show([a,b,...children]);
  expect(screen.getByRole('checkbox', { name: 'Include REF-b, Alex Customer' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Review merge' })).toBeDisabled();
  expect(post).not.toHaveBeenCalled();
});

it('retains choices on a 409, refreshes revisions explicitly, and requires a new review without retrying automatically', async () => {
  post.mockRejectedValueOnce({ status: 409, data: { error: 'Record changed' } });
  const fresh = [record('a', { workspaceRevision: 5 }), record('b', { appointmentRevision: 8, appointmentAt: '2030-10-05T11:00:00.000Z' })];
  const { onRefresh } = show([a,b], a, fresh); chooseB(); addReason();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Keep appointment REF-b' })); fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm cancellation of the appointments listed above.' })); review(); submit();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh records' })).toBeVisible());
  expect(post).toHaveBeenCalledTimes(1); expect(onRefresh).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh records' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Review merge' })).toBeVisible());
  expect(screen.getByRole('checkbox', { name: 'Include REF-b, Alex Customer' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Keep appointment REF-b' })).not.toBeChecked();
  expect(screen.getByRole('textbox', { name: 'Reason for merging' })).toHaveValue('Same showroom visit');
  expect(screen.getByRole('button', { name: 'Review merge' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: 'I confirm cancellation of the appointments listed above.' })); review(); submit();
  await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
  expect(JSON.parse(post.mock.calls[1][1]!.body as string).expectedRevisions).toEqual([{id:'a',workspaceRevision:5,appointmentRevision:3,followUpRevision:2},{id:'b',workspaceRevision:4,appointmentRevision:8,followUpRevision:2}]);
});

it('blocks merging when the linked main record is missing and does not silently drop the source', () => {
  const orphan = record('orphan', { mergedIntoId: 'missing' }); show([orphan,b], orphan);
  expect(screen.getByRole('button', { name: 'Refresh records' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Review merge' })).not.toBeInTheDocument();
  expect(post).not.toHaveBeenCalled();
});

it('detects contacts by canonical details and names, expands groups, and respects duration plus buffer', () => {
  expect(differingMergeContacts([a,record('b',{ phone:'+44 7700 900123',email:null,customerName:' ALEX   CUSTOMER ' })])).toBe(false);
  expect(differingMergeContacts([a,record('b',{ customerName:'Alex Other' })])).toBe(true);
  expect(differingMergeContacts([record('a',{phone:null,email:null}),record('b',{phone:null,email:null})])).toBe(true);
  const buffered = record('a',{appointmentBufferMinutes:15});
  expect(overlappingMergeAppointments([buffered,record('b',{appointmentAt:'2030-10-05T09:40:00.000Z'})])).toHaveLength(1);
  expect(overlappingMergeAppointments([buffered,record('b',{appointmentAt:'2030-10-05T09:45:00.000Z'})])).toHaveLength(0);
  const child = record('child',{mergedIntoId:'a'});
  expect(mergeRoot(child,[a,child])?.id).toBe('a'); expect(mergeGroup(child,[a,child,b]).map(item=>item.id)).toEqual(['a','child']);
  expect(mergeRoot(child,[child])).toBeNull();
});
