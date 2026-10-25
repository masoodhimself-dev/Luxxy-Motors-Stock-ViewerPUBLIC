import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import WatchPage from './watch';
import { rememberWatchAccess, watchAccess } from '@/lib/vehicle-watches';

const verifyToken='a_'.repeat(21)+'-',manageToken='B-'.repeat(21)+'_',nextToken='c'.repeat(43),expiry='2099-01-01T00:00:00Z';
const watch={id:'watch-1',vehicleId:'car-1',vehicleTitle:'Ford Focus',vehicleUrl:'/vehicle/car-1',status:'active'};
const request=vi.fn();
const response=(data:unknown,ok=true)=>({ok,json:async()=>data});
beforeEach(()=>{window.localStorage.clear();window.history.replaceState({},'',`/watch#${verifyToken}`);request.mockReset();vi.stubGlobal('fetch',request);});
it('opening a confirmation link cannot start updates before an explicit click',async()=>{
 request.mockResolvedValue(response({verificationRequired:true,vehicleTitle:'Ford Focus',emailHint:'a…@example.test'}));render(<WatchPage/>);
 expect(await screen.findByRole('button',{name:'Confirm updates'})).toBeVisible();expect(request).toHaveBeenCalledTimes(1);expect(request.mock.calls[0][0]).toBe('/api/vehicle-watches/manage');expect(request.mock.calls[0][1]).toMatchObject({credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',headers:{'x-vehicle-watch-token':verifyToken}});expect(watchAccess()).toBeNull();
});
it('confirms, remembers private management access and shows watching without an account',async()=>{
 request.mockImplementation(async(path:string,init:RequestInit)=>path.endsWith('/verify')?response({verified:true,token:manageToken,expiresAt:expiry,watches:[watch]}):response((init.headers as Record<string,string>)['x-vehicle-watch-token']===manageToken?{expiresAt:expiry,watches:[watch]}:{verificationRequired:true,vehicleTitle:'Ford Focus'}));
 render(<WatchPage/>);fireEvent.click(await screen.findByRole('button',{name:'Confirm updates'}));expect(await screen.findByText('Watching · price and availability updates')).toBeVisible();expect(screen.getByRole('status')).toHaveTextContent('Updates confirmed');expect(watchAccess()?.token).toBe(manageToken);expect(window.location.hash).toBe('');expect(request.mock.calls.filter(([,init])=>init.method==='POST')).toHaveLength(1);
});
it('stopping a watch leaves saved cars unchanged and refreshes the server result',async()=>{
 window.history.replaceState({},'',`/watch#${manageToken}`);window.localStorage.setItem('luxxy.saved-cars.v1','["car-1"]');let stopped=false;
 request.mockImplementation(async(path:string)=>{if(path.endsWith('/stop')){stopped=true;return response({stopped:true});}return response({expiresAt:expiry,watches:[{...watch,status:stopped?'stopped':'active'}]});});
 render(<WatchPage/>);fireEvent.click(await screen.findByRole('button',{name:'Stop watching Ford Focus'}));expect(await screen.findByText('Updates stopped')).toBeVisible();expect(window.localStorage.getItem('luxxy.saved-cars.v1')).toBe('["car-1"]');expect(screen.queryByRole('button',{name:'Stop watching Ford Focus'})).not.toBeInTheDocument();
});
it('an expired link exposes no previous customer list and offers a fresh emailed link',async()=>{
 request.mockResolvedValue(response({error:'This private link has expired.'},false));render(<WatchPage/>);expect(await screen.findByRole('alert')).toHaveTextContent('expired');expect(screen.queryByRole('list',{name:'Your watched cars'})).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Email my management link'})).toBeVisible();
});
it('requests a management email without creating a new watch or assuming an address exists',async()=>{
 window.history.replaceState({},'','/watch');request.mockResolvedValue(response({accepted:true}));render(<WatchPage/>);fireEvent.change(await screen.findByLabelText('Your email'),{target:{value:'alex@example.test'}});fireEvent.click(screen.getByRole('button',{name:'Email my management link'}));expect(await screen.findByRole('status')).toHaveTextContent('If this address has car updates');expect(request.mock.calls[0][0]).toBe('/api/vehicle-watches/manage-link');expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({email:'alex@example.test',website:''});
});
it('can forget browser access without stopping updates or clearing the shortlist',async()=>{
 window.history.replaceState({},'','/watch');rememberWatchAccess(manageToken,expiry);window.localStorage.setItem('luxxy.saved-cars.v1','["car-1"]');request.mockResolvedValue(response({expiresAt:expiry,watches:[watch]}));render(<WatchPage/>);fireEvent.click(await screen.findByRole('button',{name:'Forget this browser'}));expect(watchAccess()).toBeNull();expect(window.localStorage.getItem('luxxy.saved-cars.v1')).toBe('["car-1"]');expect(await screen.findByLabelText('Your email')).toBeVisible();expect(request.mock.calls.some(([,init])=>init.method==='POST')).toBe(false);
});
it('does not let a late response from a previous link show the wrong customer',async()=>{
 let finish!:(value:unknown)=>void;request.mockImplementation(async(_path:string,init:RequestInit)=>(init.headers as Record<string,string>)['x-vehicle-watch-token']===verifyToken?new Promise(resolve=>{finish=resolve;}):response({expiresAt:expiry,watches:[{...watch,vehicleTitle:'Nissan Qashqai'}]}));render(<WatchPage/>);await waitFor(()=>expect(request).toHaveBeenCalledTimes(1));await act(async()=>{window.history.replaceState({},'',`/watch#${nextToken}`);window.dispatchEvent(new HashChangeEvent('hashchange'));});expect(await screen.findByText('Nissan Qashqai')).toBeVisible();await act(async()=>finish(response({expiresAt:expiry,watches:[watch]})));expect(screen.queryByText('Ford Focus')).not.toBeInTheDocument();expect(watchAccess()?.token).toBe(nextToken);
});
it('keeps the confirmation action available after a failed request',async()=>{
 request.mockImplementation(async(path:string)=>path.endsWith('/verify')?response({error:'Please try again.'},false):response({verificationRequired:true,vehicleTitle:'Ford Focus'}));render(<WatchPage/>);fireEvent.click(await screen.findByRole('button',{name:'Confirm updates'}));expect(await screen.findByRole('alert')).toHaveTextContent('try again');expect(screen.getByRole('button',{name:'Confirm updates'})).toBeEnabled();expect(watchAccess()).toBeNull();
});
it('shows opt-out success even if refreshing the list fails afterwards',async()=>{
 window.history.replaceState({},'',`/watch#${manageToken}`);let stopped=false;
 request.mockImplementation(async(path:string)=>{if(path.endsWith('/stop')){stopped=true;return response({stopped:true});}return stopped?response({error:'Connection lost.'},false):response({expiresAt:expiry,watches:[watch]});});
 render(<WatchPage/>);fireEvent.click(await screen.findByRole('button',{name:'Stop watching Ford Focus'}));expect(await screen.findByText('Updates stopped')).toBeVisible();expect(await screen.findByRole('alert')).toHaveTextContent('Updates were stopped');expect(screen.queryByRole('button',{name:'Stop watching Ford Focus'})).not.toBeInTheDocument();
});
it('forgets a remembered identity when another tab removes browser access',async()=>{
 window.history.replaceState({},'','/watch');rememberWatchAccess(manageToken,expiry);request.mockResolvedValue(response({expiresAt:expiry,watches:[watch]}));render(<WatchPage/>);expect(await screen.findByText('Ford Focus')).toBeVisible();await act(async()=>{window.localStorage.clear();window.dispatchEvent(new StorageEvent('storage'));});expect(await screen.findByLabelText('Your email')).toBeVisible();expect(screen.queryByText('Ford Focus')).not.toBeInTheDocument();
});
it('keeps management usable when private-browser storage is unavailable',async()=>{
 request.mockImplementation(async(path:string,init:RequestInit)=>path.endsWith('/verify')?response({verified:true,token:manageToken,expiresAt:expiry,watches:[watch]}):response((init.headers as Record<string,string>)['x-vehicle-watch-token']===manageToken?{expiresAt:expiry,watches:[watch]}:{verificationRequired:true,vehicleTitle:'Ford Focus'}));
 const write=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('Storage blocked');});
 try {render(<WatchPage/>);fireEvent.click(await screen.findByRole('button',{name:'Confirm updates'}));expect(await screen.findByRole('button',{name:'Stop watching Ford Focus'})).toBeVisible();expect(window.location.hash).toBe(`#${manageToken}`);expect(screen.getByText(/This browser cannot remember your access/)).toBeVisible();}finally{write.mockRestore();}
});
it('ignores an old management-email response after a different confirmation link opens',async()=>{
 window.history.replaceState({},'','/watch');let finish!:(value:unknown)=>void;request.mockImplementation(async(path:string)=>path.endsWith('/manage-link')?new Promise(resolve=>{finish=resolve;}):response({verificationRequired:true,vehicleTitle:'New car'}));render(<WatchPage/>);fireEvent.change(await screen.findByLabelText('Your email'),{target:{value:'alex@example.test'}});fireEvent.click(screen.getByRole('button',{name:'Email my management link'}));await act(async()=>{window.history.replaceState({},'',`/watch#${nextToken}`);window.dispatchEvent(new HashChangeEvent('hashchange'));});expect(await screen.findByRole('button',{name:'Confirm updates'})).toBeVisible();await act(async()=>finish(response({accepted:true})));expect(screen.queryByText(/If this address has car updates/)).not.toBeInTheDocument();
});
