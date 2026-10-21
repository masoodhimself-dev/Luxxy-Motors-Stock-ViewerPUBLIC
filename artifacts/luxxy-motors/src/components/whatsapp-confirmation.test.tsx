import { useRef, useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { WhatsAppConfirmation, type WhatsAppConfirmationRequest, type WhatsAppConfirmationResult } from './whatsapp-confirmation';
const api=vi.hoisted(()=>vi.fn());
vi.mock('@workspace/api-client-react',()=>({customFetch:(...args:unknown[])=>api(...args)}));
function Fixture({known=true}:{known?:boolean}){
 const attempt=useRef<WhatsAppConfirmationRequest|null>(null),[result,setResult]=useState<WhatsAppConfirmationResult|null>(null),[phone,setPhone]=useState(known?'07700 900123':'');
 return <><output aria-label="Chosen phone">{phone}</output><WhatsAppConfirmation enquiryId={known?'customer-one':undefined} phone={phone} message="Exact message with https://example.test/private#token" attempt={attempt} result={result} onConfirmed={setResult} onLock={()=>{}} onPhone={setPhone} onEmail={()=>{}} /></>;
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
 let count=0;api.mockImplementation(async(url:string)=>{if(url.endsWith('/confirm-whatsapp')){if(++count===1)throw new Error('Lost response');return {enquiryId:'customer-one',confirmedAt:'2026-10-21T12:00:00Z'};}return {enquiries:[],canCreate:true};});
 render(<Fixture/>);fireEvent.click(screen.getByRole('button',{name:'I’ve sent it'}));await screen.findByRole('alert');
 fireEvent.click(screen.getByRole('button',{name:'Retry saving confirmation'}));await screen.findByText('WhatsApp sent — staff confirmed');
 const calls=api.mock.calls.filter(([url])=>url.endsWith('/confirm-whatsapp'));expect(calls[0][1].body).toBe(calls[1][1].body);
 expect(api.mock.calls.every(([url])=>!url.endsWith('/email'))).toBe(true);
});
