import { beforeEach, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ShareQr } from "./share-qr";
const api = vi.hoisted(() => vi.fn());
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: unknown[]) => api(...args),
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
