import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as baseRender, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ signedIn: true }));
vi.mock('@clerk/react', () => ({ useAuth: () => ({ isSignedIn: auth.signedIn }), SignInButton: ({ children, mode, forceRedirectUrl, signUpForceRedirectUrl }: { children: React.ReactNode; mode: string; forceRedirectUrl: string; signUpForceRedirectUrl: string }) => <div data-testid="platform-sign-in" data-mode={mode} data-return={forceRedirectUrl} data-sign-up-return={signUpForceRedirectUrl}>{children}</div> }));
import Platform from './platform';
const clients: QueryClient[]=[];
function render(node:React.ReactNode){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client);return baseRender(<QueryClientProvider client={client}>{node}</QueryClientProvider>);}
afterEach(()=>clients.splice(0).forEach(client=>client.clear()));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); auth.signedIn = true; });
const dealer = { id:'example-dealer', name:'Example Dealer', canonicalOrigin:'https://dealer.example.test', status:'draft', stockPlatform:'autotrader', retailerId:'example', sourceUrl:'https://www.autotrader.co.uk/example', domains:[], activeKeyCount:0, latestImport:null,lastSuccessfulImport:null };
const workspace = { dealer, domains:[{hostname:'dealer.example.test',verified:false,verificationToken:'fixture-token'}],members:[],imports:[],keys:[] };

it('refreshes the selected dealership credentials, staff and status without changing its current tab', async () => {
  let current = structuredClone(workspace) as Record<string, unknown>;
  const fetch = vi.fn(async (path: RequestInfo | URL, _init?: RequestInit) => String(path).endsWith('/workspace') ? Response.json(current) : Response.json({dealers:[dealer],activity:[]}));
  vi.stubGlobal('fetch', fetch);
  render(<Platform/>);
  fireEvent.click(await screen.findByRole('button',{name:/Example Dealer/}));
  fireEvent.click(await screen.findByRole('tab',{name:'Stock connection'}));
  expect(screen.getByText('Active credentials').parentElement).toHaveTextContent('0');
  current = {...workspace,dealer:{...dealer,status:'active'},keys:[{id:'new-key',createdAt:'2026-10-25T08:00:00Z',disabledAt:null}],members:[{id:'owner',name:'Updated owner',email:'owner@example.test',role:'owner',disabledAt:null}]};
  fireEvent.click(screen.getByRole('button',{name:/^Refresh$/}));
  await waitFor(()=>expect(screen.getByText('Active credentials').parentElement).toHaveTextContent('1'));
  expect(screen.getByRole('tab',{name:'Stock connection',selected:true})).toBeInTheDocument();
  expect(screen.getByText('active',{exact:true})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab',{name:'Staff'}));
  expect(await screen.findByText('Updated owner')).toBeInTheDocument();
  expect(fetch.mock.calls.every(([,init])=>!init || !init.method || init.method==='GET')).toBe(true);
});

it('keeps the last workspace details on a refresh failure and prevents overlapping refreshes', async () => {
  let pending = false;
  let finish: ((response: Response) => void) | undefined;
  const fetch = vi.fn(async path => {
    if (String(path).endsWith('/workspace')) return pending ? new Promise<Response>(resolve=>{finish=resolve;}) : Response.json(workspace);
    return Response.json({dealers:[dealer],activity:[]});
  });
  vi.stubGlobal('fetch', fetch);
  render(<Platform/>);
  fireEvent.click(await screen.findByRole('button',{name:/Example Dealer/}));
  fireEvent.click(await screen.findByRole('tab',{name:'Stock connection'}));
  pending = true;
  fireEvent.click(screen.getByRole('button',{name:/^Refresh$/}));
  await waitFor(()=>expect(finish).toBeDefined());
  expect(screen.getByRole('button',{name:/^Refresh$/})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:/^Refresh$/}));
  expect(fetch.mock.calls.filter(([path])=>String(path).endsWith('/workspace'))).toHaveLength(2);
  finish!(Response.json({error:'Temporary failure'},{status:503}));
  expect(await screen.findByRole('alert')).toHaveTextContent('The last loaded details are still shown.');
  expect(screen.getByText('Active credentials').parentElement).toHaveTextContent('0');
  expect(screen.getByRole('tab',{name:'Stock connection',selected:true})).toBeInTheDocument();
  await waitFor(()=>expect(screen.getByRole('button',{name:/^Refresh$/})).toBeEnabled());
  pending = false;
  fireEvent.click(screen.getByRole('button',{name:/^Refresh$/}));
  await waitFor(()=>expect(screen.queryByRole('alert')).not.toBeInTheDocument());
});

