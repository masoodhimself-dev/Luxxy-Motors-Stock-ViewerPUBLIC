import {act,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,expect,it,vi} from 'vitest';
import {AccountInvitations} from './account-invitations';
const clients:QueryClient[]=[];
afterEach(()=>{clients.splice(0).forEach(client=>client.clear());vi.unstubAllGlobals();});
const pending={id:'invite-one',email:'new@example.test',role:'salesperson',status:'pending',deliveryStatus:'sent',expiresAt:'2026-11-01T10:00:00Z'};
function show(platform=false,demoSetup=false){const client=new QueryClient({defaultOptions:{queries:{retry:false}}});clients.push(client);render(<QueryClientProvider client={client}><AccountInvitations {...platform?{dealerId:'dealer',ownerOnly:true,demoSetup}:{}}/></QueryClientProvider>);return client;}
it('sends one explicit invitation without granting access or requiring pre-registration',async()=>{
 let invited=false;const calls:any[]=[];vi.stubGlobal('fetch',vi.fn(async(url,init)=>{calls.push([String(url),init]);if(init?.method==='POST'){invited=true;return Response.json({invitation:pending});}return Response.json({invitations:invited?[pending]:[],email:{ready:true,message:'Ready'}});}));
 show();await screen.findByRole('button',{name:'Send invitation'});expect(calls.every(([,init])=>!init?.method||init.method==='GET')).toBe(true);
 fireEvent.change(screen.getByRole('textbox',{name:'Email address'}),{target:{value:'new@example.test'}});fireEvent.change(screen.getByRole('combobox',{name:'Invitation role'}),{target:{value:'accounts'}});
 expect(calls.filter(([,init])=>init?.method==='POST')).toHaveLength(0);fireEvent.click(screen.getByRole('button',{name:'Send invitation'}));await screen.findByText('Invitation email sent. Access starts when they accept.');
 const writes=calls.filter(([,init])=>init?.method==='POST');expect(writes).toHaveLength(1);expect(writes[0][0]).toBe('/api/staff/team/invitations');expect(JSON.parse(writes[0][1].body)).toEqual({email:'new@example.test',role:'accounts'});expect(screen.getByText('Awaiting acceptance')).toBeInTheDocument();expect(screen.getByRole('textbox',{name:'Email address'})).toHaveValue('');
});
it('platform invitations always request owner access for the selected dealership',async()=>{
 const writes:any[]=[];vi.stubGlobal('fetch',vi.fn(async(url,init)=>{if(init?.method==='POST'){writes.push([String(url),JSON.parse(init.body)]);return Response.json({invitation:{...pending,role:'owner'}});}return Response.json({invitations:[],email:{ready:true,message:'Ready'}});}));
 show(true);await screen.findByRole('button',{name:'Send owner invitation'});expect(screen.queryByRole('combobox')).toBeNull();fireEvent.change(screen.getByRole('textbox',{name:'Email address'}),{target:{value:'new@example.test'}});fireEvent.click(screen.getByRole('button',{name:'Send owner invitation'}));await screen.findByRole('status');expect(writes).toEqual([['/api/platform/dealers/dealer/invitations',{email:'new@example.test',role:'owner'}]]);
});
it('explains demo owner setup without sending or offering staff roles automatically',async()=>{
 const fetch=vi.fn(async()=>Response.json({invitations:[],email:{ready:true,message:'Ready'}}));vi.stubGlobal('fetch',fetch);
 show(true,true);await screen.findByRole('button',{name:'Send owner invitation'});
 expect(screen.getByRole('note')).toHaveTextContent('The dealership stays a demonstration until conversion');
 expect(screen.getByRole('note')).toHaveTextContent('staff invitations become available after launch');
 expect(screen.queryByRole('combobox')).toBeNull();expect(fetch.mock.calls.every((call:any[])=>!call[1]?.method||call[1].method==='GET')).toBe(true);
});
it('does not claim an uncertain email was sent and retains an explicit resend',async()=>{
 vi.stubGlobal('fetch',vi.fn(async(_url,init)=>init?.method==='POST'?Response.json({invitation:{...pending,deliveryStatus:'unknown'}}):Response.json({invitations:[{...pending,deliveryStatus:'unknown'}],email:{ready:true,message:'Ready'}})));
 show();await screen.findByText('Email not confirmed');fireEvent.click(screen.getByRole('button',{name:'Resend'}));await screen.findByText(/email delivery could not be confirmed/);expect(screen.queryByText('Invitation email sent. Access starts when they accept.')).toBeNull();
});
it('requires confirmation before cancelling and never changes an accepted invitation',async()=>{
 const writes:string[]=[];const confirm=vi.fn().mockReturnValue(false);vi.stubGlobal('confirm',confirm);vi.stubGlobal('fetch',vi.fn(async(url,init)=>{if(init?.method==='POST'){writes.push(String(url));return Response.json({invitation:{...pending,status:'cancelled'}});}return Response.json({invitations:[pending,{...pending,id:'accepted',email:'accepted@example.test',status:'accepted',acceptedAt:'2026-10-22T10:00:00Z'}],email:{ready:true,message:'Ready'}});}));
 show();await screen.findByText('Accepted',{exact:true});expect(screen.getAllByRole('button',{name:'Cancel'})).toHaveLength(1);fireEvent.click(screen.getByRole('button',{name:'Cancel'}));expect(writes).toHaveLength(0);confirm.mockReturnValue(true);fireEvent.click(screen.getByRole('button',{name:'Cancel'}));await screen.findByText('Invitation cancelled. Its link will no longer work.');expect(writes).toEqual(['/api/staff/team/invitations/invite-one/cancel']);
});
it('blocks sends when mail is unavailable and preserves typed email on failure',async()=>{
 let ready=false;vi.stubGlobal('fetch',vi.fn(async(_url,init)=>init?.method==='POST'?Response.json({error:'Already invited. Use Resend.'},{status:409}):Response.json({invitations:[],email:{ready,message:'Ask the platform administrator to configure account email.'}})));
 const client=show();await screen.findByText(/configure account email/);fireEvent.change(screen.getByRole('textbox',{name:'Email address'}),{target:{value:'new@example.test'}});expect(screen.getByRole('button',{name:'Send invitation'})).toBeDisabled();ready=true;await act(async()=>client.invalidateQueries());await waitFor(()=>expect(screen.getByRole('button',{name:'Send invitation'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Send invitation'}));await screen.findByRole('alert');expect(screen.getByRole('textbox',{name:'Email address'})).toHaveValue('new@example.test');
});
