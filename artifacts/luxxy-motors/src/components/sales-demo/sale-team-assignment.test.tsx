import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import type { SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { SaleTeamAssignment } from './sale-team-assignment';

const request = vi.hoisted(() => vi.fn());
vi.mock('@workspace/api-client-react', () => ({ customFetch: request }));

it('preserves a typed note and blocks overwriting newly refreshed staff details', async () => {
  request.mockResolvedValue({ currentUserId: 'alice', members: [{ id: 'alice', name: 'Alice' }] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const sale = { id: 'sale-test', revision: 1 } as SaleWorkspaceRecord;
  const onSaved = vi.fn(), onSaving = vi.fn(), onDirtyChange = vi.fn();
  const editor = (record: SaleWorkspaceRecord) =>
    <QueryClientProvider client={client}><SaleTeamAssignment sale={record} canManage disabled={false}
      onSaved={onSaved} onSaving={onSaving} onDirtyChange={onDirtyChange} /></QueryClientProvider>;
  const view = render(editor(sale));
  fireEvent.click(screen.getByText('Sale owner'));
  await screen.findByRole('option', { name: 'Alice (you)' });
  fireEvent.change(screen.getByRole('textbox', { name: 'Staff handover note' }), { target: { value: 'Unfinished note' } });
  expect(screen.getByRole('button', { name: 'Save staff details' })).toBeEnabled();
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  view.rerender(editor({ ...sale, revision: 2, team: { ownerId: 'alice', ownerName: 'Alice', note: 'New note from another device', updatedAt: '', updatedBy: 'Alice' } }));
  expect(screen.getByRole('alert')).toHaveTextContent('This sale changed while you were editing');
  expect(screen.getByRole('textbox', { name: 'Staff handover note' })).toHaveValue('Unfinished note');
  expect(screen.getByRole('button', { name: 'Save staff details' })).toBeDisabled();
  expect(onSaved).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
  expect(screen.getByRole('textbox', { name: 'Staff handover note' })).toHaveValue('New note from another device');
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
});