it('does not reload or show the workspace after refreshed platform access is denied', async () => {
  let denied = false;
  const fetch = vi.fn(async path => String(path).endsWith('/workspace') ? Response.json(workspace) : denied ? Response.json({error:'Forbidden'},{status:403}) : Response.json({dealers:[dealer],activity:[]}));
  vi.stubGlobal('fetch', fetch);
  render(<Platform/>);
  fireEvent.click(await screen.findByRole('button',{name:/Example Dealer/}));
  await screen.findByRole('tab',{name:'Stock connection'});
  denied = true;
  fireEvent.click(screen.getByRole('button',{name:/^Refresh$/}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Platform administrator access is required');
  expect(screen.queryByRole('tab',{name:'Stock connection'})).not.toBeInTheDocument();
  expect(fetch.mock.calls.filter(([path])=>String(path).endsWith('/workspace'))).toHaveLength(1);
});
it('shows the effective stock source and retains a different registered URL as reference only', async () => {
  const effectiveStockConnection={status:'known',platform:'autotrader',retailerId:'example',sourceUrl:dealer.sourceUrl+'?sort=price-asc',enabled:false,usesOverride:true};
  vi.stubGlobal('fetch',vi.fn(async path=>String(path).endsWith('/workspace')?Response.json({...workspace,effectiveStockConnection}):Response.json({dealers:[dealer],activity:[]})));
  render(<Platform/>);
  fireEvent.click(await screen.findByRole('button',{name:/Example Dealer/}));
  fireEvent.click(await screen.findByRole('tab',{name:'Stock connection'}));
  const source=screen.getByTestId('platform-stock-source');
  expect(within(source).getByText('Effective source')).toBeInTheDocument();
  expect(within(source).getByText(effectiveStockConnection.sourceUrl)).toBeInTheDocument();
  expect(within(source).getByText('Registered source (reference)')).toBeInTheDocument();
  expect(within(source).getByText(dealer.sourceUrl)).toBeInTheDocument();
  expect(within(source).getByText('Paused in stock connection settings')).toBeInTheDocument();
  expect(screen.getByText(/does not confirm the worker is running/)).toBeInTheDocument();
});
it('does not present an unknown effective source as the active registry source', async () => {
  vi.stubGlobal('fetch',vi.fn(async path=>String(path).endsWith('/workspace')?Response.json({...workspace,effectiveStockConnection:{status:'unknown',platform:null,retailerId:null,sourceUrl:null,enabled:null,usesOverride:null}}):Response.json({dealers:[dealer],activity:[]})));
  render(<Platform/>);
  fireEvent.click(await screen.findByRole('button',{name:/Example Dealer/}));
  fireEvent.click(await screen.findByRole('tab',{name:'Stock connection'}));
  expect(screen.getByRole('status')).toHaveTextContent('The effective stock source could not be confirmed.');
  expect(screen.queryByText('Effective source',{exact:true})).not.toBeInTheDocument();
  expect(screen.getByTestId('platform-stock-source')).toHaveTextContent('Registered source (reference)');
});
it('does not expose dealership controls when platform access is denied', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'Forbidden' }, { status: 403 })));
  render(<Platform />); await screen.findByRole('alert'); expect(screen.queryByRole('button', { name:'Create draft dealership' })).not.toBeInTheDocument();
  expect(screen.getAllByRole('button',{name:'Add dealership'})[0]).toBeDisabled();
});
it('guides draft creation using the current account and real DNS instructions', async () => {
  const fetch = vi.fn(async (path, init) => {
    if (init?.method === 'POST') { const body = JSON.parse(init.body); expect(body.id).toBe('example-dealer'); expect(body.useMyAccount).toBe(true); expect(body.ownerAuthUserId).toBeUndefined(); return Response.json({ dealerId:dealer.id }, {status:201}); }
    if (String(path).endsWith('/workspace')) return Response.json(workspace);
    return Response.json({ dealers:[],activity:[] });
  }); vi.stubGlobal('fetch',fetch); render(<Platform />); await waitFor(() => expect(screen.getAllByRole('button',{name:'Add dealership'})[0]).toBeEnabled());
  fireEvent.click(screen.getAllByRole('button',{name:'Add dealership'})[0]);
  fireEvent.change(screen.getByLabelText('Dealership name'),{target:{value:'Example Dealer'}});
  fireEvent.click(screen.getByRole('button',{name:'Continue'}));
  fireEvent.change(screen.getByLabelText(/^Website origin/),{target:{value:dealer.canonicalOrigin}});
  fireEvent.click(screen.getByRole('button',{name:'Continue'}));
  fireEvent.change(screen.getByLabelText('Owner account'),{target:{value:'self'}});
  fireEvent.click(screen.getByRole('button',{name:'Continue'}));
  fireEvent.change(screen.getByLabelText(/^Grok retailer reference/),{target:{value:'example'}});
  fireEvent.change(screen.getByLabelText('Authorised stock source URL'),{target:{value:dealer.sourceUrl}});
  fireEvent.click(screen.getByRole('button',{name:'Continue'}));
  fireEvent.click(screen.getByRole('button',{name:'Create draft dealership'}));
  await screen.findByText(/Draft dealership created/);
  expect(screen.getByRole('button',{name:'Activate dealership'})).toBeDisabled();
  fireEvent.click(screen.getByRole('tab',{name:'Domains'}));
  expect(screen.getByText('fixture-token')).not.toBeVisible();
  fireEvent.click(screen.getByText('Manual DNS setup',{exact:true}));
  expect(screen.getByText('_dealer-verification.dealer.example.test')).toBeVisible();
  expect(screen.getByText('fixture-token')).toBeVisible();
});
it('keeps manual DNS controls collapsed and opening them makes no domain changes', async () => {
  const writes: string[]=[];
  vi.stubGlobal('fetch',vi.fn(async (path,init)=>{
    if (init?.method && !['GET','HEAD'].includes(init.method)) writes.push(String(path));
    if (String(path).endsWith('/workspace')) return Response.json(workspace);
    if (String(path).endsWith('/domain-automation')) return Response.json({configured:false,reason:'Fictional local test',jobs:[]});
    return Response.json({dealers:[dealer],activity:[]});
  }));
  render(<Platform/>);
  fireEvent.click(await screen.findByRole('button',{name:/Example Dealer/}));
  fireEvent.click(await screen.findByRole('tab',{name:'Domains'}));
  const summary=screen.getByText('Manual DNS setup',{exact:true});
  const details=summary.closest('details')!;
  expect(details).not.toHaveAttribute('open');
  expect(screen.getByLabelText(/^Add another domain/)).not.toBeVisible();
  expect(screen.getByText('fixture-token')).not.toBeVisible();
  expect(screen.getByRole('region',{name:'Automatic domain setup'})).toBeVisible();
  fireEvent.click(summary);
  expect(details).toHaveAttribute('open');
  expect(screen.getByText('fixture-token')).toBeVisible();
  expect(screen.getByRole('button',{name:'Check DNS ownership'})).toBeVisible();
  expect(screen.getByLabelText(/^Add another domain/)).toBeVisible();
  expect(writes).toEqual([]);
});
it('searches dealer names and never invents an import success', async () => {
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({ dealers:[dealer],activity:[] })));
  render(<Platform />); await screen.findAllByText('Example Dealer');
  fireEvent.click(screen.getByRole('button',{name:'Dealerships'}));
  expect(screen.getByText('Last successful import: Not yet')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Search dealerships'),{target:{value:'another'}});
  expect(screen.getByText('No dealerships match these filters')).toBeInTheDocument();
  expect(screen.getByText('Try another search, type or status.')).toBeInTheDocument();
  expect(screen.queryByText('Your first dealership starts here')).not.toBeInTheDocument();
  const section = screen.getByLabelText('Search dealerships').closest('section')!;
  expect(within(section).queryByRole('button', { name: 'Add dealership' })).not.toBeInTheDocument();
});
it('keeps administrator authentication on the platform dashboard', () => {
  auth.signedIn = false; render(<Platform />);
  const signIn = screen.getByTestId('platform-sign-in');
  expect(signIn).toHaveAttribute('data-mode', 'modal');
  expect(signIn).toHaveAttribute('data-return', '/platform');
  expect(signIn).toHaveAttribute('data-sign-up-return', '/platform');
});
it('issues a dealer-specific secret once and clears it when leaving the tab', async () => {
  vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
  const fetch = vi.fn(async (path, init) => {
    if (init?.method === 'POST') {
      expect(String(path)).toBe('/api/platform/dealers/example-dealer/import-key');
      return Response.json({secret:'fictional-test-secret',endpointPath:'/api/stock/imports/example-dealer/grok'}, {status:201});
    }
    if (String(path).endsWith('/workspace')) return Response.json(workspace);
    return Response.json({dealers:[dealer],activity:[]});
  });
  vi.stubGlobal('fetch',fetch); render(<Platform />);
  fireEvent.click(await screen.findByRole('button',{name:/Example Dealer/}));
  fireEvent.click(await screen.findByRole('tab',{name:'Stock connection'}));
  fireEvent.click(screen.getByRole('button',{name:'Create import credential'}));
  await screen.findByText('Save this secret now');
  expect(screen.getByLabelText('Import secret')).toHaveAttribute('type','password');
  expect(screen.getByRole('button',{name:'Create import credential'})).toBeDisabled();
  fireEvent.click(screen.getByRole('tab',{name:'Setup'}));
  expect(screen.queryByLabelText('Import secret')).not.toBeInTheDocument();
});
it('expands price reductions and missing adverts with recorded backend timing', async () => {
 const run = {dealerId:dealer.id,runId:'sample-run',status:'completed',receivedAt:'2026-10-12T15:00:00Z',updatedAt:'2026-10-12T15:00:02Z',scrapedAt:'2026-10-12T14:59:00Z',receivedCount:8,addedCount:1,changedCount:1,missingCount:1};
 vi.stubGlobal('fetch',vi.fn(async path => String(path).endsWith('/imports/sample-run') ? Response.json({duration_ms:2000,change_count:1,previous_run_id:'previous',changes:[{id:'car',advert_id:'advert',title:'Example hatchback',added:false,fields:['sourcePrice'],old_price:'10000',new_price:'9500'}],newly_missing:[{advert_id:'missing',title:'Previous vehicle'}]}) : Response.json({dealers:[dealer],activity:[run]})));
 render(<Platform />); await screen.findAllByText('Example Dealer');
 fireEvent.click(screen.getByRole('button',{name:'Import activity'}));
 expect(screen.getByText('2.00 s')).toBeInTheDocument();
 expect(screen.queryByText('sample-run')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'View vehicle changes'}));
 expect(await screen.findByText('Price reduced: £10,000 → £9,500')).toBeInTheDocument();
 expect(screen.getByText('Absent from source; not marked sold.')).toBeInTheDocument();
 expect(screen.queryByText('Advert advert')).not.toBeInTheDocument();
 expect(screen.queryByText('Advert missing')).not.toBeInTheDocument();
});

