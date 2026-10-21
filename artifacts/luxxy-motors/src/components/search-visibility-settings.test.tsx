import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SearchVisibilitySettings } from './search-visibility-settings';
const request = vi.hoisted(() => vi.fn());
const ready = { origin: 'https://dealer.example.test', demonstration: false, status: 'ready_to_submit', sitemapUrl: 'https://dealer.example.test/sitemap.xml', robotsUrl: 'https://dealer.example.test/robots.txt', generatedAt: '2026-10-21T12:00:00Z', checks: [{ code: 'address', label: 'Showroom address', ready: true, detail: 'Confirm this showroom.', settingsUrl: '/portal?section=settings&settingsTab=dealership' }], externalChecks: { googleIndexing: 'unconfirmed' } };
const clients: QueryClient[] = [];
function show() { const client = new QueryClient({ defaultOptions: { queries: { retry: false, throwOnError: false, gcTime: 0 } } }); clients.push(client); return render(<QueryClientProvider client={client}><SearchVisibilitySettings /></QueryClientProvider>); }
beforeEach(() => { request.mockReset(); vi.stubGlobal('fetch', request); });
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); });
it('separates field presence from external indexing and provider account verification', async () => {
  request.mockImplementation(async () => Response.json(ready)); show();
  await screen.findByText('Business details are present');
  expect(screen.getByText(/do not verify their accuracy/)).toBeInTheDocument();
  expect(screen.getByText(/Account ownership, indexing and crawler access are unconfirmed/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Open sitemap/ })).toHaveAttribute('href', ready.sitemapUrl);
  expect(screen.getByRole('link', { name: /Google Search Console/ })).toBeInTheDocument();
  expect(request).toHaveBeenCalledTimes(1);
});
it('keeps demos out of search setup and does not advertise a demo sitemap', async () => {
  request.mockImplementation(async () => Response.json({ ...ready, demonstration: true, status: 'demo_excluded' })); show();
  await screen.findByText('Demo excluded from search');
  expect(screen.queryByRole('link', { name: /Open sitemap/ })).not.toBeInTheDocument();
  expect(screen.queryByText('Connect your search accounts')).not.toBeInTheDocument();
});
it('shows a useful edit action for missing published details', async () => {
  request.mockImplementation(async () => Response.json({ ...ready, status: 'needs_details', checks: [{ ...ready.checks[0], ready: false }] })); show();
  await screen.findByText('Complete your business details');
  expect(screen.getByRole('link', { name: 'Add details' })).toHaveAttribute('href', ready.checks[0].settingsUrl);
});
it('identifies local sample data and avoids links to unimplemented preview crawl endpoints', async () => {
  request.mockImplementation(async () => Response.json({ ...ready, preview: true })); show();
  await screen.findByText(/Local preview using sample dealership details/);
  expect(screen.queryByRole('link', { name: /Open sitemap/ })).not.toBeInTheDocument();
});
it('reports a failed check without presenting a success state', async () => {
  request.mockImplementation(async () => Response.json({ error: 'Forbidden' }, { status: 403 })); show();
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
  expect(screen.queryByText('Business details are present')).not.toBeInTheDocument();
});
it('removes last-known success when refreshing the checks fails', async () => {
  request.mockImplementationOnce(async () => Response.json(ready)).mockImplementation(async () => Response.json({ error: 'Service unavailable' }, { status: 503 }));
  show(); await screen.findByText('Business details are present');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh checks' }));
  await screen.findByRole('alert');
  await waitFor(() => expect(screen.queryByText('Business details are present')).not.toBeInTheDocument());
});
it('keeps prepared IndexNow disabled without submitting anything', async () => {
  request.mockImplementation(async () => Response.json({ ...ready, indexNow: { enabled: false, status: 'disabled', manualOnly: true, maximumUrlsPerSubmission: 500 } }));
  show();
  expect(await screen.findByRole('button', { name: 'Submit public pages' })).toBeDisabled();
  expect(screen.getByText(/Prepared but switched off/)).toBeInTheDocument();
  expect(request).toHaveBeenCalledTimes(1);
});
