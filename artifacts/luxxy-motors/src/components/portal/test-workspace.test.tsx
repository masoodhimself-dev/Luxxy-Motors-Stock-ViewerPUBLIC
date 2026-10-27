import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { customFetch } from '@workspace/api-client-react';
import { TestEmailButton, TestEmailSettings } from './test-email';
import { TestEnquiries } from './test-enquiries';
import { StartTestDialog, usePortalTestSession } from './test-session';

vi.mock('@workspace/api-client-react', async original => ({ ...await original<object>(), customFetch: vi.fn() }));
const session = {sessionId:'sandbox-1',expiresAt:'2099-01-01T00:00:00Z',vehicle:{id:'copy',title:'Ford Focus',registration:'AB12 CDE',price:5000},customer:{name:'Customer',phone:'01234',email:'customer@example.org',address:''}};
function show(children:React.ReactNode) { return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}>{children}</QueryClientProvider>); }
beforeEach(()=>{vi.mocked(customFetch).mockReset();sessionStorage.clear();});

function SessionHarness() {
  const test = usePortalTestSession('dealer-one:user-one', true);
  return <><p>{test.checking ? 'checking' : test.locked ? 'locked' : test.session ? 'test active' : 'live'}</p><button onClick={()=>void test.retry()}>Refresh</button><button onClick={()=>void test.end()}>End</button></>;
}

it('offers dealer cars and customers, and starts with the selected IDs', async()=>{
  const start = vi.fn().mockResolvedValue(true);
  vi.mocked(customFetch).mockImplementation(async url=>String(url).endsWith('available-vehicles')?{cars:[{id:'real-car',title:'Ford Focus',registration:'AB12 CDE',price:5000}]} as never:{customers:[{id:'real-customer',source:'customer',name:'Customer',email:'customer@example.org',phone:'01234'}]} as never);
  show(<StartTestDialog open onOpenChange={vi.fn()} onStart={start} busy={false} error="" scope="dealer-one"/>);
  await screen.findByText('Ford Focus · AB12 CDE');
  fireEvent.change(screen.getByLabelText('Car'),{target:{value:'real-car'}});
  fireEvent.change(screen.getByLabelText('Customer'),{target:{value:'customer:real-customer'}});
  fireEvent.click(screen.getByRole('button',{name:'Start test'}));
  await waitFor(()=>expect(start).toHaveBeenCalledWith('real-car','real-customer','customer'));
});

it('creates the enquiry exclusively in the test session',async()=>{
  vi.mocked(customFetch).mockImplementation(async (_url,options)=>options?.method==='POST'?{} as never:{enquiries:[]} as never);
  show(<TestEnquiries session={session}/>);
  await screen.findByText(/Create a practice website enquiry/);
  fireEvent.change(screen.getByLabelText('Message'),{target:{value:'Could I see the car?'}});
  fireEvent.click(screen.getByRole('button',{name:'Create practice enquiry'}));
  await waitFor(()=>expect(vi.mocked(customFetch).mock.calls.some(([url,options])=>url==='/api/sales-test/sessions/sandbox-1/enquiries' && options?.method==='POST')).toBe(true));
  const writes = vi.mocked(customFetch).mock.calls.filter(([,options])=>options?.method==='POST');
  expect(writes).toHaveLength(1);
  expect(JSON.parse(String(writes[0][1]?.body))).toMatchObject({type:'general',message:'Could I see the car?'});
});