it('explains unavailable retained snapshot comparisons without claiming no cars disappeared', async () => {
 const run = {dealerId:dealer.id,runId:'retained-run',status:'completed',receivedAt:'2026-10-01T15:00:00Z',updatedAt:'2026-10-01T15:00:02Z',scrapedAt:'2026-10-01T14:59:00Z',receivedCount:8,addedCount:1,changedCount:0,missingCount:1};
 vi.stubGlobal('fetch',vi.fn(async path => String(path).endsWith('/imports/retained-run') ? Response.json({duration_ms:2000,change_count:0,previous_run_id:'previous',changes:[],newly_missing:null,snapshot_details_available:false}) : Response.json({dealers:[dealer],activity:[run]})));
 render(<Platform />); await screen.findAllByText('Example Dealer');
 fireEvent.click(screen.getByRole('button',{name:'Import activity'}));
 fireEvent.click(screen.getByRole('button',{name:'View vehicle changes'}));
 expect(await screen.findByText(/The original snapshot comparison is no longer retained/)).toBeInTheDocument();
 expect(screen.queryByText('No newly missing adverts.')).not.toBeInTheDocument();
});

it('saves per-dealer onboarding evidence and requires a reason for skipped checks', async () => {
  let entries = {};
  const fetch = vi.fn(async (path, init) => {
    if (init?.method === 'PATCH') {
      expect(String(path)).toBe('/api/platform/dealers/example-dealer/checklist');
      const body = JSON.parse(init.body);
      expect(body).toEqual({itemId:'https',status:'skipped',note:'Test domain only'});
      entries = {https:{...body,updatedAt:'2026-10-13T10:00:00Z',updatedBy:'user_admin'}};
      return Response.json({onboardingChecklist:entries});
    }
    if (String(path).endsWith('/workspace')) return Response.json({...workspace,dealer:{...dealer,onboardingChecklist:entries}});
    return Response.json({dealers:[{...dealer,onboardingChecklist:entries}],activity:[]});
  });
  vi.stubGlobal('fetch',fetch); render(<Platform />);
  fireEvent.click(await screen.findByRole('button',{name:/Example Dealer/}));
  const status = await screen.findByLabelText('Status: Render domain connected and HTTPS tested');
  fireEvent.change(status,{target:{value:'skipped'}});
  const note = screen.getByLabelText('Notes: Render domain connected and HTTPS tested');
  const row = note.closest('.platform-launch-item')!;
  const button = row.querySelector('button')!;
  expect(button).toBeDisabled();
  fireEvent.change(note,{target:{value:'Test domain only'}});
  expect(button).toBeEnabled(); fireEvent.click(button);
  await screen.findByText('Changes saved.');
  expect(screen.getByText(/0 complete · 25 pending · 1 not applicable/)).toBeInTheDocument();
});


