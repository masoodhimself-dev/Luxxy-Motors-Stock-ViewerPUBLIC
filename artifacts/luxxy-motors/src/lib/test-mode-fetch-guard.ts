import { clearCustomerTestStorage } from './customer-test-storage';

/** Mark this tab's same-origin API requests so the server can reject live writes. */
export function installTestModeFetchGuard(sessionId:string) {
  const original=window.fetch;
  const originalOpen=window.XMLHttpRequest?.prototype.open;
  const originalSend=window.XMLHttpRequest?.prototype.send;
  const xhrTargets=new WeakMap<XMLHttpRequest,boolean>();
  const formSubmit=window.HTMLFormElement?.prototype.submit;
  const previousMarker=document.documentElement.dataset.testModeSession;
  document.documentElement.dataset.testModeSession=sessionId;
  const beaconDescriptor=Object.getOwnPropertyDescriptor(navigator,'sendBeacon');
  const originalBeacon=typeof navigator.sendBeacon==='function' ? navigator.sendBeacon.bind(navigator) : null;
  let beaconGuarded=false;
  if(originalBeacon) try {
    Object.defineProperty(navigator,'sendBeacon',{configurable:true,value:(url:string | URL,data?:BodyInit | null)=>{
      // Beacons cannot carry the test-session header; suppress them altogether.
      void url; void data; return false;
    }});
    beaconGuarded=true;
  } catch { /* The contact-intent helper also respects the marker below. */ }
  const guarded:typeof window.fetch = (input, init) => {
    const inputUrl=typeof input==='string' || input instanceof URL ? String(input) : input.url;
    let url:URL;
    try {url=new URL(inputUrl,window.location.href);} catch {return Promise.reject(new Error('This request is unavailable in test mode.'));}
    const method=String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if(url.origin!==window.location.origin || !url.pathname.startsWith('/api/')) {
      return ['GET','HEAD'].includes(method) ? original(input,init) : Promise.reject(new Error('This action is unavailable in test mode.'));
    }
    const headers=new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set('x-luxxy-test-session',sessionId);
    return original(input,{...init,headers});
  };
  window.fetch=guarded;
  if(originalOpen && originalSend) {
    window.XMLHttpRequest.prototype.open=function(this:XMLHttpRequest,...args:any[]) {
      let target:URL;try {target=new URL(String(args[1]),window.location.href);} catch {throw new DOMException('This request is unavailable in test mode.','SecurityError');}
      const isApi=target.origin===window.location.origin && target.pathname.startsWith('/api/');
      if(!isApi && !['GET','HEAD'].includes(String(args[0]).toUpperCase()))throw new DOMException('This action is unavailable in test mode.','SecurityError');
      xhrTargets.set(this,isApi);
      return (originalOpen as (...values:any[])=>void).apply(this,args);
    };
    window.XMLHttpRequest.prototype.send=function(body?:Document | XMLHttpRequestBodyInit | null) {
      if(xhrTargets.get(this)) this.setRequestHeader('x-luxxy-test-session',sessionId);
      return originalSend.call(this,body);
    };
  }
  const allowNativeForm=(form:HTMLFormElement) => {
    if(form.method.toUpperCase()==='GET')return true;
    const target=new URL(form.action,window.location.href);
    if(target.origin!==window.location.origin)return false;
    const prefix=`/api/sales-test/sessions/${sessionId}`;
    return target.pathname===prefix || target.pathname.startsWith(`${prefix}/`) || form.method.toUpperCase()==='PUT' && target.pathname==='/api/test-email-settings';
  };
  const onSubmit=(event:SubmitEvent)=>{if(event.target instanceof HTMLFormElement && !allowNativeForm(event.target))event.preventDefault();};
  document.addEventListener('submit',onSubmit,true);
  if(formSubmit) window.HTMLFormElement.prototype.submit=function(){if(allowNativeForm(this))formSubmit.call(this);};
  return () => {
    clearCustomerTestStorage(sessionId);
    if(window.fetch===guarded)window.fetch=original;
    if(originalOpen && originalSend) {window.XMLHttpRequest.prototype.open=originalOpen;window.XMLHttpRequest.prototype.send=originalSend;}
    document.removeEventListener('submit',onSubmit,true);
    if(formSubmit)window.HTMLFormElement.prototype.submit=formSubmit;
    if(document.documentElement.dataset.testModeSession===sessionId) {
      if(previousMarker===undefined)delete document.documentElement.dataset.testModeSession;
      else document.documentElement.dataset.testModeSession=previousMarker;
    }
    if(beaconGuarded) {
      if(beaconDescriptor) Object.defineProperty(navigator,'sendBeacon',beaconDescriptor);
      else Reflect.deleteProperty(navigator,'sendBeacon');
    }
  };
}
