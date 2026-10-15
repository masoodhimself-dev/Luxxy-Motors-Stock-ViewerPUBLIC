import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {DemoOnboardingAccess} from './demo-onboarding-access';
afterEach(()=>vi.unstubAllGlobals());
it('creates bounded access and shows its secret only for the current session',async()=>{
 vi.stubGlobal('confirm',vi.fn().mockReturnValue(true));const writes:any[]=[];
 vi.stubGlobal('fetch',vi.fn(async(_url,init)=>{if(init?.method==='POST'){writes.push(JSON.parse(init.body));return Response.json({secret:'fictional-onboarding-secret'});}return Response.json({keys:[]});}));
 render(<DemoOnboardingAccess/>);fireEvent.click(screen.getByText('Master Bot access'));
 fireEvent.click(screen.getByRole('button',{name:'Create onboarding credential'}));await screen.findByLabelText('Master Bot onboarding secret');
 expect(writes).toEqual([{label:'Master Bot',days:30,maxDemos:20,maxPerDay:5}]);expect(screen.getByLabelText('Master Bot onboarding secret')).toHaveAttribute('type','password');
 fireEvent.click(screen.getByRole('button',{name:'Saved securely — dismiss'}));expect(screen.queryByLabelText('Master Bot onboarding secret')).not.toBeInTheDocument();
});
it('revocation explains that stock credentials are independent',async()=>{
 const confirm=vi.fn().mockReturnValue(true),writes:string[]=[];vi.stubGlobal('confirm',confirm);
 vi.stubGlobal('fetch',vi.fn(async(url,init)=>{if(init?.method==='DELETE'){writes.push(String(url));return Response.json({revoked:true});}return Response.json({keys:[{id:'fictional-key',label:'Test Master',expiresAt:'2026-12-01',maxDemos:2,maxPerDay:1,revokedAt:null}]});}));
 render(<DemoOnboardingAccess/>);fireEvent.click(screen.getByText('Master Bot access'));fireEvent.click(await screen.findByRole('button',{name:'Revoke onboarding access'}));
 await waitFor(()=>expect(writes).toEqual(['/api/platform/onboarding-keys/fictional-key']));expect(confirm.mock.calls[0][0]).toContain('Existing stock-import credentials remain active');
});
