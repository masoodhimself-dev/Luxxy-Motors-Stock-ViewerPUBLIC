import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { VehicleWatchSettings } from './vehicle-watch-settings';
const state = vi.hoisted(() => ({ fetch: vi.fn(), permissions: ['settings.publish'] as string[] }));
vi.mock('@workspace/api-client-react', () => ({ customFetch: (...args: unknown[]) => state.fetch(...args) }));
vi.mock('@/components/portal/dealer-administration', () => ({ useStaffAccess: () => ({ data: { permissions: state.permissions } }) }));
const defaults = { enabled: true, revision: 2, emailReady: true };
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return { ...render(<QueryClientProvider client={client}><VehicleWatchSettings /></QueryClientProvider>), client };
}
beforeEach(() => { state.fetch.mockReset(); state.permissions = ['settings.publish']; state.fetch.mockResolvedValue(defaults); });
it('shows actual dealer readiness, verified email and manual sending without saving on load', async () => {
  show();
  expect(await screen.findByRole('checkbox')).toBeChecked();
  expect(screen.getByText('The dealership email connection is ready.')).toBeVisible();
  expect(screen.getByText(/No price or availability update is sent automatically/)).toBeVisible();
  expect(screen.getByText(/Watching alone does not create an enquiry/)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Save watch preferences' })).toBeDisabled();
  expect(state.fetch.mock.calls.every(([, options]) => !options?.method)).toBe(true);
});
it('saves only the loaded enablement revision after an owner changes the toggle', async () => {
  state.fetch.mockImplementation(async (_url: string, options?: RequestInit) => options?.method ? { ...defaults, enabled: false, revision: 3 } : defaults);
  const { client } = show();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  fireEvent.click(await screen.findByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Save watch preferences' }));
  expect(await screen.findByText('Watch preferences saved. Customer updates remain manual.')).toBeVisible();
  const write = state.fetch.mock.calls.find(([, options]) => options?.method)!;
  expect(write[0]).toBe('/api/staff/vehicle-watch-settings');
  expect(JSON.parse(write[1].body)).toEqual({ enabled: false, revision: 2 });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['vehicle-watch-availability'] });
});
it('keeps edits and the original revision when preferences change in another session', async () => {
  let reads = 0;
  state.fetch.mockImplementation(async (_url: string, options?: RequestInit) => {
    if (options?.method) throw { status: 409 };
    return ++reads > 1 ? { ...defaults, revision: 3 } : defaults;
  });
  const { client } = show(); fireEvent.click(await screen.findByRole('checkbox'));
  await client.invalidateQueries({ queryKey: ['staff-vehicle-watch-settings'] });
  fireEvent.click(screen.getByRole('button', { name: 'Save watch preferences' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Your edit is kept');
  expect(screen.getByRole('checkbox')).not.toBeChecked();
  expect(JSON.parse(state.fetch.mock.calls.find(([, options]) => options?.method)![1].body).revision).toBe(2);
  fireEvent.click(screen.getByRole('button', { name: 'Reload watch settings' }));
  await waitFor(() => expect(screen.getByRole('checkbox')).toBeChecked());
});
it('shows an unready connection and does not pretend customer verification can be delivered', async () => {
  state.fetch.mockResolvedValue({ ...defaults, emailReady: false }); show();
  expect(await screen.findByText(/email connection is not ready/)).toBeVisible();
  expect(screen.queryByText('The dealership email connection is ready.')).not.toBeInTheDocument();
});
it('uses read-only controls for staff without settings permission', async () => {
  state.permissions = []; show();
  expect(await screen.findByRole('checkbox')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save watch preferences' })).toBeDisabled();
});
it('allows retry after a failed load instead of assuming watch is enabled', async () => {
  state.fetch.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(defaults); show();
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reload watch settings' }));
  expect(await screen.findByRole('checkbox')).toBeChecked();
});
it.each([true,false])('distinguishes reply routing from sender readiness: %s', async repliesReady => {
  state.fetch.mockResolvedValue({ ...defaults, repliesReady }); show();
  expect(await screen.findByText(repliesReady ? 'Customer email replies return to the correct enquiry in Inbox.' : 'Customer replies use the configured reply inbox. Incoming email routing must be enabled to bring them into Inbox.')).toBeVisible();
});
