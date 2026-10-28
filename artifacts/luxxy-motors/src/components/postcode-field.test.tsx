import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {useState} from 'react';
const state=vi.hoisted(()=>({fetch:vi.fn()}));
vi.mock('@workspace/api-client-react',()=>({customFetch:(...args:unknown[])=>state.fetch(...args)}));
import {PostcodeField,AddressPostcodeHelper,OptionalJourneyPostcode} from './postcode-field';
const location={postcode:'HA2 7LU',latitude:51.57,longitude:-0.37,region:'London',administrativeArea:'Harrow'};
beforeEach(()=>{state.fetch.mockReset();state.fetch.mockImplementation(async(url:string)=>url.includes('distance')?{miles:3.2}:url.includes('query=')?{postcodes:['HA2 7LU','HA2 7LX']}:{location});});
afterEach(()=>vi.useRealTimers());
function Field(){const [value,setValue]=useState('');return <PostcodeField value={value} onChange={setValue} showDistance/>;}
it('debounces postcode suggestions, supports keyboard selection, verifies and shows approximate distance',async()=>{
 render(<Field/>);const input=screen.getByRole('combobox',{name:'Postcode'});fireEvent.focus(input);fireEvent.change(input,{target:{value:'HA2'}});
 expect(state.fetch).not.toHaveBeenCalled();await screen.findByRole('listbox');
 fireEvent.keyDown(input,{key:'ArrowDown'});fireEvent.keyDown(input,{key:'Enter'});
 expect(input).toHaveValue('HA2 7LU');await screen.findByText(/About 3.2 miles/);expect(screen.getByRole('status')).toHaveTextContent('Harrow, London');
 expect(state.fetch.mock.calls[0][0]).toBe('/api/postcodes?query=HA2');
});
it('lets manual postcode entry continue during provider failures without making it required',async()=>{
 state.fetch.mockRejectedValue({data:{code:'timeout'}});render(<Field/>);const input=screen.getByRole('combobox');fireEvent.change(input,{target:{value:'HA2 7LU'}});
 await screen.findByText(/lookup unavailable/);expect(input).toHaveValue('HA2 7LU');expect(input).not.toBeRequired();
});
it('distinguishes a postcode not found from an outage',async()=>{
 state.fetch.mockRejectedValue({data:{code:'not_found'}});render(<Field/>);fireEvent.change(screen.getByRole('combobox'),{target:{value:'HA2 7LU'}});await screen.findByText(/Postcode not found/);
});
it('ignores stale results even if the transport does not honour abort',async()=>{
 let resolve:(value:unknown)=>void=()=>{};state.fetch.mockImplementationOnce(()=>new Promise(r=>resolve=r));render(<Field/>);const input=screen.getByRole('combobox');fireEvent.focus(input);fireEvent.change(input,{target:{value:'HA2'}});
 await waitFor(()=>expect(state.fetch).toHaveBeenCalledTimes(1));fireEvent.change(input,{target:{value:'SW1'}});
 await waitFor(()=>expect(state.fetch).toHaveBeenCalledTimes(2));resolve({postcodes:['OLD 1AA']});await new Promise(r=>setTimeout(r,10));expect(screen.queryByText('OLD 1AA')).not.toBeInTheDocument();
});
it('preserves the street and replaces only an ending postcode after explicit approval',async()=>{
 function Address(){const [address,setAddress]=useState('24 Example Road\nHA2 7LX');return <><textarea aria-label="Customer address" value={address} onChange={e=>setAddress(e.target.value)}/><AddressPostcodeHelper address={address} onChange={setAddress}/></>;}
 render(<Address/>);fireEvent.click(screen.getByText('Check a postcode (optional)'));fireEvent.change(screen.getByRole('combobox'),{target:{value:'HA2 7LU'}});await screen.findByText(/Postcode checked/);
 expect(screen.getByRole('textbox',{name:'Customer address'})).toHaveValue('24 Example Road\nHA2 7LX');fireEvent.click(screen.getByRole('button',{name:'Use postcode in address'}));expect(screen.getByRole('textbox',{name:'Customer address'})).toHaveValue('24 Example Road\nHA2 7LU');
});
it('does not request data when disabled or empty and keeps booking checks optional',async()=>{
 const {unmount}=render(<PostcodeField value="HA2 7LU" onChange={()=>{}} disabled/>);expect(screen.getByRole('combobox')).toBeDisabled();unmount();render(<OptionalJourneyPostcode/>);expect(screen.getByText(/not added to your booking/)).toBeInTheDocument();expect(state.fetch).not.toHaveBeenCalled();
});

it('ArrowUp starts at the last suggestion and Escape closes suggestions without dismissing a parent dialog',async()=>{
 const escape=vi.fn();render(<div onKeyDown={escape}><Field/></div>);const input=screen.getByRole('combobox');fireEvent.focus(input);fireEvent.change(input,{target:{value:'HA2'}});await screen.findByRole('listbox');
 fireEvent.keyDown(input,{key:'ArrowUp'});expect(screen.getByRole('option',{name:'HA2 7LX'})).toHaveAttribute('aria-selected','true');
 escape.mockClear();fireEvent.keyDown(input,{key:'Escape'});expect(screen.queryByRole('listbox')).not.toBeInTheDocument();expect(escape).not.toHaveBeenCalled();
});