it('shows healthy live stock separately from setup tasks', async () => {
  const timestamp = new Date(Date.now() - 60_000).toISOString();
  const run = { runId: 'completed-run', status: 'completed', receivedAt: timestamp, scrapedAt: timestamp, receivedCount: 8 };
  const active = { ...dealer, status: 'active', activeKeyCount: 1, latestImport: run, lastSuccessfulImport: run, isDemo: false };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ dealers: [active], activity: [] })));
  render(<Platform />);
  expect(await screen.findByText('Live stock connections are up to date.')).toBeInTheDocument();
  const section = screen.getByRole('region', { name: 'Dealership attention' });
  expect(within(section).getByText('No setup or suspension tasks need attention.')).toBeInTheDocument();
  expect(within(section).queryByRole('button', { name: 'Add dealership' })).not.toBeInTheDocument();
  expect(screen.queryByText('Your first dealership starts here')).not.toBeInTheDocument();
});

it('retains the first-dealership prompt when the platform has no dealerships', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ dealers: [], activity: [] })));
  render(<Platform />);
  expect(await screen.findByRole('heading', { name: 'Your first dealership starts here' })).toBeInTheDocument();
  const section = screen.getByRole('heading', { name: 'Needs attention' }).closest('section')!;
  expect(within(section).getByRole('button', { name: 'Add dealership' })).toBeEnabled();
  expect(screen.queryByText('Live stock connections are up to date.')).not.toBeInTheDocument();
});


