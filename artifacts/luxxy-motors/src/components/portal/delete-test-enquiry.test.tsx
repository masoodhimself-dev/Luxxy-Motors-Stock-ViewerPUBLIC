import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { customFetch, type Enquiry } from '@workspace/api-client-react';
import { DeleteTestEnquiry } from './delete-test-enquiry';

const state = vi.hoisted(() => ({ permissions: ['sales.manage'] }));
vi.mock('./dealer-administration', () => ({ useStaffAccess: () => ({ data: { permissions: state.permissions } }) }));
vi.mock('@workspace/api-client-react', async original => ({ ...await original<object>(), customFetch: vi.fn() }));
const entry = { id: 'test-one', customerName: 'TEST — WhatsApp check', vehicleTitle: 'Ford Focus', workspaceRevision: 3 } as Enquiry;
const path = '/api/staff/enquiries/test-one/deletion';
const eligible = { id: entry.id, expectedRevision: 3, canDelete: true, reason: null };
function show(value = entry, onDeleted = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { ...render(<QueryClientProvider client={client}><DeleteTestEnquiry entry={value} onDeleted={onDeleted} /></QueryClientProvider>), onDeleted };
}
const deletes = () => vi.mocked(customFetch).mock.calls.filter(([, options]) => options?.method === 'DELETE');
async function open() { fireEvent.click(screen.getByRole('button', { name: 'Delete test enquiry' })); await screen.findByLabelText('I confirm this is test data, not a real customer enquiry.'); }
beforeEach(() => {
  state.permissions = ['sales.manage'];
  vi.mocked(customFetch).mockReset().mockImplementation(async (_url, options) => options?.method === 'DELETE' ? { deleted: true, id: entry.id } as never : eligible as never);
});

it.each(['Real Customer', 'Test drive buyer', 'Contest Winner', 'Customer TEST'])('keeps real enquiries free of deletion controls (%s)', name => {
  show({ ...entry, customerName: name }); expect(screen.queryByRole('button')).not.toBeInTheDocument(); expect(customFetch).not.toHaveBeenCalled();
});
it('hides deletion for accounts staff', () => { state.permissions = ['finance.export']; show(); expect(screen.queryByRole('button')).not.toBeInTheDocument(); expect(customFetch).not.toHaveBeenCalled(); });
it('checks only when opened and requires an explicit confirmation; cancel makes no changes', async () => {
  show(); expect(customFetch).not.toHaveBeenCalled(); await open();
  expect(customFetch).toHaveBeenCalledExactlyOnceWith(path, { cache: 'no-store' });
  expect(screen.getByText(entry.customerName)).toBeVisible(); expect(screen.getByText('Ford Focus')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Delete permanently' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Keep enquiry' })); expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); expect(deletes()).toHaveLength(0);
});
it('deletes only the selected test enquiry at the checked revision and reports success once', async () => {
  const { onDeleted } = show(); await open(); fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
  await waitFor(() => expect(onDeleted).toHaveBeenCalledExactlyOnceWith(entry.id));
  expect(deletes()).toEqual([[path, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expectedRevision: 3, confirmTestOnly: true }) }]]);
  expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
});
it('shows the server protection reason without offering a confirmation checkbox', async () => {
  vi.mocked(customFetch).mockResolvedValue({ ...eligible, canDelete: false, reason: 'This enquiry is connected to a saved sale.' } as never);
  show(); fireEvent.click(screen.getByRole('button', { name: 'Delete test enquiry' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('connected to a saved sale');
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Delete permanently' })).toBeDisabled(); expect(deletes()).toHaveLength(0);
});
it('blocks a stale record even when the server eligibility check passes', async () => {
  vi.mocked(customFetch).mockResolvedValue({ ...eligible, expectedRevision: 4 } as never);
  show(); fireEvent.click(screen.getByRole('button', { name: 'Delete test enquiry' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('This enquiry has changed'); expect(screen.queryByRole('checkbox')).not.toBeInTheDocument(); expect(deletes()).toHaveLength(0);
});
it('keeps the record on conflict and requires another check and confirmation before retrying', async () => {
  vi.mocked(customFetch).mockImplementation(async (_url, options) => { if (options?.method === 'DELETE') throw { data: { error: 'A payment now protects this record.' } }; return eligible as never; });
  const { onDeleted } = show(); await open(); fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('A payment now protects'); expect(onDeleted).not.toHaveBeenCalled(); expect(deletes()).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Delete permanently' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Check again' })); await screen.findByRole('checkbox'); expect(screen.getByRole('checkbox')).not.toBeChecked();
});
it('does not retry an uncertain network deletion automatically', async () => {
  vi.mocked(customFetch).mockImplementation(async (_url, options) => { if (options?.method === 'DELETE') throw new Error('Network interrupted'); return eligible as never; });
  const { onDeleted } = show(); await open(); fireEvent.click(screen.getByRole('checkbox')); fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not confirm deletion'); expect(deletes()).toHaveLength(1); expect(onDeleted).not.toHaveBeenCalled();
});
it('blocks double submissions and cannot dismiss an in-progress deletion', async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(customFetch).mockImplementation(async (_url, options) => options?.method === 'DELETE' ? await new Promise(resolve => { finish = resolve; }) as never : eligible as never);
  const { onDeleted } = show(); await open(); fireEvent.click(screen.getByRole('checkbox')); const button = screen.getByRole('button', { name: 'Delete permanently' }); fireEvent.click(button); fireEvent.click(button);
  expect(deletes()).toHaveLength(1); expect(screen.getByRole('button', { name: 'Keep enquiry' })).toBeDisabled();
  finish({ deleted: true, id: entry.id }); await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce());
});
it('fails closed when the eligibility response belongs to a different enquiry', async () => {
  vi.mocked(customFetch).mockResolvedValue({ ...eligible, id: 'someone-else' } as never); show(); fireEvent.click(screen.getByRole('button', { name: 'Delete test enquiry' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('could not check'); expect(screen.queryByRole('checkbox')).not.toBeInTheDocument(); expect(deletes()).toHaveLength(0);
});
