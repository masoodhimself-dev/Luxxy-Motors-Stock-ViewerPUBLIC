import { useRef, useState, type ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { WhatsAppConfirmation, type WhatsAppConfirmationRequest, type WhatsAppConfirmationResult } from './whatsapp-confirmation';
const api=vi.hoisted(()=>vi.fn());
vi.mock('@workspace/api-client-react',()=>({customFetch:(...args:unknown[])=>api(...args)}));
function Fixture({known=true,initialPhone,onReadyChange,children}:{known?:boolean;initialPhone?:string;onReadyChange?:(ready:boolean)=>void;children?:ReactNode}){
 const attempt=useRef<WhatsAppConfirmationRequest|null>(null),[result,setResult]=useState<WhatsAppConfirmationResult|null>(null),[phone,setPhone]=useState(initialPhone??(known?'07700 900123':''));
 return <><output aria-label="Chosen phone">{phone}</output><input aria-label="Recipient number" value={phone} onChange={event=>setPhone(event.target.value)} /><WhatsAppConfirmation enquiryId={known?'customer-one':undefined} phone={phone} message="Exact message with https://example.test/private#token" attempt={attempt} result={result} onConfirmed={setResult} onLock={()=>{}} onPhone={setPhone} onEmail={()=>{}} onReadyChange={onReadyChange}>{children}</WhatsAppConfirmation></>;
}
beforeEach(()=>{api.mockReset().mockImplementation(async(url:string)=>url.includes('/enquiries?')?{enquiries:[{id:'customer-one',customerName:'Fictional Alex',phone:'07700 900123',email:'alex@example.test'}],canCreate:true}:{enquiryId:'customer-one',confirmedAt:'2026-10-21T12:00:00Z'});});
it('does not record anything until staff explicitly confirm, then saves the complete message',async()=>{
 render(<Fixture/>);await screen.findByText('Save against Fictional Alex.');
 expect(api.mock.calls.filter(([url])=>url.endsWith('/confirm-whatsapp'))).toHaveLength(0);
 fireEvent.click(screen.getByRole('button',{name:'I’ve sent it'}));
 expect(await screen.findByText('WhatsApp sent — staff confirmed')).toBeVisible();
 const sent=api.mock.calls.find(([url])=>url.endsWith('/confirm-whatsapp'))!;
 expect(JSON.parse(sent[1].body)).toMatchObject({enquiryId:'customer-one',phone:'07700 900123',message:'Exact message with https://example.test/private#token',confirmed:true});
 expect(screen.getByRole('link',{name:'Open customer enquiry'})).toHaveAttribute('href',expect.stringContaining('enquiryId=customer-one'));
});
it('selecting the customer fills their phone before a sent confirmation is possible',async()=>{
 render(<Fixture known={false}/>);
 expect(screen.getByRole('button',{name:'I’ve sent it'})).toBeDisabled();
 await screen.findByRole('option',{name:'Fictional Alex'});
 fireEvent.change(screen.getByRole('combobox',{name:'Save against enquiry'}),{target:{value:'customer-one'}});
 expect(screen.getByLabelText('Chosen phone')).toHaveTextContent('07700 900123');
 expect(screen.getByRole('button',{name:'I’ve sent it'})).toBeEnabled();
});
it('an uncertain save retries exactly the same confirmation without sending another message',async()=>{
 let count=0;api.mockImplementation(async(url:string)=>{if(url.endsWith('/confirm-whatsapp')){if(++count===1)throw new Error('Lost response');return {enquiryId:'customer-one',confirmedAt:'2026-10-21T12:00:00Z'};}return {enquiries:[{id:'customer-one',customerName:'Fictional Alex',phone:'07700 900123'}],canCreate:true};});
 render(<Fixture/>);await waitFor(()=>expect(screen.getByRole('button',{name:'I’ve sent it'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'I’ve sent it'}));await screen.findByRole('alert');
 fireEvent.click(screen.getByRole('button',{name:'Retry saving confirmation'}));await screen.findByText('WhatsApp sent — staff confirmed');
 const calls=api.mock.calls.filter(([url])=>url.endsWith('/confirm-whatsapp'));expect(calls[0][1].body).toBe(calls[1][1].body);
 expect(api.mock.calls.every(([url])=>!url.endsWith('/email'))).toBe(true);
});

it('preserves an entered recipient when selecting a different customer number and requires acknowledgement before saving',async()=>{
 const ready=vi.fn();
 render(<Fixture known={false} initialPhone="07700 900456" onReadyChange={ready}/>);
 await screen.findByRole('option',{name:'Fictional Alex'});
 fireEvent.change(screen.getByRole('combobox',{name:'Save against enquiry'}),{target:{value:'customer-one'}});
 expect(screen.getByLabelText('Chosen phone')).toHaveTextContent('07700 900456');
 const acknowledge=screen.getByRole('checkbox',{name:/I’ve checked \+447700900456 is the right recipient/});
 expect(screen.getByText('+447700900123',{selector:'strong'})).toBeVisible();
 expect(screen.getByRole('button',{name:'I’ve sent it'})).toBeDisabled();
 expect(ready).toHaveBeenLastCalledWith(false);
 fireEvent.click(acknowledge);
 expect(ready).toHaveBeenLastCalledWith(true);
 fireEvent.click(screen.getByRole('button',{name:'I’ve sent it'}));
 await screen.findByText('WhatsApp sent — staff confirmed');
 const saved=api.mock.calls.find(([url])=>url.endsWith('/confirm-whatsapp'))!;
 expect(JSON.parse(saved[1].body)).toMatchObject({enquiryId:'customer-one',phone:'07700 900456'});
});

it('requires a fresh mismatch acknowledgement if staff change the recipient again',async()=>{
 const ready=vi.fn();
 render(<Fixture initialPhone="07700 900456" onReadyChange={ready}/>);
 fireEvent.click(await screen.findByRole('checkbox',{name:/I’ve checked \+447700900456/}));
 expect(screen.getByRole('button',{name:'I’ve sent it'})).toBeEnabled();
 fireEvent.change(screen.getByRole('textbox',{name:'Recipient number'}),{target:{value:'07700 900789'}});
 expect(screen.getByRole('checkbox',{name:/I’ve checked \+447700900789/})).not.toBeChecked();
 expect(screen.getByRole('button',{name:'I’ve sent it'})).toBeDisabled();
 expect(ready).toHaveBeenLastCalledWith(false);
 fireEvent.change(screen.getByRole('textbox',{name:'Recipient number'}),{target:{value:'07700 900456'}});
 expect(screen.getByRole('checkbox',{name:/I’ve checked \+447700900456/})).not.toBeChecked();
 expect(screen.getByRole('button',{name:'I’ve sent it'})).toBeDisabled();
 expect(api.mock.calls.filter(([url])=>url.endsWith('/confirm-whatsapp'))).toHaveLength(0);
});

it('recognises UK and international formatting as the same customer number',async()=>{
 const ready=vi.fn();
 render(<Fixture initialPhone="+44 7700 900123" onReadyChange={ready}/>);
 await waitFor(()=>expect(ready).toHaveBeenLastCalledWith(true));
 expect(screen.queryByRole('checkbox',{name:/I’ve checked/})).toBeNull();
 expect(screen.getByLabelText('Chosen phone')).toHaveTextContent('+44 7700 900123');
 expect(screen.getByRole('button',{name:'I’ve sent it'})).toBeEnabled();
});

it('keeps sharing unavailable until a failed known-customer lookup is retried successfully',async()=>{
 const ready=vi.fn(),original=api.getMockImplementation()!;
 let fail=true;
 api.mockImplementation(async(url:string)=>{if(fail&&url.includes('/enquiries?'))throw new Error('Offline');return original(url);});
 render(<Fixture onReadyChange={ready}/>);
 expect(ready).toHaveBeenLastCalledWith(false);
 expect(await screen.findByRole('alert')).toHaveTextContent('Customer enquiries could not be checked');
 expect(screen.getByRole('button',{name:'I’ve sent it'})).toBeDisabled();
 fail=false;
 fireEvent.click(screen.getByRole('button',{name:'Retry customer lookup'}));
 await waitFor(()=>expect(ready).toHaveBeenLastCalledWith(true));
 expect(screen.getByRole('button',{name:'I’ve sent it'})).toBeEnabled();
 expect(screen.queryByRole('alert')).toBeNull();
});

it('does not overwrite a phone entered while the customer lookup was pending',async()=>{
 let complete!:(value:unknown)=>void;
 api.mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));
 render(<Fixture initialPhone=""/>);
 await waitFor(()=>expect(api).toHaveBeenCalled());
 fireEvent.change(screen.getByRole('textbox',{name:'Recipient number'}),{target:{value:'07700 900456'}});
 await act(async()=>{complete({enquiries:[{id:'customer-one',customerName:'Fictional Alex',phone:'07700 900123'}]});});
 expect(screen.getByLabelText('Chosen phone')).toHaveTextContent('07700 900456');
 expect(screen.getByRole('checkbox',{name:/I’ve checked \+447700900456/})).not.toBeChecked();
 expect(screen.getByRole('button',{name:'I’ve sent it'})).toBeDisabled();
});

it('places the sharing actions between customer choice and the final sent confirmation',async()=>{
 render(<Fixture><div>Scan to open WhatsApp</div></Fixture>);
 await screen.findByText('Save against Fictional Alex.');
 const choice=screen.getByText('Customer enquiry'),share=screen.getByText('Scan to open WhatsApp'),confirm=screen.getByRole('button',{name:'I’ve sent it'});
 expect(choice.compareDocumentPosition(share)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 expect(share.compareDocumentPosition(confirm)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
it('summarises the selected customer and allows a deliberate change without replacing the recipient',async()=>{
 render(<Fixture known={false}/>);
 await screen.findByRole('option',{name:'Fictional Alex'});
 fireEvent.change(screen.getByRole('combobox',{name:'Save against enquiry'}),{target:{value:'customer-one'}});
 expect(screen.getByRole('button',{name:'Change customer'})).toBeVisible();
 expect(screen.queryByRole('combobox',{name:'Save against enquiry'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'Change customer'}));
 expect(screen.getByRole('combobox',{name:'Save against enquiry'})).toHaveValue('');
 expect(screen.getByLabelText('Chosen phone')).toHaveTextContent('07700 900123');
 expect(screen.getByRole('button',{name:'I’ve sent it'})).toBeDisabled();
});