it('keeps an empty status filter separate from an empty platform', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ dealers: [dealer], activity: [] })));
  render(<Platform />);
  await screen.findAllByText('Example Dealer');
  fireEvent.click(screen.getByRole('button', { name: 'Dealerships' }));
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'active' } });
  expect(screen.getByText('No dealerships match these filters')).toBeInTheDocument();
  expect(screen.getByText('Try another search, type or status.')).toBeInTheDocument();
  expect(screen.queryByText('Your first dealership starts here')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'all' } });
  expect(screen.getByRole('button', { name: /Example Dealer/ })).toBeInTheDocument();
});


it('separates live dealers and demos from explicit metadata, including a converted demo', async () => {
  const now = Date.parse('2026-10-18T12:00:00Z');
  vi.spyOn(Date, 'now').mockReturnValue(now);
  const run = { runId: 'fresh', status: 'completed', receivedAt: new Date(now).toISOString(), scrapedAt: new Date(now).toISOString(), receivedCount: 8 };
  const live = { ...dealer, id: 'demo-converted', name: 'Converted Live', status: 'active', isDemo: false, demoExpiresAt: null, activeKeyCount: 1, latestImport: run, lastSuccessfulImport: run };
  const draft = { ...dealer, name: 'Live Draft', isDemo: false };
  const demo = { ...dealer, id: 'ordinary-name', name: 'Current Demo', status: 'active', isDemo: true, demoExpiresAt: '2026-10-19T12:00:00Z' };
  const expired = { ...demo, id: 'expired', name: 'Past Demo', demoExpiresAt: '2026-10-18T11:59:00Z' };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ dealers: [live, draft, demo, expired], activity: [] })));
  render(<Platform />);
  await screen.findByText('Live stock connections are up to date.');
  for (const label of ['Live websites', 'Live in setup', 'Active demos', 'Expired demos']) {
    expect(within(screen.getByRole('article', { name: label })).getByText('1')).toBeInTheDocument();
  }
  const attention = screen.getByRole('region', { name: 'Dealership attention' });
  expect(within(attention).getByText('Live Draft')).toBeInTheDocument();
  expect(within(attention).queryByText('Current Demo')).not.toBeInTheDocument();
  expect(within(attention).queryByText('Past Demo')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Dealerships' }));
  const types = screen.getByRole('group', { name: 'Dealership type' });
  fireEvent.click(within(types).getByRole('button', { name: 'Live 2' }));
  expect(screen.getByText('Converted Live')).toBeInTheDocument();
  expect(screen.queryByText('Current Demo')).not.toBeInTheDocument();
  fireEvent.click(within(types).getByRole('button', { name: 'Demos 1' }));
  expect(screen.getByText('Current Demo')).toBeInTheDocument();
  expect(screen.getByText('Expires 19 Oct 2026, 13:00 (UK)')).toBeInTheDocument();
  expect(screen.queryByText('Converted Live')).not.toBeInTheDocument();
  expect(screen.queryByText('Past Demo')).not.toBeInTheDocument();
  fireEvent.click(within(types).getByRole('button', { name: 'Expired 1' }));
  expect(screen.getByText('Past Demo')).toBeInTheDocument();
  expect(screen.getByText('Expired demo')).toBeInTheDocument();
  expect(screen.queryByText('Current Demo')).not.toBeInTheDocument();
});

