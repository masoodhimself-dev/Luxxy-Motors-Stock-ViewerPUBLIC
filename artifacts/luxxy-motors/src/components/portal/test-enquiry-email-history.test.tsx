import {fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {expect,it,vi} from 'vitest';
import {customFetch} from '@workspace/api-client-react';
import {EnquiryEmail} from './test-enquiries';
vi.mock('@workspace/api-client-react',async original=>({...await original<object>(),customFetch:vi.fn()}));

it('previews a linked test invoice and shows the test email only after confirmed acceptance',async()=>{
 let accepted=false;
 vi.mocked(customFetch).mockImplementation(async(url,options)=>{
  const path=String(url);
  if(path.includes('email-history'))return {messages:accepted?[{id:'sent',subject:'TEST — invoice',to:'test@example.org',text:'Test invoice sent',sentAt:'2026-10-27T12:00:00Z'}]:[]} as never;
  if(path.includes('sale-workspace'))return {sale:{documents:[{id:'invoice-1',type:'invoice',number:'TEST-1'}]}} as never;
  if(path.endsWith('email-preview'))return {to:'test@example.org',from:'Dealer <dealer@example.org>',subject:'TEST — invoice',text:'Test invoice sent',previewId:'preview-1'} as never;
  if(path.endsWith('email-send')){accepted=true;return {sent:true} as never;}
  throw new Error(`Unexpected request: ${path} ${options?.method}`);
 });
 const enquiry={id:'enquiry-1',reference:'T-1',vehicleId:'vehicle',vehicleTitle:'Car',customerName:'Customer',phone:'',email:'',type:'general',message:'Hello',appointmentAt:null,appointmentStatus:null,saleId:'sale-1',revision:1};
 render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><EnquiryEmail sessionId="session-1" enquiry={enquiry}/></QueryClientProvider>);
 fireEvent.change(screen.getByLabelText('Test email'),{target:{value:'invoice_copy'}});
 const option=await screen.findByRole('option',{name:'TEST-1'});expect(option).toBeVisible();fireEvent.change(screen.getByLabelText('Test invoice'),{target:{value:'invoice-1'}});
 fireEvent.click(screen.getByRole('button',{name:'Preview test email'}));await screen.findByText('Dealer <dealer@example.org>');
 const preview=vi.mocked(customFetch).mock.calls.find(([url])=>String(url).endsWith('email-preview'))!;expect(JSON.parse(String(preview[1]?.body))).toMatchObject({enquiryId:'enquiry-1',templateId:'invoice_copy',documentId:'invoice-1'});
 expect(screen.queryByText(/Sent test emails/)).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Send test email'}));
 await waitFor(()=>expect(screen.getByText('Sent test emails (1)')).toBeVisible());
});
