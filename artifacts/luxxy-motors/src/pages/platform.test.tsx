import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ signedIn: true }));
vi.mock('@clerk/react', () => ({ useAuth: () => ({ isSignedIn: auth.signedIn }), SignInButton: ({ children, mode, forceRedirectUrl, signUpForceRedirectUrl }: { children: React.ReactNode; mode: string; forceRedirectUrl: string; signUpForceRedirectUrl: string }) => <div data-testid="platform-sign-in" data-mode={mode} data-return={forceRedirectUrl} data-sign-up-return={signUpForceRedirectUrl}>{children}</div> }));
import Platform from './platform';
afterEach(() => vi.unstubAllGlobals());
it('does not expose the create form when platform access is denied', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type':'application/json' } })));
  render(<Platform />); await screen.findByRole('alert'); expect(screen.queryByRole('button', { name:'Create draft dealership' })).not.toBeInTheDocument();
});
it('creates a draft and explains DNS ownership verification before activation', async () => {
  const fetch = vi.fn(async (_path, init) => {
    if (init?.method === 'POST') { const body = JSON.parse(init.body); expect(body.id).toBe('example-dealer'); expect(body.ownerAuthUserId).toBe('user_example'); return Response.json({ dns: { name:'_dealer-verification.example.test', value:'fixture-token' } }, {status:201}); }
    return Response.json({ dealers:[] });
  }); vi.stubGlobal('fetch',fetch); render(<Platform />); await waitFor(() => expect(fetch).toHaveBeenCalled());
  fireEvent.change(screen.getByLabelText('Internal dealer ID'),{target:{value:'example-dealer'}}); fireEvent.change(screen.getByLabelText('Owner Clerk user ID'),{target:{value:'user_example'}});
  fireEvent.click(screen.getByRole('button',{name:'Create draft dealership'})); await screen.findByText(/Add DNS TXT _dealer-verification.example.test/);
});

it('keeps administrator authentication on the platform dashboard', () => {
  auth.signedIn = false;
  try {
    render(<Platform />);
    const signIn = screen.getByTestId('platform-sign-in');
    expect(signIn).toHaveAttribute('data-mode', 'modal');
    expect(signIn).toHaveAttribute('data-return', '/platform');
    expect(signIn).toHaveAttribute('data-sign-up-return', '/platform');
  } finally { auth.signedIn = true; }
});
