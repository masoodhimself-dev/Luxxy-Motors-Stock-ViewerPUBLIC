import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {beforeEach,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({settings:{delivery:{enabled:true},deliveryPricing:{enabled:true,basePrice:'50.00',pricePerMile:'1.50'},address:{postcode:'HA2 7LU'}},fetch:vi.fn()}));
vi.mock('@/lib/dealer-settings-context',()=>({useDealerSettings:()=>({settings:state.settings})}));
vi.mock('@workspace/api-client-react',()=>({customFetch:(...args:unknown[])=>state.fetch(...args)}));
vi.mock('./postcode-field',()=>({PostcodeField:({label,value,onChange}:any)=><label>{label}<input value={value} onChange={e=>onChange(e.target.value)}/></label>}));
import {DeliveryEstimator} from './delivery-estimator';
const quote={postcode:'SW1A 1AA',roadMiles:23.4,basePricePence:5000,pricePerMilePence:150,mileageChargePence:3510,totalPence:8510,distanceBasis:'driving',estimated:true};
beforeEach(()=>{state.settings.delivery.enabled=true;state.settings.deliveryPricing.enabled=true;state.fetch.mockReset();state.fetch.mockResolvedValue(quote);});
function open(){fireEvent.click(screen.getByText('Estimate your delivery cost'));}
it('requests the road estimate only when asked and displays a matching price breakdown',async()=>{
 render(<DeliveryEstimator/>);open();expect(state.fetch).not.toHaveBeenCalled();fireEvent.change(screen.getByLabelText('Delivery postcode'),{target:{value:'SW1A1AA'}});fireEvent.click(screen.getByRole('button',{name:'Calculate delivery'}));await screen.findByText('£85.10');expect(screen.getByText(/23.4 road miles/)).toBeVisible();expect(screen.getByText('£35.10')).toBeVisible();expect(state.fetch.mock.calls[0][0]).toBe('/api/postcodes/delivery-estimate?postcode=SW1A1AA');
 expect(screen.getByText(/Nothing is booked or charged/)).toBeVisible();
});
it('does not substitute straight-line distance or a zero price when road routing fails',async()=>{
 state.fetch.mockRejectedValue({data:{code:'routing_not_configured'}});render(<DeliveryEstimator/>);open();fireEvent.change(screen.getByLabelText('Delivery postcode'),{target:{value:'SW1A1AA'}});fireEvent.click(screen.getByRole('button',{name:'Calculate delivery'}));await screen.findByRole('alert');expect(screen.queryByText('£0.00')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Calculate delivery'})).toBeEnabled();
});
it('ignores a stale quote after the customer changes their postcode',async()=>{
 let resolve:(value:unknown)=>void=()=>{};state.fetch.mockImplementation(()=>new Promise(r=>resolve=r));render(<DeliveryEstimator/>);open();const field=screen.getByLabelText('Delivery postcode');fireEvent.change(field,{target:{value:'SW1A1AA'}});fireEvent.click(screen.getByRole('button',{name:'Calculate delivery'}));fireEvent.change(field,{target:{value:'N1 1AA'}});resolve(quote);await waitFor(()=>expect(screen.queryByText('£85.10')).not.toBeInTheDocument());
});
it('keeps the calculator absent when delivery or estimation is disabled',()=>{
 state.settings.deliveryPricing.enabled=false;const {rerender}=render(<DeliveryEstimator/>);expect(screen.queryByText('Estimate your delivery cost')).not.toBeInTheDocument();state.settings.deliveryPricing.enabled=true;state.settings.delivery.enabled=false;rerender(<DeliveryEstimator/>);expect(screen.queryByText('Estimate your delivery cost')).not.toBeInTheDocument();expect(state.fetch).not.toHaveBeenCalled();
});