it('uses collection freshness, credentials and latest failures for live attention', async () => {
  const now = Date.parse('2026-10-18T12:00:00Z');
  vi.spyOn(Date, 'now').mockReturnValue(now);
  const run = (ageHours: number, status = 'completed') => ({ runId: String(ageHours), status, receivedAt: new Date(now).toISOString(), scrapedAt: new Date(now - ageHours * 3_600_000).toISOString(), receivedCount: 8 });
  const active = (id: string, hours: number, extra = {}) => ({ ...dealer, id, name: id, status: 'active', isDemo: false, activeKeyCount: 1, latestImport: run(hours), lastSuccessfulImport: run(hours), ...extra });
  const dealers = [active('Fresh stock', 12.99), active('Warning stock', 13), active('Overdue stock', 14), active('Missing credential', 1, { activeKeyCount: 0 }), active('Latest failed', 1, { latestImport: run(1, 'failed') }), { ...dealer, name: 'Suspended dealer', status: 'suspended', isDemo: false }];
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ dealers, activity: [] })));
  render(<Platform />);
  const section = await screen.findByRole('region', { name: 'Dealership attention' });
  expect(within(section).getByRole('heading', { name: 'Live website health 4' })).toBeInTheDocument();
  expect(within(section).queryByText('Fresh stock')).not.toBeInTheDocument();
  expect(within(section).getByText('Stock due soon · 13h+')).toBeInTheDocument();
  expect(within(section).getByText('Stock overdue · 14h+')).toBeInTheDocument();
  expect(within(section).getByText('Import credential missing')).toBeInTheDocument();
  expect(within(section).getByText('Last import failed')).toBeInTheDocument();
  expect(within(section).getByRole('heading', { name: 'Setup and suspended dealerships 1' })).toBeInTheDocument();
  expect(within(section).getByText('Suspended · review before reactivating')).toBeInTheDocument();
});

