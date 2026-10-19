import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DealerSettingsHub } from './dealer-administration';

const device = vi.hoisted(() => ({ mobile: false }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => device.mobile }));
vi.mock('@/components/dealer-settings-panel', () => ({ DealerSettingsPanel: () => <p>Website editor fixture</p> }));
vi.mock('@/components/dealer-integrations-settings', () => ({ DealerIntegrationsSettings: () => <p>Connection editor fixture</p> }));
vi.mock('@/components/email-templates-settings', () => ({ EmailTemplatesSettings: () => <p>Email editor fixture</p> }));
vi.mock('@/components/sales-paperwork-settings', () => ({ SalesPaperworkSettings: () => <p>Invoice editor fixture</p> }));
vi.mock('@/components/customer-chat-settings', () => ({ CustomerChatSettings: () => <p>Chat editor fixture</p> }));

const clients: QueryClient[] = [];
const ownerPermissions = ['settings.publish', 'team.manage'];
function mockAccess(permissions = ownerPermissions) {
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/staff/access') return Response.json({ role: 'owner', permissions, user: {} });
    if (url === '/api/staff/team') return Response.json({ members: [] });
    if (url === '/api/staff/settings-history') return Response.json({ revision: 1, versions: [] });
    throw new Error(`Unexpected settings request: ${url}`);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}