it('opens the linked sale using the selected isolated enquiry identifiers',async()=>{
  const onOpenSale=vi.fn();
  vi.mocked(customFetch).mockResolvedValue({enquiries:[{id:'enquiry-copy',saleId:'sale-copy',revision:1,type:'general',vehicleId:'copy',vehicleTitle:'Ford Focus',customerName:'Customer',email:'customer@example.org',phone:'01234',message:'Could I see the car?',appointmentAt:null,appointmentStatus:null}]} as never);
  show(<TestEnquiries session={session} onOpenSale={onOpenSale}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Open sale'}));
  expect(onOpenSale).toHaveBeenCalledExactlyOnceWith({id:'enquiry-copy',saleId:'sale-copy',customerName:'Customer',email:'customer@example.org',phone:'01234',partExchange:null});
});

it('starts a sale for an enquiry without a linked sale',async()=>{
  const onOpenSale=vi.fn();
  vi.mocked(customFetch).mockResolvedValue({enquiries:[{id:'enquiry-copy',saleId:null,revision:1,type:'general',vehicleId:'copy',vehicleTitle:'Ford Focus',customerName:'Customer',email:'customer@example.org',phone:'01234',message:'Could I see the car?',appointmentAt:null,appointmentStatus:null}]} as never);
  show(<TestEnquiries session={session} onOpenSale={onOpenSale}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Start sale'}));
  expect(onOpenSale).toHaveBeenCalledExactlyOnceWith({id:'enquiry-copy',saleId:null,customerName:'Customer',email:'customer@example.org',phone:'01234',partExchange:null});
});

it('does not offer a sale for a different car in the same test session',async()=>{
  const onOpenSale=vi.fn();
  vi.mocked(customFetch).mockResolvedValue({enquiries:[{id:'other-enquiry',saleId:null,revision:1,type:'general',vehicleId:'other-car',vehicleTitle:'BMW 3 Series',customerName:'Customer',email:'customer@example.org',phone:'01234',message:'Interested in BMW',appointmentAt:null,appointmentStatus:null}]} as never);
  show(<TestEnquiries session={session} onOpenSale={onOpenSale}/>);
  expect(await screen.findByText(/start a test session with it selected/i)).toBeVisible();
  expect(screen.queryByRole('button',{name:'Start sale'})).not.toBeInTheDocument();
  expect(onOpenSale).not.toHaveBeenCalled();
});

it('keeps a general enquiry car-free and does not offer vehicle-specific actions',async()=>{
 const onOpenSale=vi.fn();
 vi.mocked(customFetch).mockResolvedValue({enquiries:[{id:'general-enquiry',saleId:null,revision:1,type:'general',vehicleId:null,vehicleTitle:'',customerName:'Customer',email:'customer@example.org',phone:'01234',message:'What are your hours?',appointmentAt:null,appointmentStatus:null}]} as never);
 show(<TestEnquiries session={session} onOpenSale={onOpenSale}/>);
 expect(await screen.findByText('What are your hours?')).toBeVisible();
 expect(screen.getByText(/Choose a car in a new test session/)).toBeVisible();
 expect(screen.queryByRole('button',{name:'Start sale'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Book or change test drive'})).not.toBeInTheDocument();
 expect(screen.queryByRole('option',{name:'Vehicle details'})).not.toBeInTheDocument();expect(onOpenSale).not.toHaveBeenCalled();
});

it('previews the recipient and content before an explicit send',async()=>{
  vi.mocked(customFetch).mockImplementation(async url=>String(url).endsWith('email-preview')?{to:'test@example.org',subject:'TEST',text:'Hello Customer',previewId:'preview-1'} as never:{sent:true,recipient:'test@example.org'} as never);
  show(<TestEmailButton sessionId="sandbox-1" enquiryId="enquiry-1" templateId="enquiry_acknowledgement"/>);
  fireEvent.click(screen.getByRole('button',{name:'Preview test email'}));
  expect(await screen.findByText('test@example.org')).toBeVisible();
  expect(screen.getByText('Hello Customer')).toBeVisible();
  expect(vi.mocked(customFetch).mock.calls).toHaveLength(1);
  fireEvent.click(screen.getByRole('button',{name:'Send test email'}));
  await screen.findByText(/accepted for delivery/);
  const [url,options] = vi.mocked(customFetch).mock.calls[1];
  expect(url).toBe('/api/sales-test/sessions/sandbox-1/email-send');
  expect(JSON.parse(String(options?.body))).toEqual({previewId:'preview-1',confirmSend:true});
});

it('only offers test destination changes to an owner',async()=>{
  vi.mocked(customFetch).mockResolvedValue({email:null} as never);
  show(<TestEmailSettings canEdit={false}/>); fireEvent.click(screen.getByText('Test email destination'));
  expect(await screen.findByText(/Ask an owner/)).toBeVisible();
  expect(screen.queryByRole('button',{name:'Save destination'})).not.toBeInTheDocument();
});

it('does not silently return to live when an active test disappears',async()=>{
  let current:typeof session|null=session;
  vi.mocked(customFetch).mockImplementation(async (_url,options)=>{if(options?.method==='DELETE')throw new Error('Already expired');return {session:current} as never;});
  vi.spyOn(window,'confirm').mockReturnValue(true);
  show(<SessionHarness/>);
  await screen.findByText('test active');
  current=null;fireEvent.click(screen.getByRole('button',{name:'Refresh'}));
  await screen.findByText('locked');
  expect(screen.queryByText('live')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'End'}));
  await screen.findByText('live');
});

it('keeps an expired test locked after this tab is reloaded',async()=>{
  sessionStorage.setItem('portal-test-session:dealer-one:user-one',JSON.stringify({id:'expired-test',expiresAt:'2020-01-01T00:00:00Z'}));
  vi.mocked(customFetch).mockResolvedValue({session:null} as never);
  show(<SessionHarness/>);
  await screen.findByText('locked');
  expect(screen.queryByText('live')).not.toBeInTheDocument();
});
