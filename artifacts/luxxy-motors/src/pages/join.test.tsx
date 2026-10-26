import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const identity=vi.hoisted(()=>({signedIn:false,signOut:vi.fn()}));
vi.mock('@clerk/react',()=>({useAuth:()=>({isLoaded:true,isSignedIn:identity.signedIn}),useUser:()=>({user:{primaryEmailAddress:{emailAddress:'new@example.test'}}}),useClerk:()=>({signOut:identity.signOut}),SignInButton:({children,forceRedirectUrl,signUpForceRedirectUrl}:any)=><div data-testid="join-sign-in" data-return={forceRedirectUrl} data-signup-return={signUpForceRedirectUrl}>{children}</div>}));
import JoinDealership from './join';
import { clearInvitationToken } from '@/lib/account-invitation-token';
const token='a'.repeat(64),preview={dealerName:'Example Motors',role:'salesperson',emailHint:'n•••@example.test',expiresAt:'2026-11-01T12:00:00Z'};
beforeEach(()=>{identity.signedIn=false;identity.signOut.mockReset();clearInvitationToken();sessionStorage.clear();window.history.replaceState({},'',`/join#${token}`);});afterEach(()=>vi.unstubAllGlobals());
it('keeps the secret out of authentication redirects and restores it after sign-in',async()=>{
 const calls:any[]=[];vi.stubGlobal('fetch',vi.fn(async(url,init)=>{calls.push([String(url),init]);return Response.json(preview);}));
 const view=render(<JoinDealership/>);await screen.findByRole('heading',{name:'Join Example Motors'});expect(screen.getByTestId('join-sign-in')).toHaveAttribute('data-return','/join');expect(screen.getByTestId('join-sign-in')).toHaveAttribute('data-signup-return','/join');expect(sessionStorage.getItem('luxxy-account-invitation')).toBe(token);expect(window.location.hash).toBe('');expect(calls[0][0]).not.toContain(token);expect(new Headers(calls[0][1].headers).get('x-account-invitation-token')).toBe(token);
 view.unmount();window.history.replaceState({},'','/join');identity.signedIn=true;render(<JoinDealership/>);await screen.findByRole('button',{name:'Accept invitation'});expect(calls.every(([,init])=>!init.method||init.method==='GET')).toBe(true);
});
it('adds access only after explicit acceptance and clears the capability on success',async()=>{
 identity.signedIn=true;let accepts=0;vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{if(init?.method==='POST'){accepts++;return Response.json({accepted:true,dealerName:'Example Motors',portalUrl:'https://dealer.example.test/portal'});}return Response.json(preview);}));
 render(<JoinDealership/>);await screen.findByRole('button',{name:'Accept invitation'});expect(accepts).toBe(0);fireEvent.click(screen.getByRole('button',{name:'Accept invitation'}));const link=await screen.findByRole('link',{name:'Open dealership portal'});expect(link).toHaveAttribute('href','https://dealer.example.test/portal');expect(accepts).toBe(1);expect(sessionStorage.getItem('luxxy-account-invitation')).toBeNull();expect(window.location.hash).toBe('');
});
it('keeps demo owner setup clearly labelled before and after explicit acceptance without claiming launch',async()=>{
 identity.signedIn=true;let accepts=0;
 vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{if(init?.method==='POST'){accepts++;return Response.json({accepted:true,dealerName:'Example Motors',portalUrl:'https://example.demo.test/portal'});}return Response.json({...preview,role:'owner',demo:true});}));
 render(<JoinDealership/>);
 const note='This invitation gives owner setup access. The dealership remains a demonstration until launch.';
 expect(await screen.findByText(note)).toBeVisible();
 expect(screen.getByText(/You’ve been invited as an owner/)).toBeVisible();
 expect(accepts).toBe(0);
 fireEvent.click(screen.getByRole('button',{name:'Accept invitation'}));
 expect(await screen.findByRole('heading',{name:'Your owner setup access is ready'})).toBeVisible();
 expect(screen.getByText(note)).toBeVisible();
 expect(screen.getByRole('link',{name:'Open dealership portal'})).toHaveAttribute('href','https://example.demo.test/portal');
 expect(screen.queryByRole('heading',{name:'You’re ready'})).toBeNull();
 expect(accepts).toBe(1);
 expect(sessionStorage.getItem('luxxy-account-invitation')).toBeNull();
});
it('keeps ordinary owner invitation wording unchanged',async()=>{
 identity.signedIn=true;
 vi.stubGlobal('fetch',vi.fn(async(_url,init)=>Response.json(init?.method==='POST'?{accepted:true,dealerName:'Example Motors',portalUrl:'https://dealer.example.test/portal'}:{...preview,role:'owner',demo:false})));
 render(<JoinDealership/>);fireEvent.click(await screen.findByRole('button',{name:'Accept invitation'}));
 expect(await screen.findByRole('heading',{name:'You’re ready'})).toBeVisible();
 expect(screen.queryByText(/owner setup access/)).toBeNull();
 expect(screen.queryByText(/remains a demonstration/)).toBeNull();
});
it('shows a draft dealership as setup in progress rather than opening a broken domain',async()=>{
 identity.signedIn=true;vi.stubGlobal('fetch',vi.fn(async(_url,init)=>Response.json(init?.method==='POST'?{accepted:true,dealerName:'Example Motors',portalUrl:null}:preview)));render(<JoinDealership/>);fireEvent.click(await screen.findByRole('button',{name:'Accept invitation'}));await screen.findByText(/website is still being prepared/);expect(screen.queryByRole('link',{name:'Open dealership portal'})).toBeNull();
});
it('keeps mismatched email errors clear and lets the user change account without granting access',async()=>{
 identity.signedIn=true;vi.stubGlobal('fetch',vi.fn(async(_url,init)=>init?.method==='POST'?Response.json({error:'Sign in with the invited email address and verify it before accepting.'},{status:403}):Response.json(preview)));render(<JoinDealership/>);fireEvent.click(await screen.findByRole('button',{name:'Accept invitation'}));await screen.findByRole('alert');expect(screen.queryByRole('link',{name:'Open dealership portal'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Use a different account'}));expect(identity.signOut).toHaveBeenCalledWith({redirectUrl:'/join'});expect(sessionStorage.getItem('luxxy-account-invitation')).toBe(token);
});
it('does not display an accept action for expired or missing invitation links',async()=>{
 identity.signedIn=true;vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:'This invitation has expired or was cancelled.'},{status:410})));render(<JoinDealership/>);expect(await screen.findByRole('alert')).toHaveTextContent('expired');expect(screen.queryByRole('button',{name:'Accept invitation'})).toBeNull();
});

it('does not fall back to an older invitation when a different malformed link is opened',async()=>{
 sessionStorage.setItem('luxxy-account-invitation',token);window.history.replaceState({},'','/join#broken');const fetch=vi.fn();vi.stubGlobal('fetch',fetch);render(<JoinDealership/>);expect(await screen.findByRole('alert')).toHaveTextContent('Open the invitation link');expect(fetch).not.toHaveBeenCalled();
});
