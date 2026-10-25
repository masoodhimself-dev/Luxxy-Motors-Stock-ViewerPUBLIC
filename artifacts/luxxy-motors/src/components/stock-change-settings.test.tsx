import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StockChangeSettings } from './stock-change-settings';
const state = vi.hoisted(() => ({ fetch: vi.fn(), permissions: ['settings.publish'] as string[] }));
vi.mock('@workspace/api-client-react', () => ({ customFetch: (...args: unknown[]) => state.fetch(...args) }));
vi.mock('@/components/portal/dealer-administration', () => ({ useStaffAccess: () => ({ data: { permissions: state.permissions } }) }));
const defaults = { minimumReduction: 100, contactIntervalDays: 7, revision: 2 };
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return { ...render(<QueryClientProvider client={client}><StockChangeSettings /></QueryClientProvider>), client };
}
beforeEach(() => { state.fetch.mockReset(); state.permissions = ['settings.publish']; state.fetch.mockImplementation(async () => defaults); });
it('loads dealer preferences and explains that website prices and manual sending stay unchanged', async () => {
  show();
  expect(await screen.findByLabelText('Minimum reduction (£)')).toHaveValue(100);
  expect(screen.getByLabelText('Days between price-update contacts')).toHaveValue(7);
  expect(screen.getByRole('button', { name: 'Save price update preferences' })).toBeDisabled();
  expect(screen.getByText(/Every accepted price change is still recorded/)).toBeVisible();
  expect(screen.getByText(/No email or WhatsApp message is sent automatically/)).toBeVisible();
  expect(state.fetch.mock.calls.every(([,options]) => !options?.method)).toBe(true);
});
it('saves only the two reminder preferences with their loaded revision', async () => {
  state.fetch.mockImplementation(async (_url: string, options?: RequestInit) => options?.method ? { ...defaults, minimumReduction: 200, contactIntervalDays: 14, revision: 3 } : defaults);
  show();
  fireEvent.change(await screen.findByLabelText('Minimum reduction (£)'), { target: { value: '200' } });
  fireEvent.change(screen.getByLabelText('Days between price-update contacts'), { target: { value: '14' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save price update preferences' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Price update preferences saved');
  const write = state.fetch.mock.calls.find(([, options]) => options?.method);
  expect(write?.[0]).toBe('/api/staff/stock-change-settings');
  expect(JSON.parse(write![1].body)).toEqual({ revision: 2, minimumReduction: 200, contactIntervalDays: 14 });
});
it('lets an owner undo a draft without writing settings', async () => {
  show();
  fireEvent.change(await screen.findByLabelText('Minimum reduction (£)'), { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: 'Undo changes' }));
  expect(screen.getByLabelText('Minimum reduction (£)')).toHaveValue(100);
  expect(state.fetch.mock.calls.every(([,options]) => !options?.method)).toBe(true);
});
it('keeps edits on a revision conflict and reloads only with an explicit click', async () => {
  let reads = 0;
  state.fetch.mockImplementation(async (_url: string, options?: RequestInit) => {
    if (options?.method) throw { status: 409 };
    return ++reads > 1 ? { minimumReduction: 250, contactIntervalDays: 10, revision: 3 } : defaults;
  });
  show();
  fireEvent.change(await screen.findByLabelText('Minimum reduction (£)'), { target: { value: '200' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save price update preferences' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Your edits are kept');
  expect(screen.getByLabelText('Minimum reduction (£)')).toHaveValue(200);
  fireEvent.click(screen.getByRole('button', { name: 'Reload price update settings' }));
  await waitFor(() => expect(screen.getByLabelText('Minimum reduction (£)')).toHaveValue(250));
  expect(state.fetch.mock.calls.filter(([,options]) => options?.method)).toHaveLength(1);
});
it('has no editable controls without settings permission', async () => {
  state.permissions = [];
  show();
  expect(await screen.findByLabelText('Minimum reduction (£)')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save price update preferences' })).toBeDisabled();
  expect(screen.getByText('An owner with settings permission can change these preferences.')).toBeVisible();
});
it('shows a load failure instead of assuming default preferences and supports retry', async () => {
  state.fetch.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(defaults);
  show();
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
  expect(screen.queryByLabelText('Minimum reduction (£)')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reload price update settings' }));
  expect(await screen.findByLabelText('Minimum reduction (£)')).toHaveValue(100);
});

it('does not silently adopt a background revision while an owner is editing', async () => {
  let reads = 0;
  state.fetch.mockImplementation(async (_url: string, options?: RequestInit) => {
    if (options?.method) throw { status: 409 };
    return ++reads > 1 ? { ...defaults, minimumReduction: 300, revision: 3 } : defaults;
  });
  const { client } = show();
  fireEvent.change(await screen.findByLabelText('Minimum reduction (£)'), { target: { value: '200' } });
  await client.invalidateQueries({ queryKey: ['staff-stock-change-settings'] });
  expect(screen.getByLabelText('Minimum reduction (£)')).toHaveValue(200);
  fireEvent.click(screen.getByRole('button', { name: 'Save price update preferences' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('changed in another session');
  expect(JSON.parse(state.fetch.mock.calls.find(([, options]) => options?.method)![1].body).revision).toBe(2);
});
