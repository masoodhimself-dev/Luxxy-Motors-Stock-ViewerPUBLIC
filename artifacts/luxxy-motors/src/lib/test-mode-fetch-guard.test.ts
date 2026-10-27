import { afterEach, expect, it, vi } from 'vitest';
import { installTestModeFetchGuard } from './test-mode-fetch-guard';

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
it('marks same-origin API requests, preserves headers and removes the marker when test ends',async()=>{
  const underlying=vi.fn().mockResolvedValue(new Response('{}'));
  vi.stubGlobal('fetch',underlying);
  const restore=installTestModeFetchGuard('sandbox-session');
  await fetch('/api/sale-workspace',{method:'POST',headers:{'content-type':'application/json'}});
  const headers=new Headers(underlying.mock.calls[0][1].headers);
  expect(headers.get('x-luxxy-test-session')).toBe('sandbox-session');
  expect(headers.get('content-type')).toBe('application/json');
  await expect(fetch('https://other.example/api/anything',{method:'POST'})).rejects.toThrow(/unavailable in test mode/);
  await expect(fetch('/non-api-action',{method:'POST'})).rejects.toThrow(/unavailable in test mode/);
  await fetch('https://other.example/image.jpg');
  expect(underlying.mock.calls[1][0]).toEqual('https://other.example/image.jpg');
  restore();
  await fetch('/api/sale-workspace',{method:'POST'});
  expect(underlying.mock.calls[2][1]).toEqual({method:'POST'});
});
it('marks XMLHttpRequest calls and blocks native live forms',()=>{
  vi.spyOn(XMLHttpRequest.prototype,'open').mockImplementation(()=>{});
  vi.spyOn(XMLHttpRequest.prototype,'send').mockImplementation(()=>{});
  const setHeader=vi.spyOn(XMLHttpRequest.prototype,'setRequestHeader').mockImplementation(()=>{});
  const nativeSubmit=vi.spyOn(HTMLFormElement.prototype,'submit').mockImplementation(()=>{});
  const restore=installTestModeFetchGuard('00000000-0000-4000-8000-000000000001');
  const xhr=new XMLHttpRequest();xhr.open('POST','/api/enquiries');xhr.send();
  expect(setHeader).toHaveBeenCalledWith('x-luxxy-test-session','00000000-0000-4000-8000-000000000001');
  expect(()=>new XMLHttpRequest().open('POST','https://other.example/send')).toThrow(/unavailable in test mode/);
  expect(()=>new XMLHttpRequest().open('POST','/non-api-action')).toThrow(/unavailable in test mode/);
  const form=document.createElement('form');form.method='post';form.action='/api/enquiries';document.body.append(form);
  const event=new Event('submit',{bubbles:true,cancelable:true});form.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);form.submit();expect(nativeSubmit).not.toHaveBeenCalled();
  form.action='/api/sales-test/sessions/00000000-0000-4000-8000-000000000001/enquiries';
  form.submit();expect(nativeSubmit).toHaveBeenCalledTimes(1);form.remove();restore();
});
it('blocks beacons while test mode is active',()=>{
  const beacon=vi.fn().mockReturnValue(true);
  vi.stubGlobal('navigator',{sendBeacon:beacon});
  const restore=installTestModeFetchGuard('sandbox-session');
  expect(navigator.sendBeacon('/api/contact-intents','body')).toBe(false);
  expect(beacon).not.toHaveBeenCalled();
  expect(navigator.sendBeacon('https://example.test/analytics','body')).toBe(false);
  expect(beacon).not.toHaveBeenCalled();
  restore();
  expect(navigator.sendBeacon('/api/contact-intents','body')).toBe(true);
});
