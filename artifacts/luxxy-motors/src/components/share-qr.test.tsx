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
beforeEach(() => {
  api.mockReset();
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
  fireEvent.click(screen.getByRole("button", { name: "Create sharing link" }));
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
 api.mockResolvedValue({id:'pack',url:'https://dealer.test/phone-share#secret',message:'Hello Alex, your invoice is ready.',customerPhone:'07700 900123',hasAttachments:true,expiresAt:'2026-11-01T12:00:00Z'});
 render(<ShareQr whatsapp label="WhatsApp QR" source={{kind:'document',saleId:'sale',documentId:'doc'}} />);
 fireEvent.click(screen.getByRole('button',{name:'WhatsApp QR'}));
 const qr=await screen.findByTestId('qr'); const url=new URL(qr.getAttribute('data-value')!);
 expect(url.hostname).toBe('wa.me');expect(url.pathname).toBe('/447700900123');
 expect(url.searchParams.get('text')).toContain('Hello Alex, your invoice is ready.');
 expect(url.searchParams.get('text')).toContain('https://dealer.test/phone-share#secret');
 expect(api).toHaveBeenCalledTimes(1); expect(api.mock.calls[0][0]).toBe('/api/staff/phone-shares');
 fireEvent.change(screen.getByRole('textbox',{name:'Customer WhatsApp number'}),{target:{value:'+353 86 123 4567'}});
 expect(new URL(screen.getByTestId('qr').getAttribute('data-value')!).pathname).toBe('/353861234567');
});
it('requires a valid number and does not guess a recipient', async () => {
 render(<ShareQr whatsapp label="WhatsApp QR" url="/vehicle/car" message="Your car video" />);
 fireEvent.click(screen.getByRole('button',{name:'WhatsApp QR'}));
 await screen.findByRole('textbox',{name:'Customer WhatsApp number'});
 expect(screen.queryByTestId('qr')).toBeNull();
 expect(api).not.toHaveBeenCalled();
 fireEvent.change(screen.getByRole('textbox',{name:'Customer WhatsApp number'}),{target:{value:'07700 900123'}});
 expect(await screen.findByTestId('qr')).toBeVisible();
});
it('keeps long WhatsApp messages intact using the secure phone preview', async () => {
 const message='Long reviewed message '.repeat(200);
 api.mockResolvedValue({id:'pack',url:'https://dealer.test/phone-share#'+'a'.repeat(64),message,customerPhone:'07700 900123',hasAttachments:false});
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
 api.mockImplementation(async(url:string)=>url.includes('/enquiries?')?{enquiries:[],canCreate:true}:{id:'pack',url:'https://dealer.test/phone-share#secret',message:'Your invoice is ready.',customerPhone:'07700 900123',customerEmail:'alex@example.test',hasAttachments:true});
 render(<ShareQr whatsapp label="WhatsApp QR" source={{kind:'document',saleId:'sale',documentId:'doc'}} />);
 fireEvent.click(screen.getByRole('button',{name:'WhatsApp QR'}));await screen.findByTestId('qr');
 fireEvent.click(screen.getByRole('button',{name:'Use email instead'}));
 expect(screen.getByRole('textbox',{name:'Customer email'})).toHaveValue('alex@example.test');
 const email=new URL(screen.getByRole('link',{name:'Prepare email'}).getAttribute('href')!);
 expect(email.protocol).toBe('mailto:');expect(email.searchParams.get('body')).toContain('Your invoice is ready.');expect(email.searchParams.get('body')).toContain('https://dealer.test/phone-share#secret');
 expect(api.mock.calls.some(([url])=>url.endsWith('/confirm-whatsapp')||url.endsWith('/email'))).toBe(false);
});
