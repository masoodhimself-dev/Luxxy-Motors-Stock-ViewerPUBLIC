import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PhoneSharingSettings } from './phone-sharing-settings';
import { phoneSharingSettingsQueryKey, usePhoneSharingSettings } from '@/lib/phone-sharing-settings';

const clients: QueryClient[] = [];
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); });
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><PhoneSharingSettings /></QueryClientProvider>);
  return client;
}

it('saves only the sharing preference after an explicit save and updates all consumers', async () => {
  const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PUT') return Response.json({ revision: 8, enabled: false });
    return Response.json({ revision: 7, enabled: true });
  });
  vi.stubGlobal('fetch', fetch);
  const client = show();
  const toggle = await screen.findByRole('switch', { name: 'Allow WhatsApp QR sharing' });
  expect(toggle).toBeChecked();
  expect(screen.getByRole('button', { name: 'Save sharing settings' })).toBeDisabled();
  fireEvent.click(toggle);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('region', { name: 'WhatsApp and QR settings' })).toHaveAttribute('data-settings-dirty', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Save sharing settings' }));
  await screen.findByText('WhatsApp & QR settings saved.');
  expect(fetch).toHaveBeenLastCalledWith('/api/staff/phone-sharing-settings', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ expectedRevision: 7, enabled: false }) }));
  expect(client.getQueryData(phoneSharingSettingsQueryKey)).toEqual({ revision: 8, enabled: false });
  expect(screen.getByRole('button', { name: 'Save sharing settings' })).toBeDisabled();
  expect(screen.getByText(/existing links keep their original expiry/i)).toBeInTheDocument();
  expect(screen.getByText(/email delivery and your public WhatsApp contact button are unchanged/i)).toBeInTheDocument();
});

it('explains security limits without editable expiry or phone-number fields', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ revision: 0, enabled: true })));
  show();
  await screen.findByRole('switch');
  expect(screen.getByText(/expire after 24 hours/i)).toBeInTheDocument();
  expect(screen.getByText(/phone-upload links last 15 minutes/i)).toBeInTheDocument();
  expect(screen.getByText(/up to 30 seconds, landscape/i)).toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('switch'));
  fireEvent.click(screen.getByRole('button', { name: 'Undo changes' }));
  expect(screen.getByRole('switch')).toBeChecked();
  expect(screen.getByRole('button', { name: 'Save sharing settings' })).toBeDisabled();
});

it('keeps an unsaved preference after a conflict and reloads the current revision deliberately', async () => {
  let revision = 1;
  vi.stubGlobal('fetch', vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'PUT') { revision = 3; return Response.json({ error: 'These settings changed. Reload before saving.' }, { status: 409 }); }
    return Response.json({ revision, enabled: true });
  }));
  const client = show();
  fireEvent.click(await screen.findByRole('switch'));
  fireEvent.click(screen.getByRole('button', { name: 'Save sharing settings' }));
  await screen.findByRole('alert');
  expect(screen.getByRole('switch')).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Reload settings' }));
  await waitFor(() => expect(client.getQueryData(phoneSharingSettingsQueryKey)).toEqual({ revision: 3, enabled: true }));
  expect(screen.getByRole('switch')).toBeChecked();
});

it('shows a load failure and offers a retry instead of displaying an enabled switch', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Unavailable' }, { status: 503 })));
  show();
  expect(await screen.findByRole('alert')).toHaveTextContent('Sharing settings could not be loaded.');
  expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reload settings' })).toBeEnabled();
});

function Consumer() { const setting = usePhoneSharingSettings(); return <span>{setting.enabled ? 'Sharing enabled' : 'Sharing unavailable'}</span>; }
it('holds new sharing unavailable while the app loads the authoritative preference', async () => {
  let finish: (value: Response) => void = () => {};
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  render(<QueryClientProvider client={client}><Consumer /></QueryClientProvider>);
  expect(screen.getByText('Sharing unavailable')).toBeInTheDocument();
  await act(async () => finish(Response.json({ revision: 2, enabled: false })));
  expect(screen.getByText('Sharing unavailable')).toBeInTheDocument();
});
it('keeps isolated existing consumers usable without an application QueryClient provider', () => {
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  render(<Consumer />);
  expect(screen.getByText('Sharing enabled')).toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});
