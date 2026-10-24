import { beforeEach, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { ShareQr } from "./share-qr";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { phoneSharingSettingsQueryKey } from "@/lib/phone-sharing-settings";
const api = vi.hoisted(() => vi.fn());
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: unknown[]) => api(...args),
  getGetDealerSettingsQueryKey: () => ['/api/dealer-settings'],
}));
vi.mock("qrcode.react", () => ({
  QRCodeSVG: ({ value }: { value: string }) => (
    <div data-testid="qr" data-value={value} />
  ),
}));
vi.mock("@/components/portal/enquiry-email-composer", () => ({
  EnquiryEmailComposer: ({ initialRecipient, suggestedContent }: { initialRecipient: string; suggestedContent: { subject: string; message: string } }) => <section aria-label="Internal email composer"><h2>{suggestedContent.subject}</h2><input aria-label="Prepared email recipient" value={initialRecipient} readOnly/><pre data-testid="prepared-email-message">{suggestedContent.message}</pre></section>,
}));
beforeEach(() => {
  api.mockReset().mockImplementation(async (url:string) => {
    if(url.includes('/phone-shares/enquiries?'))return {enquiries:[],canCreate:true};
    throw new Error(`Unexpected request: ${url}`);
  });
});
it("public links create a local QR with no request or automatic send", async () => {
  render(<ShareQr url="/vehicle/car?video=1#walkaround" />);
  fireEvent.click(screen.getByRole("button", { name: "Share by QR" }));
  expect(await screen.findByTestId("qr")).toHaveAttribute(
    "data-value",
    `${window.location.origin}/vehicle/car?video=1#walkaround`,
  );
  expect(api).not.toHaveBeenCalled();
});
it("private document QR is generated only after click and can be revoked", async () => {
  api
    .mockResolvedValueOnce({
      id: "grant",
      url: `${window.location.origin}/phone-share#${"a".repeat(64)}`,
      expiresAt: "2026-11-01T12:00:00Z",
    })
    .mockResolvedValueOnce({ revoked: true });
  render(
    <ShareQr
      source={{ kind: "document", saleId: "sale", documentId: "doc" }}
    />,
  );
  expect(api).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Share by QR" }));
  expect(await screen.findByTestId("qr")).toBeVisible();
  const body = JSON.parse(api.mock.calls[0][1].body);
  expect(body.source).toEqual({
    kind: "document",
    saleId: "sale",
    documentId: "doc",
  });
  expect(body.token).toMatch(/^[a-f0-9]{64}$/);
  fireEvent.click(screen.getByText("Link options"));
  fireEvent.click(screen.getByRole("button", { name: "Revoke link" }));
  await screen.findByText("Link revoked. It can no longer be opened.");
  expect(api.mock.calls[1][0]).toBe("/api/staff/phone-shares/grant/revoke");
});
it("an uncertain request retries the same token and request id", async () => {
  api
    .mockRejectedValueOnce(new Error("Temporary network failure"))
    .mockResolvedValueOnce({
      id: "grant",
      url: `${window.location.origin}/phone-share#${"b".repeat(64)}`,
      expiresAt: "2026-11-01T12:00:00Z",
    });
  render(
    <ShareQr
      source={{ kind: "document", saleId: "sale", documentId: "doc" }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Share by QR" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByTestId("qr");
  expect(api.mock.calls[0][1].body).toBe(api.mock.calls[1][1].body);
});
it("rejects executable public URLs", async () => {
  render(<ShareQr url="javascript:alert(1)" />);
  fireEvent.click(screen.getByRole("button", { name: "Share by QR" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("not available");
  expect(screen.queryByTestId("qr")).toBeNull();
});
it("changing the reviewed document clears the old sharing capability", async () => {
  api.mockResolvedValueOnce({
    id: "grant",
    url: "/phone-share#old",
    expiresAt: "2026-11-01T12:00:00Z",
  });
  const view = render(
    <ShareQr
      source={{ kind: "document", saleId: "sale", documentId: "first" }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Share by QR" }));
  await screen.findByTestId("qr");
  view.rerender(
    <ShareQr
      source={{ kind: "document", saleId: "sale", documentId: "second" }}
    />,
  );
  await waitFor(() => expect(screen.queryByTestId("qr")).toBeNull());
});
it('prefills WhatsApp with the saved customer number, reviewed message and attachment link without sending', async () => {
 api.mockImplementation(async(url:string)=>url.includes('/enquiries?')?{enquiries:[{id:'enquiry',customerName:'Alex',phone:'07700 900123'}]}:{id:'pack',url:'https://dealer.test/phone-share#secret',message:'Hello Alex, your invoice is ready.',customerPhone:'07700 900123',enquiryId:'enquiry',hasAttachments:true,expiresAt:'2026-11-01T12:00:00Z'});
 render(<ShareQr whatsapp label="WhatsApp QR" source={{kind:'document',saleId:'sale',documentId:'doc'}} />);
 fireEvent.click(screen.getByRole('button',{name:'WhatsApp QR'}));
 const qr=await screen.findByTestId('qr'); const url=new URL(qr.getAttribute('data-value')!);
 expect(url.hostname).toBe('wa.me');expect(url.pathname).toBe('/447700900123');
 expect(url.searchParams.get('text')).toContain('Hello Alex, your invoice is ready.');
 expect(url.searchParams.get('text')).toContain('https://dealer.test/phone-share#secret');
 expect(api.mock.calls.filter(([path])=>path==='/api/staff/phone-shares')).toHaveLength(1); expect(api.mock.calls[0][0]).toBe('/api/staff/phone-shares');
 fireEvent.change(screen.getByRole('textbox',{name:'Customer WhatsApp number'}),{target:{value:'+353 86 123 4567'}});
 expect(screen.queryByTestId('qr')).toBeNull();
 expect(screen.queryByRole('link',{name:'Open WhatsApp'})).toBeNull();
 fireEvent.click(screen.getByRole('checkbox',{name:/I’ve checked \+353861234567 is the right recipient/}));
 expect(new URL(screen.getByTestId('qr').getAttribute('data-value')!).pathname).toBe('/353861234567');
 expect(api.mock.calls.some(([path])=>path.endsWith('/confirm-whatsapp')||path.endsWith('/email'))).toBe(false);
});
it('requires a valid number and a selected customer before showing a WhatsApp QR', async () => {
 api.mockImplementation(async()=>({enquiries:[{id:'enquiry',customerName:'Alex'}],canCreate:true}));
 render(<ShareQr whatsapp label="WhatsApp QR" url="/vehicle/car" message="Your car video" />);
 fireEvent.click(screen.getByRole('button',{name:'WhatsApp QR'}));
 await screen.findByRole('textbox',{name:'Customer WhatsApp number'});
 expect(screen.queryByTestId('qr')).toBeNull();
 await screen.findByRole('option',{name:'Alex'});
 fireEvent.change(screen.getByRole('textbox',{name:'Customer WhatsApp number'}),{target:{value:'not-a-number'}});
 expect(screen.queryByTestId('qr')).toBeNull();
 fireEvent.change(screen.getByRole('textbox',{name:'Customer WhatsApp number'}),{target:{value:'07700 900123'}});
 expect(screen.queryByTestId('qr')).toBeNull();
 fireEvent.change(screen.getByRole('combobox',{name:'Save against enquiry'}),{target:{value:'enquiry'}});
 expect(await screen.findByTestId('qr')).toBeVisible();
 expect(api.mock.calls.every(([,options])=>!options?.method||options.method==='GET')).toBe(true);
});
it('keeps long WhatsApp messages intact using the secure phone preview', async () => {
 const message='Long reviewed message '.repeat(200);
 api.mockImplementation(async(url:string)=>url.includes('/enquiries?')?{enquiries:[{id:'enquiry',customerName:'Alex',phone:'07700 900123'}]}:{id:'pack',url:'https://dealer.test/phone-share#'+'a'.repeat(64),message,customerPhone:'07700 900123',hasAttachments:false});
 render(<ShareQr whatsapp label="WhatsApp QR" source={{kind:'enquiry-message',enquiryId:'enquiry',draft:{}}} />);
 fireEvent.click(screen.getByRole('button',{name:'WhatsApp QR'}));
 expect((await screen.findByTestId('qr')).getAttribute('data-value')).toContain('/phone-share#');
 const open=new URL(screen.getByRole('link',{name:'Open WhatsApp'}).getAttribute('href')!);
 expect(open.searchParams.get('text')).toBe(message);
});
it('rechecks a private signing link before creating its QR', async () => {
 const check=vi.fn().mockRejectedValue(new Error('Signing link expired'));
 render(<ShareQr whatsapp label="WhatsApp QR" url="/sign/private" message="Please sign" customerPhone="07700 900123" beforeGenerate={check} />);
 fireEvent.click(screen.getByRole('button',{name:'WhatsApp QR'}));
 await screen.findByRole('alert'); expect(check).toHaveBeenCalledOnce();expect(screen.queryByTestId('qr')).toBeNull();
});
it('offers email fallback with the same message and attachment links, without sending or confirming WhatsApp',async()=>{
 api.mockImplementation(async(url:string)=>url.includes('/enquiries?')?{enquiries:[{id:'enquiry',customerName:'Alex',phone:'07700 900123',email:'alex@example.test'}],canCreate:true}:url.endsWith('/email-enquiry')?{enquiry:{id:'enquiry',customerName:'Alex'},customerEmail:'alex@example.test'}:{id:'pack',url:'https://dealer.test/phone-share#secret',message:'Your invoice is ready.',customerPhone:'07700 900123',customerEmail:'alex@example.test',enquiryId:'enquiry',hasAttachments:true});
 const view=render(<ShareQr whatsapp label="WhatsApp QR" source={{kind:'document',saleId:'sale',documentId:'doc'}} />);
 fireEvent.click(screen.getByRole('button',{name:'WhatsApp QR'}));await screen.findByTestId('qr');
 fireEvent.click(screen.getByRole('button',{name:'Use email instead'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Continue to email'})).toBeEnabled());
 expect(screen.getByRole('textbox',{name:'Customer email'})).toHaveValue('alex@example.test');
 fireEvent.click(screen.getByRole('button',{name:'Continue to email'}));
 await screen.findByRole('region',{name:'Internal email composer'});
 expect(screen.getByRole('textbox',{name:'Prepared email recipient'})).toHaveValue('alex@example.test');
 expect(screen.getByTestId('prepared-email-message')).toHaveTextContent('Your invoice is ready.');
 expect(screen.getByTestId('prepared-email-message')).toHaveTextContent('https://dealer.test/phone-share#secret');
 expect(view.container.querySelector('a[href^="mailto:"]')).toBeNull();
 const preparation=api.mock.calls.find(([url])=>url.endsWith('/email-enquiry'))!;
 expect(JSON.parse(preparation[1].body)).toMatchObject({enquiryId:'enquiry',grantId:'pack',email:'alex@example.test',phone:'07700 900123'});
 expect(api.mock.calls.some(([url])=>url.endsWith('/confirm-whatsapp')||url.endsWith('/email'))).toBe(false);
});

it('keeps email recovery available if the sharing pack cannot be prepared',async()=>{
 const fallback=vi.fn();
 api.mockRejectedValue(new Error('This AI suggestion expired. Choose a fresh template.'));
 render(<ShareQr whatsapp label="WhatsApp QR" source={{kind:'enquiry-message',enquiryId:'enquiry',draft:{}}} onEmailFallback={fallback}/>);
 fireEvent.click(screen.getByRole('button',{name:'WhatsApp QR'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('This AI suggestion expired');
 expect(screen.queryByTestId('qr')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Use email instead'}));
 await waitFor(()=>expect(fallback).toHaveBeenCalledOnce());
 expect(api.mock.calls.some(([url])=>url.endsWith('/confirm-whatsapp')||url.endsWith('/email'))).toBe(false);
});

it('keeps the selected WhatsApp customer when switching a public video link to internal email',async()=>{
 api.mockImplementation(async(url:string)=>url.includes('/enquiries?')?{enquiries:[{id:'enquiry',customerName:'Alex',phone:'07700 900123',email:'alex@example.test'}],canCreate:true}:url.endsWith('/email-enquiry')?{enquiry:{id:'enquiry',customerName:'Alex'},customerEmail:'alex@example.test'}:{});
 render(<ShareQr whatsapp label="WhatsApp QR" url="https://dealer.test/vehicle/car?video=1#walkaround" message="Here is your car video."/>);
 fireEvent.click(screen.getByRole('button',{name:'WhatsApp QR'}));
 await screen.findByRole('option',{name:'Alex'});
 fireEvent.change(screen.getByRole('combobox',{name:'Save against enquiry'}),{target:{value:'enquiry'}});
 await screen.findByTestId('qr');
 fireEvent.click(screen.getByRole('button',{name:'Use email instead'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'Continue to email'})).toBeEnabled());
 expect(screen.queryByRole('combobox',{name:'Save against enquiry'})).toBeNull();
 expect(screen.getByText('Save the email against Alex.')).toBeVisible();
 fireEvent.click(screen.getByRole('button',{name:'Continue to email'}));
 await screen.findByRole('region',{name:'Internal email composer'});
 expect(screen.getByTestId('prepared-email-message').textContent).toBe('Here is your car video.\n\nhttps://dealer.test/vehicle/car?video=1#walkaround');
 const preparation=api.mock.calls.find(([url])=>url.endsWith('/email-enquiry'))!;
 expect(JSON.parse(preparation[1].body)).toMatchObject({enquiryId:'enquiry',email:'alex@example.test',phone:'07700 900123'});
 expect(api.mock.calls.some(([url])=>url.endsWith('/confirm-whatsapp')||url.endsWith('/email'))).toBe(false);
});

it('locks the recipient after an uncertain confirmation and retries the same saved message',async()=>{
 let confirmations=0;
 api.mockImplementation(async(url:string)=>{
   if(url.includes('/enquiries?'))return {enquiries:[{id:'enquiry',customerName:'Alex',phone:'07700 900123'}]};
   if(url.endsWith('/confirm-whatsapp')){
     if(++confirmations===1)throw new Error('Lost response');
     return {enquiryId:'enquiry',confirmedAt:'2026-10-21T12:00:00Z'};
   }
   return {id:'pack',url:'https://dealer.test/phone-share#secret',message:'Your invoice is ready.',customerPhone:'07700 900123',enquiryId:'enquiry',hasAttachments:true};
 });
 render(<ShareQr whatsapp label="WhatsApp QR" source={{kind:'document',saleId:'sale',documentId:'doc'}}/>);
 fireEvent.click(screen.getByRole('button',{name:'WhatsApp QR'}));
 await screen.findByTestId('qr');
 fireEvent.click(screen.getByRole('button',{name:'I’ve sent it'}));
 await screen.findByRole('alert');
 expect(screen.getByRole('textbox',{name:'Customer WhatsApp number'})).toBeDisabled();
 expect(screen.queryByRole('button',{name:'Use email instead'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Retry saving confirmation'}));
 await screen.findByText('WhatsApp sent — staff confirmed');
 const calls=api.mock.calls.filter(([url])=>url.endsWith('/confirm-whatsapp'));
 expect(calls).toHaveLength(2);
 expect(calls[1][1].body).toBe(calls[0][1].body);
 expect(JSON.parse(calls[0][1].body)).toMatchObject({phone:'07700 900123',enquiryId:'enquiry',confirmed:true});
 expect(api.mock.calls.some(([url])=>url.endsWith('/email'))).toBe(false);
});
it("recording QR keeps staff authentication and does not create an access grant", async () => {
  render(<ShareQr purpose="record-video" url="/portal?section=inventory&vehicleId=car&recordVideo=1" label="Record on phone · QR" />);
  fireEvent.click(screen.getByRole("button",{name:"Record on phone · QR"}));
  expect(await screen.findByTestId("qr")).toHaveAttribute("data-value",`${window.location.origin}/portal?section=inventory&vehicleId=car&recordVideo=1`);
  expect(screen.getByRole("heading",{name:"Record on your phone"})).toBeVisible();
  expect(screen.getByText(/This QR does not grant access/)).toBeVisible();
  expect(screen.getByRole("link",{name:"Open recording page"})).toBeVisible();
  expect(api).not.toHaveBeenCalled();
});

it('renewing an expired confirmed pack requires a new confirmation and shows the new link', async () => {
 const clock=vi.spyOn(Date,'now').mockReturnValue(Date.parse('2026-10-22T12:00:00Z'));
 let grants=0;
 api.mockImplementation(async(url:string)=>{
  if(url.includes('/enquiries?'))return {enquiries:[{id:'enquiry',customerName:'Alex',phone:'07700900123'}]};
  if(url.endsWith('/confirm-whatsapp'))return {enquiryId:'enquiry',confirmedAt:'2026-10-22T12:01:00Z'};
  return {id:`pack-${++grants}`,url:`https://dealer.test/phone-share#pack-${grants}`,message:'Your invoice',customerPhone:'07700900123',enquiryId:'enquiry',hasAttachments:true,expiresAt:grants===1?'2026-10-22T13:00:00Z':'2026-10-24T13:00:00Z'};
 });
 try {
  render(<ShareQr whatsapp label="WhatsApp QR" source={{kind:'document',saleId:'sale',documentId:'doc'}}/>);
  fireEvent.click(screen.getByRole('button',{name:'WhatsApp QR'}));
  await screen.findByTestId('qr');
  fireEvent.click(screen.getByRole('button',{name:'I’ve sent it'}));
  await screen.findByText('WhatsApp sent — staff confirmed');
  fireEvent.click(screen.getByRole('button',{name:'Close'}));
  clock.mockReturnValue(Date.parse('2026-10-23T12:00:00Z'));
  fireEvent.click(screen.getByRole('button',{name:'WhatsApp QR'}));
  const qr=await screen.findByTestId('qr');
  expect(qr.getAttribute('data-value')).toContain('pack-2');
  expect(screen.queryByText('WhatsApp sent — staff confirmed')).toBeNull();
  expect(screen.getByRole('button',{name:'I’ve sent it'})).toBeEnabled();
  expect(api.mock.calls.filter(([url])=>url.endsWith('/confirm-whatsapp'))).toHaveLength(1);
 } finally {clock.mockRestore();}
});

it('the dealer switch disables new WhatsApp sharing while leaving phone recording QR available', async()=>{
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 client.setQueryData(phoneSharingSettingsQueryKey,{revision:1,enabled:false});
 render(<QueryClientProvider client={client}><ShareQr whatsapp label="WhatsApp QR" source={{kind:'document',saleId:'sale',documentId:'doc'}}/><ShareQr purpose="record-video" label="Record on phone" url="/portal?recordVideo=1"/></QueryClientProvider>);
 expect(screen.getByRole('button',{name:'WhatsApp QR'})).toBeDisabled();
 expect(screen.getByRole('button',{name:'WhatsApp QR'})).toHaveAttribute('title',expect.stringContaining('Settings'));
 expect(screen.getByRole('button',{name:'WhatsApp QR'})).toHaveAccessibleDescription('WhatsApp QR is turned off in Settings → Emails & documents → WhatsApp & QR. Use email instead.');
 expect(screen.getByText(/WhatsApp QR is turned off in Settings/)).toBeVisible();
 expect(screen.getByRole('button',{name:'Record on phone'})).toBeEnabled();
 expect(api).not.toHaveBeenCalled();
 await act(async()=>{client.setQueryData(phoneSharingSettingsQueryKey,{revision:2,enabled:true});});
 await waitFor(()=>expect(screen.getByRole('button',{name:'WhatsApp QR'})).toBeEnabled());
});

it('explains a failed settings check and lets staff retry without preparing or sending a customer message', async()=>{
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 let rejectLookup:(error:Error)=>void=()=>{};
 const lookup=new Promise<never>((_resolve,reject)=>{rejectLookup=reject;});
 let checks=0;
 api.mockImplementation(async(path:string)=>{
  if(path==='/api/staff/phone-sharing-settings')return ++checks===1?lookup:{revision:2,enabled:true};
  throw new Error(`Unexpected request: ${path}`);
 });
 const view=render(<QueryClientProvider client={client}><ShareQr whatsapp label="WhatsApp confirmation" customerPhone="07700900123" source={{kind:'document',saleId:'sale',documentId:'doc'}}/></QueryClientProvider>);
 expect(screen.getByRole('button',{name:'WhatsApp confirmation'})).toBeDisabled();
 expect(screen.getByRole('button',{name:'WhatsApp confirmation'})).toHaveAccessibleDescription('Checking WhatsApp sharing settings…');
 await act(async()=>rejectLookup(new Error('Temporarily unavailable')));
 await screen.findByText('WhatsApp sharing could not be checked. Retry the settings check, or use email instead.');
 expect(screen.getByRole('button',{name:'WhatsApp confirmation'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Retry WhatsApp settings'}));
 await waitFor(()=>expect(screen.getByRole('button',{name:'WhatsApp confirmation'})).toBeEnabled());
 expect(api.mock.calls.map(([path])=>path)).toEqual(['/api/staff/phone-sharing-settings','/api/staff/phone-sharing-settings']);
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
 view.unmount();client.clear();
});

it('turning sharing off still lets staff reopen a prepared pack to confirm or revoke it',async()=>{
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 client.setQueryData(phoneSharingSettingsQueryKey,{revision:1,enabled:true});
 api.mockImplementation(async(url:string)=>{
  if(url.includes('/enquiries?'))return {enquiries:[{id:'enquiry',customerName:'Alex',phone:'07700900123'}]};
  if(url.endsWith('/revoke'))return {revoked:true};
  return {id:'prepared-pack',url:'https://dealer.test/phone-share#prepared',message:'Prepared message',customerPhone:'07700900123',enquiryId:'enquiry',hasAttachments:true,expiresAt:'2026-11-01T12:00:00Z'};
 });
 render(<QueryClientProvider client={client}><ShareQr whatsapp label="WhatsApp QR" source={{kind:'document',saleId:'sale',documentId:'doc'}}/></QueryClientProvider>);
 fireEvent.click(screen.getByRole('button',{name:'WhatsApp QR'}));
 await screen.findByTestId('qr');
 fireEvent.click(screen.getByRole('button',{name:'Close'}));
 await act(async()=>{client.setQueryData(phoneSharingSettingsQueryKey,{revision:2,enabled:false});});
 fireEvent.click(screen.getByRole('button',{name:'WhatsApp QR'}));
 await screen.findByTestId('qr');
 expect(screen.getByRole('button',{name:'I’ve sent it'})).toBeEnabled();
 expect(api.mock.calls.filter(([url])=>url==='/api/staff/phone-shares')).toHaveLength(1);
 fireEvent.click(screen.getByText('Link options'));
 fireEvent.click(screen.getByRole('button',{name:'Revoke link'}));
 await screen.findByText('Link revoked. It can no longer be opened.');
 expect(api.mock.calls.some(([url])=>url.endsWith('/revoke'))).toBe(true);
});

it('edits one customer message, hides the old QR and saves exactly the updated text in history',async()=>{
 api.mockImplementation(async(path:string)=>path.endsWith('/confirm-whatsapp')?{enquiryId:'enquiry',confirmedAt:'2026-10-22T12:00:00Z'}:{enquiries:[{id:'enquiry',customerName:'Alex',phone:'07700900123'}]});
 render(<ShareQr whatsapp label="WhatsApp QR" url="/vehicle/car" message="Original wording" enquiryId="enquiry" customerName="Alex" customerPhone="07700900123"/>);
 fireEvent.click(screen.getByRole('button',{name:'WhatsApp QR'}));
 await screen.findByTestId('qr');
 fireEvent.change(screen.getByRole('textbox',{name:'WhatsApp message'}),{target:{value:'Hi Alex, here is the car we discussed.'}});
 expect(screen.queryByTestId('qr')).toBeNull();
 expect(screen.getByRole('button',{name:'I’ve sent it'})).toBeDisabled();
 expect(screen.getByRole('button',{name:'Use email instead'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Update QR'}));
 const qr=await screen.findByTestId('qr');
 const exact=`Hi Alex, here is the car we discussed.\n\n${window.location.origin}/vehicle/car`;
 expect(new URL(qr.getAttribute('data-value')!).searchParams.get('text')).toBe(exact);
 fireEvent.click(screen.getByRole('button',{name:'I’ve sent it'}));
 await screen.findByText('WhatsApp sent — staff confirmed');
 const confirmation=api.mock.calls.find(([path])=>path.endsWith('/confirm-whatsapp'))!;
 expect(JSON.parse(confirmation[1].body).message).toBe(exact);
 expect(screen.getByRole('textbox',{name:'WhatsApp message'})).toBeDisabled();
 expect(api.mock.calls.some(([path,options])=>options?.method==='PUT'||path.endsWith('/email'))).toBe(false);
 fireEvent.click(screen.getByRole('button',{name:'Share with another customer'}));
 expect(screen.getByRole('textbox',{name:'WhatsApp message'})).toHaveValue('Original wording');
 expect(screen.getByRole('textbox',{name:'Customer WhatsApp number'})).toHaveValue('');
 expect(screen.queryByTestId('qr')).toBeNull();
});

it('revalidates a signing link without losing the personalised message when reopened',async()=>{
 const check=vi.fn().mockResolvedValue(undefined);
 api.mockResolvedValue({enquiries:[{id:'enquiry',customerName:'Alex',phone:'07700900123'}]});
 render(<ShareQr whatsapp label="WhatsApp QR" url="/test-drive-declaration/token" message="Please sign" enquiryId="enquiry" customerName="Alex" customerPhone="07700900123" beforeGenerate={check}/>);
 fireEvent.click(screen.getByRole('button',{name:'WhatsApp QR'}));await screen.findByTestId('qr');
 fireEvent.change(screen.getByRole('textbox',{name:'WhatsApp message'}),{target:{value:'Hi Alex, please check and sign before your visit.'}});
 fireEvent.click(screen.getByRole('button',{name:'Update QR'}));await screen.findByTestId('qr');
 fireEvent.click(screen.getByRole('button',{name:'Close'}));
 fireEvent.click(screen.getByRole('button',{name:'WhatsApp QR'}));
 await waitFor(()=>expect(check).toHaveBeenCalledTimes(2));
 expect(screen.getByRole('textbox',{name:'WhatsApp message'})).toHaveValue('Hi Alex, please check and sign before your visit.');
 expect(new URL((await screen.findByTestId('qr')).getAttribute('data-value')!).searchParams.get('text')).toContain('Hi Alex, please check and sign before your visit.');
});

it('freezes edited attachment wording into a new pack, retries safely and retains it on expiry renewal',async()=>{
 const clock=vi.spyOn(Date,'now').mockReturnValue(Date.parse('2026-10-22T12:00:00Z'));
 let packs=0;
 api.mockImplementation(async(path:string,options?:RequestInit)=>{
  if(path.includes('/enquiries?'))return {enquiries:[{id:'enquiry',customerName:'Alex',phone:'07700900123'}]};
  const request=JSON.parse(String(options?.body));
  if(++packs===2)throw new Error('Lost edit response');
  const body=request.messageBody??'Original wording';
  return {id:`pack-${packs}`,url:`https://dealer.test/phone-share#pack-${packs}`,enquiryId:'enquiry',customerPhone:'07700900123',message:`${body}\n\nInvoice INV-2026-00010`,messageBody:body,requiredText:'Invoice INV-2026-00010',hasAttachments:true,expiresAt:packs<4?'2026-10-22T13:00:00Z':'2026-10-24T13:00:00Z'};
 });
 try{
  render(<ShareQr whatsapp label="WhatsApp QR" source={{kind:'document',saleId:'sale',documentId:'doc'}}/>);
  fireEvent.click(screen.getByRole('button',{name:'WhatsApp QR'}));await screen.findByTestId('qr');
  fireEvent.change(screen.getByRole('textbox',{name:'WhatsApp message'}),{target:{value:'Hi Alex, here is your reviewed invoice.'}});
  fireEvent.click(screen.getByRole('button',{name:'Update QR'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Lost edit response');
  expect(screen.queryByTestId('qr')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Update QR'}));await screen.findByTestId('qr');
  const requests=api.mock.calls.filter(([path])=>path==='/api/staff/phone-shares');
  expect(requests[1][1].body).toBe(requests[2][1].body);
  expect(JSON.parse(requests[0][1].body).token).not.toBe(JSON.parse(requests[1][1].body).token);
  const text=new URL(screen.getByRole('link',{name:'Open WhatsApp'}).getAttribute('href')!).searchParams.get('text');
  expect(text).toContain('Hi Alex, here is your reviewed invoice.\n\nInvoice INV-2026-00010');
  expect(text).toContain('https://dealer.test/phone-share#pack-3');
  fireEvent.click(screen.getByRole('button',{name:'Close'}));
  clock.mockReturnValue(Date.parse('2026-10-23T12:00:00Z'));
  fireEvent.click(screen.getByRole('button',{name:'WhatsApp QR'}));await screen.findByTestId('qr');
  const renewed=api.mock.calls.filter(([path])=>path==='/api/staff/phone-shares').at(-1)!;
  expect(JSON.parse(renewed[1].body)).toMatchObject({source:{kind:'document',saleId:'sale',documentId:'doc'},messageBody:'Hi Alex, here is your reviewed invoice.'});
  expect(screen.getByRole('textbox',{name:'WhatsApp message'})).toHaveValue('Hi Alex, here is your reviewed invoice.');
 }finally{clock.mockRestore();}
});

it('uses a secure phone preview for long edited public messages and keeps known template details',async()=>{
 const link=`${window.location.origin}/vehicle/car?video=1`;
 const long='A detailed car update. '.repeat(160);
 api.mockImplementation(async(path:string,options?:RequestInit)=>{
  if(path.includes('/enquiries?'))return {enquiries:[{id:'enquiry',customerName:'Alex',phone:'07700900123'}]};
  const request=JSON.parse(String(options?.body));
  return {id:'long-pack',url:'https://dealer.test/phone-share#long-pack',message:`${request.messageBody}\n\n${link}`,messageBody:request.messageBody,requiredText:link,templateVariables:{customer_name:'',vehicle_title:'',dealer_name:''},messageLinkRequired:true,hasAttachments:false};
 });
 render(<ShareQr whatsapp label="WhatsApp QR" url={link} message="Here is the video" enquiryId="enquiry" customerName="Alex" customerPhone="07700900123" templateVariables={{vehicle_title:'Nissan Qashqai',dealer_name:'Test Motors'}}/>);
 fireEvent.click(screen.getByRole('button',{name:'WhatsApp QR'}));await screen.findByTestId('qr');
 fireEvent.change(screen.getByRole('textbox',{name:'WhatsApp message'}),{target:{value:long}});
 fireEvent.click(screen.getByRole('button',{name:'Update QR'}));
 await waitFor(()=>expect(screen.getByTestId('qr').getAttribute('data-value')).toContain('/phone-share#long-pack'));
 const request=api.mock.calls.find(([path])=>path==='/api/staff/phone-shares')!;
 expect(JSON.parse(request[1].body)).toMatchObject({source:{kind:'message',message:'Here is the video',url:link,enquiryId:'enquiry'},messageBody:long.trim()});
 const text=new URL(screen.getByRole('link',{name:'Open WhatsApp'}).getAttribute('href')!).searchParams.get('text');
 expect(text).toBe(`${long.trim()}\n\n${link}`);
 expect(text).not.toContain('phone-share#long-pack');
 fireEvent.change(screen.getByRole('combobox',{name:'WhatsApp message template'}),{target:{value:'vehicle_details'}});
 const value=(screen.getByRole('textbox',{name:'WhatsApp message'}) as HTMLTextAreaElement).value;
 expect(value).toContain('Hi Alex');expect(value).toContain('Nissan Qashqai');expect(value).toContain('Test Motors');
});

it('passes applied WhatsApp wording to the existing internal email fallback',async()=>{
 const fallback=vi.fn();
 api.mockResolvedValue({enquiries:[{id:'enquiry',customerName:'Alex',phone:'07700900123'}]});
 render(<ShareQr whatsapp label="WhatsApp QR" url="/vehicle/car" message="Original wording" enquiryId="enquiry" customerPhone="07700900123" onEmailFallback={fallback}/>);
 fireEvent.click(screen.getByRole('button',{name:'WhatsApp QR'}));await screen.findByTestId('qr');
 fireEvent.change(screen.getByRole('textbox',{name:'WhatsApp message'}),{target:{value:'A personalised update for Alex.'}});
 fireEvent.click(screen.getByRole('button',{name:'Update QR'}));await screen.findByTestId('qr');
 fireEvent.click(screen.getByRole('button',{name:'Use email instead'}));
 await waitFor(()=>expect(fallback).toHaveBeenCalledWith('A personalised update for Alex.'));
 expect(api.mock.calls.some(([path])=>path.endsWith('/confirm-whatsapp')||path.endsWith('/email'))).toBe(false);
});
