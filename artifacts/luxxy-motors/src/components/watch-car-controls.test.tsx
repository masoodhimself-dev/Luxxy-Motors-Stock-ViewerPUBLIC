import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SavedCarsProvider } from '@/lib/saved-cars-context';
import { WatchCarButton, SavedWatchSummary } from './watch-car-controls';
import { rememberWatchAccess } from '@/lib/vehicle-watches';
import type { Car } from '@/lib/stock-context';

const car = { id:'car-1',make:'Ford',model:'Focus',year:2015,price:2750,images:[],inventoryStatus:'available' } as unknown as Car;
const request = vi.fn();
function mount(element=<WatchCarButton car={car}/>) { const client=new QueryClient({defaultOptions:{queries:{retry:false}}}); return render(<QueryClientProvider client={client}><SavedCarsProvider>{element}</SavedCarsProvider></QueryClientProvider>); }
beforeEach(()=>{window.localStorage.clear();request.mockReset();vi.stubGlobal('fetch',request);request.mockImplementation(async(path:string)=>({ok:true,json:async()=>path.endsWith('/availability')?{enabled:true,emailReady:true}:{accepted:true}}));});
it('opens a clear email request without reserving or creating an enquiry',async()=>{
 mount();fireEvent.click(await screen.findByRole('button',{name:'Watch this car'}));
 expect(screen.getByText(/No account needed/)).toBeVisible();
 fireEvent.change(screen.getByLabelText('Your email'),{target:{value:'alex@example.test'}});
 fireEvent.click(screen.getByRole('button',{name:'Email me updates'}));
 expect(await screen.findByRole('heading',{name:'Check your email'})).toBeVisible();
 expect(JSON.parse(window.localStorage.getItem('luxxy.saved-cars.v1')!)).toEqual(['car-1']);
 const post=request.mock.calls.find(([,init])=>init.method==='POST')!;
 expect(post[0]).toBe('/api/vehicle-watches');expect(JSON.parse(post[1].body)).toEqual({vehicleId:'car-1',email:'alex@example.test',website:''});
 expect(post[1]).toMatchObject({credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});
 expect(screen.queryByText('Watching')).not.toBeInTheDocument();
 expect(request.mock.calls.every(([path])=>String(path).startsWith('/api/vehicle-watches'))).toBe(true);
});
it('keeps typed details on failure and does not claim confirmation or save the car',async()=>{
 request.mockImplementation(async(path:string,init:RequestInit)=>({ok:init.method!=='POST',json:async()=>init.method==='POST'?{error:'Email connection is unavailable.'}:{enabled:true,emailReady:true}}));
 mount();fireEvent.click(await screen.findByRole('button',{name:'Watch this car'}));fireEvent.change(screen.getByLabelText('Your email'),{target:{value:'alex@example.test'}});fireEvent.click(screen.getByRole('button',{name:'Email me updates'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Email connection');expect(screen.getByLabelText('Your email')).toHaveValue('alex@example.test');expect(window.localStorage.getItem('luxxy.saved-cars.v1')).toBe('[]');
});
it.each([{enabled:false,emailReady:true},{enabled:true,emailReady:false}])('does not offer signup when unavailable: %j',async state=>{
 request.mockResolvedValue({ok:true,json:async()=>state});mount();await waitFor(()=>expect(request).toHaveBeenCalled());expect(screen.queryByRole('button',{name:'Watch this car'})).not.toBeInTheDocument();
});
it('shows verified watching state and links to management without another request email',async()=>{
 rememberWatchAccess('a'.repeat(43),'2099-01-01T00:00:00Z');
 request.mockImplementation(async(path:string)=>({ok:true,json:async()=>path.endsWith('/availability')?{enabled:true,emailReady:true}:{expiresAt:'2099-01-01T00:00:00Z',watches:[{id:'w1',vehicleId:'car-1',status:'active'}]}}));
 mount();expect(await screen.findByRole('link',{name:'Watching'})).toHaveAttribute('href','/watch');expect(request.mock.calls.some(([,init])=>init.method==='POST')).toBe(false);
});
it('keeps management accessible even when new signups are switched off',async()=>{
 mount(<SavedWatchSummary/>);expect(screen.getByRole('link',{name:'Manage updates'})).toHaveAttribute('href','/watch');
});
it('does not replace an existing saved shortlist when requesting a watch',async()=>{
 window.localStorage.setItem('luxxy.saved-cars.v1',JSON.stringify(['another-car','car-1']));mount();fireEvent.click(await screen.findByRole('button',{name:'Watch this car'}));fireEvent.change(screen.getByLabelText('Your email'),{target:{value:'alex@example.test'}});fireEvent.click(screen.getByRole('button',{name:'Email me updates'}));await screen.findByRole('heading',{name:'Check your email'});expect(JSON.parse(window.localStorage.getItem('luxxy.saved-cars.v1')!)).toEqual(['another-car','car-1']);
});
it('does not toggle off a car saved in another tab while signup is pending',async()=>{
 let finish!:(value:unknown)=>void;request.mockImplementation(async(path:string,init:RequestInit)=>init.method==='POST'?new Promise(resolve=>{finish=resolve;}):{ok:true,json:async()=>({enabled:true,emailReady:true})});
 mount();fireEvent.click(await screen.findByRole('button',{name:'Watch this car'}));fireEvent.change(screen.getByLabelText('Your email'),{target:{value:'alex@example.test'}});fireEvent.click(screen.getByRole('button',{name:'Email me updates'}));
 await act(async()=>{window.localStorage.setItem('luxxy.saved-cars.v1','["car-1"]');window.dispatchEvent(new StorageEvent('storage',{key:'luxxy.saved-cars.v1',newValue:'["car-1"]'}));});
 await act(async()=>finish({ok:true,json:async()=>({accepted:true})}));expect(await screen.findByRole('heading',{name:'Check your email'})).toBeVisible();expect(window.localStorage.getItem('luxxy.saved-cars.v1')).toBe('["car-1"]');
});
