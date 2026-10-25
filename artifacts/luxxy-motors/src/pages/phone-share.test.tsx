import { beforeEach, it, expect, vi } from "vitest";
import { act, render, screen, fireEvent } from "@testing-library/react";
import PhoneShare, { sharedFile, verifiedPriceWhatsAppUrl, type Pack } from "./phone-share";
beforeEach(() => {
  window.history.replaceState({}, "", `/phone-share#${"a".repeat(64)}`);
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          title: "Invoice",
          message: "Fictional invoice ready",
          expiresAt: "2026-11-01T12:00:00Z",
          files: [
            {
              filename: "invoice.pdf",
              content: btoa("fictional-pdf"),
              contentType: "application/pdf",
            },
          ],
        }),
      }),
  );
});
it("opens a private preview without automatically sharing and keeps the capability out of request URLs", async () => {
  const share = vi.fn();
  Object.defineProperty(navigator, "share", {
    configurable: true,
    value: share,
  });
  render(<PhoneShare />);
  expect(await screen.findByRole("heading", { name: "Invoice" })).toBeVisible();
  expect(share).not.toHaveBeenCalled();
  const call = (fetch as any).mock.calls[0];
  expect(call[0]).toBe("/api/phone-shares");
  expect(call[1].headers["x-phone-share-token"]).toBe("a".repeat(64));
  expect(call[1].referrerPolicy).toBe("no-referrer");
  expect(
    screen.getByRole("button", { name: "Download invoice.pdf" }),
  ).toBeVisible();
});
it("expired links show an error instead of customer content", async () => {
  vi.mocked(fetch).mockResolvedValue({
    ok: false,
    json: async () => ({ error: "This link expired." }),
  } as Response);
  render(<PhoneShare />);
  expect(await screen.findByRole("alert")).toHaveTextContent("expired");
  expect(
    screen.queryByRole("button", { name: "Share with customer" }),
  ).toBeNull();
});
it("missing tokens are rejected before fetching any content", async () => {
  window.history.replaceState({}, "", "/phone-share");
  render(<PhoneShare />);
  expect(await screen.findByRole("alert")).toHaveTextContent("incomplete");
  expect(fetch).not.toHaveBeenCalled();
});
it("attachments use the original document bytes and type", () => {
  const file = sharedFile({
    filename: "invoice.pdf",
    content: btoa("original-bytes"),
    contentType: "application/pdf",
  });
  expect(file.name).toBe("invoice.pdf");
  expect(file.size).toBe(14);
  expect(file.type).toBe("application/pdf");
});

it('long-message handoff keeps the token private and opens WhatsApp for the staff-selected customer', async () => {
 window.history.replaceState({},'',`/phone-share#${'a'.repeat(64)}?wa=${encodeURIComponent('+353861234567')}`);
 render(<PhoneShare />);
 const open=await screen.findByRole('link',{name:'Open WhatsApp'});
 const url=new URL(open.getAttribute('href')!);
 expect(url.pathname).toBe('/353861234567');
 expect(url.searchParams.get('text')).toContain('Fictional invoice ready');
 expect(url.searchParams.get('text')).toContain(`/phone-share#${'a'.repeat(64)}`);
 expect(url.searchParams.get('text')).not.toContain('?wa=');
 expect((fetch as any).mock.calls[0][1].headers['x-phone-share-token']).toBe('a'.repeat(64));
});
it('shows the WhatsApp recipient and makes sending separate from recording a staff confirmation', async()=>{
 window.history.replaceState({},'',`/phone-share#${'a'.repeat(64)}?wa=447700900123`);
 render(<PhoneShare/>);
 expect(await screen.findByText('+447700900123')).toBeVisible();
 expect(screen.getByRole('link',{name:'Open WhatsApp'})).toHaveAttribute('href',expect.stringContaining('/447700900123?'));
 expect(screen.getByText(/return to the signed-in sharing window/)).toBeVisible();
 expect(screen.queryByRole('button',{name:'I’ve sent it'})).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Other sharing options'})).toBeVisible();
});
it('an already-loaded expired pack does not offer downloads or WhatsApp',async()=>{
 vi.mocked(fetch).mockResolvedValue({ok:true,json:async()=>({title:'Expired invoice',message:'Private message',customerPhone:'07700900123',expiresAt:'2000-01-01T00:00:00Z',files:[{filename:'invoice.pdf',content:btoa('pdf'),contentType:'application/pdf'}]})} as Response);
 render(<PhoneShare/>);
 expect(await screen.findByRole('alert')).toHaveTextContent('expired');
 expect(screen.queryByRole('link',{name:'Open WhatsApp'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Download invoice.pdf'})).not.toBeInTheDocument();
 expect(screen.queryByText('Private message')).not.toBeInTheDocument();
});

it('uses the exact reviewed message including attachment expiry wording for WhatsApp and copying',async()=>{
 const copied=vi.fn().mockResolvedValue(undefined);
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:copied}});
 window.history.replaceState({},'',`/phone-share#${'a'.repeat(64)}?wa=447700900123`);
 render(<PhoneShare/>);
 const link=await screen.findByRole('link',{name:'Open WhatsApp'});
 const expected=`Fictional invoice ready\n\nView your documents and photos (available for 24 hours):\n${window.location.origin}/phone-share#${'a'.repeat(64)}`;
 expect(new URL(link.getAttribute('href')!).searchParams.get('text')).toBe(expected);
 fireEvent.click(screen.getByRole('button',{name:'Copy message'}));
 expect(copied).toHaveBeenCalledWith(expected);
});

