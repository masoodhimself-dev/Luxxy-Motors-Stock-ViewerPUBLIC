import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ signedIn: true }));
vi.mock('@clerk/react', () => ({ useAuth: () => ({ isSignedIn: auth.signedIn }), SignInButton: ({ children, mode, forceRedirectUrl, signUpForceRedirectUrl }: { children: React.ReactNode; mode: string; forceRedirectUrl: string; signUpForceRedirectUrl: string }) => <div data-testid="platform-sign-in" data-mode={mode} data-return={forceRedirectUrl} data-sign-up-return={signUpForceRedirectUrl}>{children}</div> }));
import Platform from './platform';
afterEach(() => { vi.unstubAllGlobals(); auth.signedIn = true; });
const dealer = { id:'example-dealer', name:'Example Dealer', canonicalOrigin:'https://dealer.example.test', status:'draft', stockPlatform:'autotrader', retailerId:'example', sourceUrl:'https://www.autotrader.co.uk/example', domains:[], activeKeyCount:0, latestImport:null,lastSuccessfulImport:null };
const workspace = { dealer, domains:[{hostname:'dealer.example.test',verified:false,verificationToken:'fixture-token'}],members:[],imports:[],keys:[] };
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
  fireEvent.click(screen.getByRole('button',{name:'Continue'}));
  fireEvent.change(screen.getByLabelText(/^Grok retailer reference/),{target:{value:'example'}});
  fireEvent.change(screen.getByLabelText('Authorised stock source URL'),{target:{value:dealer.sourceUrl}});
  fireEvent.click(screen.getByRole('button',{name:'Continue'}));
  fireEvent.click(screen.getByRole('button',{name:'Create draft dealership'}));
  await screen.findByText(/Draft dealership created/);
  expect(screen.getByRole('button',{name:'Activate dealership'})).toBeDisabled();
  fireEvent.click(screen.getByRole('tab',{name:'Domains'}));
  expect(screen.getByText('_dealer-verification.dealer.example.test')).toBeInTheDocument();
  expect(screen.getByText('fixture-token')).toBeInTheDocument();
});
it('searches dealer names and never invents an import success', async () => {
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({ dealers:[dealer],activity:[] })));
  render(<Platform />); await screen.findAllByText('Example Dealer');
  fireEvent.click(screen.getByRole('button',{name:'Dealerships'}));
  expect(screen.getByText('Last successful import: Not yet')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Search dealerships'),{target:{value:'another'}});
  expect(screen.getByText('No matching dealerships')).toBeInTheDocument();
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
 fireEvent.click(screen.getByRole('button',{name:'View vehicle changes'}));
 expect(await screen.findByText('Price reduced: £10,000 → £9,500')).toBeInTheDocument();
 expect(screen.getByText('Absent from source; not marked sold.')).toBeInTheDocument();
});