function showSettings(search = '') {
  window.history.replaceState({}, '', `/portal?section=settings${search ? `&${search}` : ''}`);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><DealerSettingsHub /></QueryClientProvider>);
  return client;
}
const mainTabs = () => screen.getByRole('tablist', { name: 'Settings categories' });
const topTab = (name: string) => within(mainTabs()).getByRole('tab', { name });
function dirty(fixture: string) { screen.getByText(fixture).setAttribute('data-settings-dirty', 'true'); }

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  mockAccess();
});
afterEach(() => {
  clients.splice(0).forEach(client => client.clear());
  device.mobile = false;
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

it('uses the same five clear settings tabs and an associated panel on desktop', async () => {
  showSettings();
  await screen.findByText('Website editor fixture');
  expect(within(mainTabs()).getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Website', 'Email', 'Invoices', 'Team', 'Advanced']);
  expect(topTab('Website')).toHaveAttribute('aria-selected', 'true');
  const panel = screen.getByRole('tabpanel', { name: 'Website' });
  expect(panel).toHaveAttribute('id', topTab('Website').getAttribute('aria-controls'));
  expect(panel).toHaveTextContent('Website editor fixture');
  expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
});

it('navigates Email and Invoices through their existing bookmarkable URLs', async () => {
  showSettings();
  await screen.findByText('Website editor fixture');
  fireEvent.click(topTab('Email'));
  expect(await screen.findByText('Email editor fixture')).toBeInTheDocument();
  expect(topTab('Email')).toHaveAttribute('aria-selected', 'true');
  expect(window.location.search).toContain('settingsTab=emails');
  fireEvent.click(topTab('Invoices'));
  expect(await screen.findByText('Invoice editor fixture')).toBeInTheDocument();
  expect(window.location.search).toContain('settingsTab=paperwork');
});

it.each([
  ['website', 'Website', 'Website editor fixture'],
  ['emails', 'Email', 'Email editor fixture'],
  ['paperwork', 'Invoices', 'Invoice editor fixture'],
] as const)('preserves a direct %s settings link', async (id, label, fixture) => {
  showSettings(`settingsTab=${id}`);
  await screen.findByText(fixture);
  expect(topTab(label)).toHaveAttribute('aria-selected', 'true');
});

it('preserves the Team link and loads staff access only when selected', async () => {
  const fetch = mockAccess();
  showSettings('settingsTab=team');
  await screen.findByRole('heading', { name: 'Your team' });
  expect(topTab('Team')).toHaveAttribute('aria-selected', 'true');
  expect(fetch).toHaveBeenCalledWith('/api/staff/team', expect.anything());
  expect(screen.getByText(/last active owner cannot be removed/i)).toBeInTheDocument();
});

it('groups the existing connection URL under Advanced', async () => {
  showSettings('settingsTab=integrations');
  await screen.findByText('Connection editor fixture');
  expect(topTab('Advanced')).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: 'Connections' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tabpanel', { name: 'Connections' })).toHaveAttribute('id', 'advanced-settings-panel-integrations');
});

it('preserves the Publish history URL inside Advanced', async () => {
  showSettings('settingsTab=history');
  await screen.findByRole('heading', { name: 'Publication history' });
  expect(topTab('Advanced')).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: 'Publish history' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('button', { name: 'Refresh history' })).toBeInTheDocument();
});

it('opens Connections first from Advanced and can then open publication history', async () => {
  showSettings();
  await screen.findByText('Website editor fixture');
  fireEvent.click(topTab('Advanced'));
  await screen.findByText('Connection editor fixture');
  expect(window.location.search).toContain('settingsTab=integrations');
  fireEvent.click(screen.getByRole('tab', { name: 'Publish history' }));
  await screen.findByRole('heading', { name: 'Publication history' });
  expect(window.location.search).toContain('settingsTab=history');
});

it.each(['chat', 'not-a-settings-area'])('falls back safely for unavailable %s URLs', async id => {
  showSettings(`settingsTab=${id}`);
  await screen.findByText('Website editor fixture');
  expect(topTab('Website')).toHaveAttribute('aria-selected', 'true');
  expect(screen.queryByText('Chat editor fixture')).not.toBeInTheDocument();
});

it('does not mount any settings editor while access is still loading', () => {
  const fetch = vi.fn(() => new Promise<Response>(() => {}));
  vi.stubGlobal('fetch', fetch);
  showSettings('settingsTab=integrations');
  expect(screen.getByRole('status')).toHaveTextContent('Loading settings access');
  expect(screen.queryByText('Connection editor fixture')).not.toBeInTheDocument();
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
});

it('keeps settings unavailable without publish permission', async () => {
  const fetch = mockAccess([]);
  showSettings('settingsTab=emails');
  await screen.findByText('Your role does not have permission to publish dealership settings.');
  expect(screen.queryByText('Email editor fixture')).not.toBeInTheDocument();
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('shows access failures without mounting editors or private panels', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Settings access unavailable.' }, { status: 503 })));
  showSettings('settingsTab=team');
  expect(await screen.findByRole('alert')).toHaveTextContent('Settings access unavailable');
  expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Your team' })).not.toBeInTheDocument();
});

it('hides Team without team permission and refuses its direct URL without fetching staff', async () => {
  const fetch = mockAccess(['settings.publish']);
  showSettings('settingsTab=team');
  expect(await screen.findByRole('heading', { name: 'Team access is managed by an authorised owner' })).toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: 'Team' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Your team' })).not.toBeInTheDocument();
  expect(fetch.mock.calls.some(([url]) => String(url).includes('/api/staff/team'))).toBe(false);
});

it.each([
  ['emails', 'Email editor fixture', 'Invoices'],
  ['paperwork', 'Invoice editor fixture', 'Advanced'],
] as const)('protects unsaved %s changes when switching a main tab', async (id, fixture, target) => {
  vi.stubGlobal('confirm', vi.fn().mockReturnValue(false));
  showSettings(`settingsTab=${id}`);
  await screen.findByText(fixture);
  dirty(fixture);
  fireEvent.click(topTab(target));
  expect(window.confirm).toHaveBeenCalledTimes(1);
  expect(screen.getByText(fixture)).toBeInTheDocument();
  expect(window.location.search).toContain(`settingsTab=${id}`);
});

it('discards unsaved edits only after a deliberate confirmed main-tab change', async () => {
  vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
  showSettings('settingsTab=emails');
  await screen.findByText('Email editor fixture');
  dirty('Email editor fixture');
  fireEvent.click(topTab('Invoices'));
  expect(window.confirm).toHaveBeenCalledTimes(1);
  expect(await screen.findByText('Invoice editor fixture')).toBeInTheDocument();
  expect(screen.queryByText('Email editor fixture')).not.toBeInTheDocument();
});

it('protects unsaved connection edits when changing Advanced subtabs', async () => {
  vi.stubGlobal('confirm', vi.fn().mockReturnValue(false));
  showSettings('settingsTab=integrations');
  await screen.findByText('Connection editor fixture');
  dirty('Connection editor fixture');
  fireEvent.click(screen.getByRole('tab', { name: 'Publish history' }));
  expect(window.confirm).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Connection editor fixture')).toBeInTheDocument();
  expect(window.location.search).toContain('settingsTab=integrations');
  expect(screen.getByRole('tab', { name: 'Connections' })).toHaveAttribute('aria-selected', 'true');
});

it('does not prompt or throw away a website draft when opening a different settings group', async () => {
  vi.stubGlobal('confirm', vi.fn().mockReturnValue(false));
  showSettings('settingsTab=website&websiteSection=contact');
  await screen.findByText('Website editor fixture');
  fireEvent.click(topTab('Email'));
  await screen.findByText('Email editor fixture');
  expect(window.confirm).not.toHaveBeenCalled();
});

it('uses the same direct tab navigation on phones without a separate category menu', async () => {
  device.mobile = true;
  showSettings();
  await screen.findByText('Website editor fixture');
  expect(within(mainTabs()).getAllByRole('tab')).toHaveLength(5);
  expect(screen.queryByRole('heading', { name: 'Everyday settings' })).not.toBeInTheDocument();
  fireEvent.click(topTab('Email'));
  expect(await screen.findByText('Email editor fixture')).toBeInTheDocument();
  expect(window.location.search).toContain('settingsTab=emails');
});

it('moves keyboard focus without activating tabs or discarding an editor', async () => {
  vi.stubGlobal('confirm', vi.fn().mockReturnValue(false));
  showSettings('settingsTab=emails');
  await screen.findByText('Email editor fixture');
  dirty('Email editor fixture');
  topTab('Email').focus();
  fireEvent.keyDown(topTab('Email'), { key: 'ArrowRight' });
  expect(topTab('Invoices')).toHaveFocus();
  expect(topTab('Email')).toHaveAttribute('aria-selected', 'true');
  expect(window.confirm).not.toHaveBeenCalled();
  fireEvent.keyDown(topTab('Invoices'), { key: 'End' });
  expect(topTab('Advanced')).toHaveFocus();
  fireEvent.keyDown(topTab('Advanced'), { key: 'Home' });
  expect(topTab('Website')).toHaveFocus();
  fireEvent.click(topTab('Website'));
  expect(window.confirm).toHaveBeenCalledTimes(1);
  expect(topTab('Email')).toHaveAttribute('aria-selected', 'true');
});

it('responds to browser history navigation between bookmarked settings areas', async () => {
  showSettings('settingsTab=emails');
  await screen.findByText('Email editor fixture');
  await act(async () => {
    window.history.replaceState({}, '', '/portal?section=settings&settingsTab=paperwork');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  expect(await screen.findByText('Invoice editor fixture')).toBeInTheDocument();
  expect(topTab('Invoices')).toHaveAttribute('aria-selected', 'true');
});

it.each([
  ['team', '/api/staff/team', 'Loading team access…', { members: [] }, 'No staff access records to show.'],
  ['history', '/api/staff/settings-history', 'Loading publication history…', { revision: 1, versions: [] }, 'No website publications have been recorded yet.'],
] as const)('explains loading and empty %s records without showing a blank list', async (tab, endpoint, loading, response, empty) => {
  let finish: (response: Response) => void = () => {};
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === '/api/staff/access') return Response.json({ role: 'owner', permissions: ownerPermissions, user: {} });
    if (String(input) === endpoint) return new Promise<Response>(resolve => { finish = resolve; });
    throw new Error(`Unexpected settings request: ${input}`);
  }));
  showSettings(`settingsTab=${tab}`);
  expect(await screen.findByText(loading)).toHaveAttribute('role', 'status');
  await act(async () => { finish(Response.json(response)); });
  expect(await screen.findByText(empty)).toBeInTheDocument();
  expect(screen.queryByText(loading)).not.toBeInTheDocument();
});
