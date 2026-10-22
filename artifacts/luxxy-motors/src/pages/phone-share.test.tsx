import { beforeEach, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PhoneShare, { sharedFile } from "./phone-share";
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
