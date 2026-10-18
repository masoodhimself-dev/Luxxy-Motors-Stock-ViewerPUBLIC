import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { dealerConfig } from '@/config/dealer';
import type { Car } from '@/lib/stock-context';
const state = vi.hoisted(() => ({ hours: [] as {days:string;times:string}[], enabled:true, loading:false, error:false, pending:false, mutate:vi.fn(), intent:vi.fn() }));
vi.mock('@/lib/dealer-settings-context', () => ({ useDealerSettings: () => ({settings:{...dealerConfig,identity:{...dealerConfig.identity,name:'Example Motors'},contact:{phone:'07388831790'},address:{street:'Rear of 176 Rayners Lane',city:'London',postcode:'HA2 8LY'},hours:state.hours},isLoading:state.loading,isError:state.error}) }));
vi.mock('@/lib/dealer-features', () => ({useDealerFeatures:()=>({enabled:()=>state.enabled})}));
vi.mock('@workspace/api-client-react',()=>({useCreateEnquiry:()=>({mutate:state.mutate,isPending:state.pending,isSuccess:false,isError:false})}));
vi.mock('@/lib/cta-helpers',()=>({getPhoneHref:()=> 'tel:07388831790',recordContactIntent:state.intent}));
import { VehicleCall } from './vehicle-call';
const car = {id:'test-car',make:'MG',model:'HS',title:'MG HS',price:15375,year:2025,images:[],inventoryStatus:'available'} as unknown as Car;
function show() { return render(<VehicleCall car={car}/>); }
function open() { fireEvent.click(screen.getByRole('link',{name:'Call about MG HS'})); return screen.getByRole('dialog'); }
beforeEach(()=>{
 vi.useFakeTimers({toFake:['Date','setInterval','clearInterval']});
 vi.setSystemTime(new Date('2026-10-19T09:00:00Z'));
 state.hours=[{days:'Monday – Saturday',times:'08:00 – 18:00'},{days:'Sunday',times:'Closed'}];
 state.enabled=true;state.loading=false;state.error=false;state.pending=false;state.mutate.mockReset();state.intent.mockClear();
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
it('shows the car, full showroom location, closing time and direct call action together',()=>{
 show(); const dialog=open();
 expect(dialog).toHaveTextContent('Open now'); expect(dialog).toHaveTextContent('Closes at 18:00 today');
 expect(dialog).toHaveTextContent('Rear of 176 Rayners Lane, London, HA2 8LY');
 expect(within(dialog).getByRole('link',{name:/Call the showroom/})).toHaveAttribute('href','tel:07388831790');
 expect(within(dialog).getByRole('link',{name:'Get directions'})).toHaveAttribute('href',expect.stringContaining('Rear%20of%20176%20Rayners%20Lane'));
 expect(state.mutate).not.toHaveBeenCalled();
});
it('shows confirmed Sunday closure and next opening without forcing a form',()=>{
 vi.setSystemTime(new Date('2026-10-18T13:00:00Z'));show();const dialog=open();
 expect(dialog).toHaveTextContent('Closed today');expect(dialog).toHaveTextContent('Opens tomorrow at 08:00 (UK time)');
 expect(screen.queryByRole('textbox',{name:'Your name'})).not.toBeInTheDocument();
 fireEvent.click(within(dialog).getByRole('button',{name:'Request a callback'}));
 expect(screen.getByRole('textbox',{name:'Your name'})).toBeVisible();
 expect(state.mutate).not.toHaveBeenCalled();
});
it('does not call an unconfigured Sunday closed or invent its hours',()=>{
 state.hours=[{days:'Monday – Saturday',times:'08:00 – 18:00'}];vi.setSystemTime(new Date('2026-10-18T13:00:00Z'));
 show();const dialog=open();expect(dialog).toHaveTextContent('Hours to confirm');expect(dialog).toHaveTextContent('Today’s hours aren’t confirmed');expect(dialog).not.toHaveTextContent('Closed today');
});
it('updates automatically across closing time while the panel is open',()=>{
 vi.setSystemTime(new Date('2026-10-19T16:59:50Z'));show();const dialog=open();expect(dialog).toHaveTextContent('Closing soon');
 act(()=>vi.advanceTimersByTime(30_000));
 expect(dialog).toHaveTextContent('Closed now');expect(dialog).toHaveTextContent('Closed at 18:00 today');expect(dialog).toHaveTextContent('Opens tomorrow');
});
it('keeps a same-day opening distinct from closed all day',()=>{
 vi.setSystemTime(new Date('2026-10-19T05:00:00Z'));show();const dialog=open();expect(dialog).toHaveTextContent('Closed now');expect(dialog).toHaveTextContent('Opens today at 08:00');expect(dialog).not.toHaveTextContent('Closed today');
});
it.each(['loading','error'] as const)('does not present fallback address or hours as confirmed while settings %s',kind=>{
 state[kind]=true;show();const dialog=open();expect(dialog).not.toHaveTextContent('Rear of 176');expect(dialog).not.toHaveTextContent('Open now');expect(within(dialog).queryByRole('link',{name:'Get directions'})).not.toBeInTheDocument();
});
it('keeps calling available when online enquiries are switched off',()=>{
 state.enabled=false;show();const dialog=open();expect(within(dialog).getByRole('link',{name:/Call the showroom/})).toBeVisible();expect(within(dialog).queryByRole('button',{name:'Request a callback'})).not.toBeInTheDocument();
});
it('sends a callback only after the visitor submits their details, with the correct car',()=>{
 show();const dialog=open();fireEvent.click(within(dialog).getByRole('button',{name:'Request a callback'}));
 fireEvent.change(screen.getByRole('textbox',{name:'Your name'}),{target:{value:'Alex Buyer'}});
 fireEvent.change(screen.getByRole('textbox',{name:'Telephone'}),{target:{value:'07700 900123'}});
 fireEvent.submit(screen.getByRole('form',{name:'Request a callback'}));
 expect(state.mutate).toHaveBeenCalledOnce();expect(state.mutate).toHaveBeenCalledWith({data:expect.objectContaining({vehicleId:'test-car',requestCallback:true,customerName:'Alex Buyer',phone:'07700900123',appointmentAt:null})});
});
it('keeps the same contact sheet on phones instead of unexpectedly launching the dialler',()=>{
 show();const link=screen.getByRole('link',{name:'Call about MG HS'});const event=new MouseEvent('click',{bubbles:true,cancelable:true});
 act(()=>link.dispatchEvent(event));expect(event.defaultPrevented).toBe(true);expect(screen.getByRole('dialog')).toHaveTextContent('Let’s talk about this car');
});