it('supports keyboard navigation between dealer workspace tabs and labels the visible panel', async () => {
  vi.stubGlobal('fetch', vi.fn(async path => String(path).endsWith('/workspace') ? Response.json(workspace) : String(path).endsWith('/demo') ? Response.json({ demo: false }) : Response.json({ dealers: [dealer], activity: [] })));
  render(<Platform />);
  fireEvent.click(await screen.findByRole('button', { name: /Example Dealer/ }));
  const setup = await screen.findByRole('tab', { name: 'Setup' });
  expect(setup).toHaveAttribute('tabindex', '0');
  expect(screen.getByRole('tab', { name: 'Staff' })).toHaveAttribute('tabindex', '-1');
  fireEvent.keyDown(setup, { key: 'End' });
  const demo = screen.getByRole('tab', { name: 'Demo' });
  expect(demo).toHaveFocus();
  expect(demo).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tabpanel', { name: 'Demo' })).toBeInTheDocument();
  fireEvent.keyDown(demo, { key: 'ArrowLeft' });
  const imports = screen.getByRole('tab', { name: 'Imports' });
  expect(imports).toHaveFocus();
  expect(screen.getByRole('tabpanel', { name: 'Imports' })).toHaveTextContent('Latest 30 stock submissions');
  fireEvent.keyDown(imports, { key: 'Home' });
  expect(setup).toHaveFocus();
  expect(screen.getByRole('tabpanel', { name: 'Setup' })).toHaveTextContent('Onboarding checklist');
  expect(screen.getByRole('button', { name: 'Dealerships' })).toHaveAttribute('aria-current', 'page');
});

it('creates a draft with an invitation for an owner who has not registered yet', async () => {
 const writes: any[]=[];
 vi.stubGlobal('fetch',vi.fn(async(path,init)=>{
  if(init?.method==='POST'){writes.push(JSON.parse(init.body));return Response.json({dealerId:dealer.id,ownerInvitation:{deliveryStatus:'sent'}},{status:201});}
  if(String(path).endsWith('/workspace'))return Response.json(workspace);
  return Response.json({dealers:[],activity:[]});
 }));
 render(<Platform/>);await waitFor(()=>expect(screen.getAllByRole('button',{name:'Add dealership'})[0]).toBeEnabled());
 fireEvent.click(screen.getAllByRole('button',{name:'Add dealership'})[0]);
 fireEvent.change(screen.getByLabelText('Dealership name'),{target:{value:'Example Dealer'}});fireEvent.click(screen.getByRole('button',{name:'Continue'}));
 fireEvent.change(screen.getByLabelText(/^Website origin/),{target:{value:dealer.canonicalOrigin}});fireEvent.click(screen.getByRole('button',{name:'Continue'}));
 expect(screen.getByLabelText('Owner account')).toHaveValue('invite');
 fireEvent.change(screen.getByLabelText(/^Owner email/),{target:{value:'new-owner@example.test'}});fireEvent.click(screen.getByRole('button',{name:'Continue'}));
 fireEvent.change(screen.getByLabelText(/^Grok retailer reference/),{target:{value:'example'}});fireEvent.change(screen.getByLabelText('Authorised stock source URL'),{target:{value:dealer.sourceUrl}});fireEvent.click(screen.getByRole('button',{name:'Continue'}));
 expect(writes).toHaveLength(0);fireEvent.click(screen.getByRole('button',{name:'Create & invite owner'}));await screen.findByText(/owner invitation sent/);
 expect(writes).toHaveLength(1);expect(writes[0]).toMatchObject({inviteOwnerEmail:'new-owner@example.test'});expect(writes[0].ownerAuthUserId).toBeUndefined();expect(writes[0].useMyAccount).toBeUndefined();
});