function openQrInSameTab(hash: string) {
  act(() => {
    window.history.replaceState({}, '', `/phone-share#${hash}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}
function sharingResponse(title: string, message: string, customerPhone: string): Response {
  return { ok: true, json: async () => ({ title, message, customerPhone, expiresAt: '2030-11-01T12:00:00Z', files: [] }) } as Response;
}

it('clears the previous customer before checking another QR and shows only the new recipient', async () => {
  let resolveNext!: (response: Response) => void;
  const next = new Promise<Response>(resolve => { resolveNext = resolve; });
  vi.mocked(fetch).mockResolvedValueOnce(sharingResponse('First invoice', 'First customer message', '447700900111')).mockReturnValueOnce(next);
  render(<PhoneShare />);
  expect(await screen.findByRole('heading', { name: 'First invoice' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Open WhatsApp' })).toHaveAttribute('href', expect.stringContaining('/447700900111?'));

  openQrInSameTab(`${'b'.repeat(64)}?wa=447700900222`);
  expect(screen.queryByText('First customer message')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'First invoice' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Open WhatsApp' })).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Opening sharing pack');
  expect(vi.mocked(fetch).mock.calls[1][1]?.headers).toEqual({ 'x-phone-share-token': 'b'.repeat(64) });
  await act(async () => { resolveNext(sharingResponse('Second invoice', 'Second customer message', '447700900333')); });
  expect(await screen.findByRole('heading', { name: 'Second invoice' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Open WhatsApp' })).toHaveAttribute('href', expect.stringContaining('/447700900222?'));
  expect(screen.getByText('Second customer message')).toBeVisible();
  expect(screen.queryByText('First customer message')).not.toBeInTheDocument();
});

it('never restores the old files or customer when the second QR fails', async () => {
  vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ title: 'First invoice', message: 'Old private message', customerPhone: '447700900111', expiresAt: '2030-11-01T12:00:00Z', files: [{ filename: 'first.pdf', content: btoa('pdf'), contentType: 'application/pdf' }] }) } as Response)
    .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'This second link has expired.' }) } as Response);
  render(<PhoneShare />);
  expect(await screen.findByRole('button', { name: 'Download first.pdf' })).toBeVisible();
  openQrInSameTab('b'.repeat(64));
  expect(await screen.findByRole('alert')).toHaveTextContent('This second link has expired.');
  expect(screen.queryByText('Old private message')).not.toBeInTheDocument();
  expect(screen.queryByText('+447700900111')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Download first.pdf' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Open WhatsApp' })).not.toBeInTheDocument();
});

it('ignores a late response for an old QR after the next customer has loaded', async () => {
  let resolveOld!: (response: Response) => void;
  vi.mocked(fetch).mockReturnValueOnce(new Promise<Response>(resolve => { resolveOld = resolve; }))
    .mockResolvedValueOnce(sharingResponse('Current customer', 'Current message', '447700900222'));
  render(<PhoneShare />);
  openQrInSameTab('b'.repeat(64));
  expect(await screen.findByRole('heading', { name: 'Current customer' })).toBeVisible();
  await act(async () => { resolveOld(sharingResponse('Old customer', 'Old message', '447700900111')); });
  expect(screen.getByRole('heading', { name: 'Current customer' })).toBeVisible();
  expect(screen.queryByText('Old message')).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open WhatsApp' })).toHaveAttribute('href', expect.stringContaining('/447700900222?'));
});


const pricePack: Pack = {
  stockChange: { taskId: '00000000-0000-4000-8000-00000000f001', revision: 2 },
  title: 'A price update for the Toyota Yaris', message: 'The Toyota Yaris is now £8,495, reduced from £8,995.',
  customerPhone: '07700900123', expiresAt: '2099-11-01T12:00:00Z', files: [],
};
function priceResponse(pack = pricePack): Response {
  return { ok: true, json: async () => pack } as Response;
}
const priceHash = `#${'a'.repeat(64)}?wa=447700900123`;
it('price packs require a fresh check rather than exposing a static WhatsApp or unchecked copy action', async () => {
  vi.mocked(fetch).mockResolvedValue(priceResponse());
  render(<PhoneShare />);
  expect(await screen.findByRole('button', { name: 'Check price & open WhatsApp' })).toBeVisible();
  expect(screen.queryByRole('link', { name: 'Open WhatsApp' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Other sharing options' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Copy message' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'I’ve sent it' })).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(1);
});
it('a fresh price check returns the exact reviewed text and prefilled number without navigation or sending', async () => {
  vi.mocked(fetch).mockResolvedValue(priceResponse());
  const url = await verifiedPriceWhatsAppUrl({ pack: pricePack, hash: priceHash, baseUrl: 'https://dealer.example/phone-share', currentHash: () => priceHash });
  expect(new URL(url).pathname).toBe('/447700900123');
  expect(new URL(url).searchParams.get('text')).toBe(pricePack.message);
  expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/phone-shares');
  expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', headers: { 'x-phone-share-token': 'a'.repeat(64) } });
});
it.each([
  { message: 'A different price was supplied.' },
  { stockChange: { ...pricePack.stockChange!, revision: 3 } },
  { customerPhone: '07700900456' },
  { expiresAt: '2099-12-01T12:00:00Z' },
  { files: [{ filename: 'new.pdf', contentType: 'application/pdf', content: btoa('new') }] },
])('refuses a changed price pack without silently rewriting the reviewed message: %o', async changes => {
  vi.mocked(fetch).mockResolvedValue(priceResponse({ ...pricePack, ...changes }));
  await expect(verifiedPriceWhatsAppUrl({ pack: pricePack, hash: priceHash, baseUrl: 'https://dealer.example/phone-share', currentHash: () => priceHash })).rejects.toThrow('changed');
});
it('hides stale message actions after the server refuses a held-open price preview', async () => {
  let rejectCheck!: (response: Response) => void;
  vi.mocked(fetch).mockResolvedValueOnce(priceResponse()).mockReturnValueOnce(new Promise(resolve => { rejectCheck = resolve; }));
  render(<PhoneShare />);
  const button = await screen.findByRole('button', { name: 'Check price & open WhatsApp' });
  fireEvent.click(button);
  expect(screen.getByRole('button', { name: 'Checking current price…' })).toBeDisabled();
  expect(fetch).toHaveBeenCalledTimes(2);
  await act(async () => rejectCheck({ ok: false, json: async () => ({ error: 'The advertised price changed. Ask staff for fresh wording.' }) } as Response));
  expect(await screen.findByRole('alert')).toHaveTextContent('The advertised price changed');
  expect(screen.getByRole('alert')).toHaveTextContent('Nothing was opened or sent.');
  expect(screen.queryByText(pricePack.message)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Check price & open WhatsApp' })).not.toBeInTheDocument();
});
it('a QR change aborts the old price check and does not block checking the next customer', async () => {
  let resolveOld!: (response: Response) => void;
  const second = { ...pricePack, title: 'Second customer price update', customerPhone: '07700900456' };
  vi.mocked(fetch).mockResolvedValueOnce(priceResponse()).mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; }))
    .mockResolvedValueOnce(priceResponse(second)).mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Second check reached the server.' }) } as Response);
  render(<PhoneShare />);
  fireEvent.click(await screen.findByRole('button', { name: 'Check price & open WhatsApp' }));
  const oldSignal = vi.mocked(fetch).mock.calls[1][1]?.signal;
  openQrInSameTab(`${'b'.repeat(64)}?wa=447700900456`);
  expect(oldSignal?.aborted).toBe(true);
  expect(await screen.findByRole('heading', { name: 'Second customer price update' })).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Check price & open WhatsApp' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Second check reached the server.');
  expect(vi.mocked(fetch).mock.calls[3][1]?.headers).toEqual({ 'x-phone-share-token': 'b'.repeat(64) });
  await act(async () => resolveOld(priceResponse()));
  expect(screen.getByRole('alert')).toHaveTextContent('Second check reached the server.');
  expect(screen.queryByText(pricePack.message)).not.toBeInTheDocument();
});
it('rejects a late helper result after the staff phone has switched QR context', async () => {
  let finish!: (response: Response) => void;
  let current = priceHash;
  vi.mocked(fetch).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const pending = verifiedPriceWhatsAppUrl({ pack: pricePack, hash: priceHash, baseUrl: 'https://dealer.example/phone-share', currentHash: () => current });
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  current = 'b'.repeat(64);
  finish(priceResponse());
  await rejected;
});
it('refuses an expired price pack even if the server returned it successfully', async () => {
  const expired = { ...pricePack, expiresAt: '2000-01-01T12:00:00Z' };
  vi.mocked(fetch).mockResolvedValue(priceResponse(expired));
  await expect(verifiedPriceWhatsAppUrl({ pack: expired, hash: priceHash, baseUrl: 'https://dealer.example/phone-share', currentHash: () => priceHash })).rejects.toThrow('expired');
});


it.each(['447700900456', '07700900456', '+353861234567', 'invalid-number', ''])('refuses a price QR recipient override that differs from the confirmed customer: %s', async number => {
  vi.mocked(fetch).mockResolvedValue(priceResponse());
  const hash = `#${'a'.repeat(64)}?wa=${encodeURIComponent(number)}`;
  await expect(verifiedPriceWhatsAppUrl({ pack: pricePack, hash, baseUrl: 'https://dealer.example/phone-share', currentHash: () => hash })).rejects.toThrow('customer number');
});
it.each(['07700 900123', '+44 (7700) 900123', '00447700900123'])('accepts an equivalent normalized price QR customer number: %s', async number => {
  vi.mocked(fetch).mockResolvedValue(priceResponse());
  const hash = `#${'a'.repeat(64)}?wa=${encodeURIComponent(number)}`;
  const url = await verifiedPriceWhatsAppUrl({ pack: pricePack, hash, baseUrl: 'https://dealer.example/phone-share', currentHash: () => hash });
  expect(new URL(url).pathname).toBe('/447700900123');
});
it('uses the confirmed price customer when the QR has no recipient override', async () => {
  vi.mocked(fetch).mockResolvedValue(priceResponse());
  const hash = `#${'a'.repeat(64)}`;
  const url = await verifiedPriceWhatsAppUrl({ pack: pricePack, hash, baseUrl: 'https://dealer.example/phone-share', currentHash: () => hash });
  expect(new URL(url).pathname).toBe('/447700900123');
});
it('shows the server-confirmed price recipient and blocks an altered QR before opening WhatsApp', async () => {
  window.history.replaceState({}, '', `/phone-share#${'a'.repeat(64)}?wa=447700900456`);
  vi.mocked(fetch).mockResolvedValue(priceResponse());
  render(<PhoneShare />);
  const button = await screen.findByRole('button', { name: 'Check price & open WhatsApp' });
  expect(screen.getByText('+447700900123')).toBeVisible();
  expect(screen.queryByText('+447700900456')).not.toBeInTheDocument();
  fireEvent.click(button);
  expect(await screen.findByRole('alert')).toHaveTextContent('customer number');
  expect(screen.getByRole('alert')).toHaveTextContent('Nothing was opened or sent.');
  expect(screen.queryByRole('button', { name: 'Check price & open WhatsApp' })).not.toBeInTheDocument();
});
