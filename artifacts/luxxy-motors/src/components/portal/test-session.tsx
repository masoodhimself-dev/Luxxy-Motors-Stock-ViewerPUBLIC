import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { MoreHorizontal } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { TestSession } from '@/pages/sales-demo';
import { clearTestCustomerShortlist } from '@/lib/test-customer-shortlist-storage';
import { clearCustomerTestStorage } from '@/lib/customer-test-storage';

type TestCar = { id: string; title: string; registration: string; price: number };
type TestCustomer = { id: string; source: 'customer'|'enquiry'; name: string; phone: string; email: string };
type TestContact = {name:string;phone:string;email:string};

export function usePortalTestSession(scope: string, enabled: boolean) {
  const client = useQueryClient();
  const key = ['portal-test-session', scope];
  const query = useQuery({ queryKey: key, queryFn: async ({signal}) => {
    const value=await customFetch<{session: TestSession | null}>('/api/sales-test/sessions', {signal});
    if(!value || typeof value!=='object' || !Object.prototype.hasOwnProperty.call(value,'session') || value.session!==null && (!value.session || typeof value.session.sessionId!=='string' || !value.session.sessionId || typeof value.session.expiresAt!=='string' || !Number.isFinite(Date.parse(value.session.expiresAt)) || !value.session.vehicle?.id || !value.session.customer?.name)) throw new Error('Test workspace status could not be verified.');
    return value;
  }, enabled, retry: false, refetchOnWindowFocus: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const channel = useRef<BroadcastChannel | null>(null);
  const session = query.data?.session ?? null;
  const markerKey = `portal-test-session:${scope}`;
  useEffect(() => {
    if (!enabled || typeof BroadcastChannel === 'undefined') return;
    // Notify other tabs of a mode change so they recheck before offering controls.
    // The channel contains no customer or vehicle data.
    const next = new BroadcastChannel(`portal-test-mode:${scope}`);
    channel.current = next;
    next.onmessage = () => { void query.refetch(); };
    return () => { channel.current = null; next.close(); };
  }, [scope, enabled]);
  const [marker, setMarker] = useState<{id:string;expiresAt:string}|null>(() => {
    try { const raw = sessionStorage.getItem(markerKey); const value = raw ? JSON.parse(raw) : null; return value?.id && value?.expiresAt ? value : null; } catch { return null; }
  });
  const [clock, setClock] = useState(() => Date.now());
  function saveMarker(value:{id:string;expiresAt:string}|null) {
    setMarker(value);
    try { if (value) sessionStorage.setItem(markerKey, JSON.stringify(value)); else sessionStorage.removeItem(markerKey); } catch { /* Keep the in-memory guard. */ }
  }
  useEffect(() => {
    if (session && (!marker || marker.id !== session.sessionId || marker.expiresAt !== session.expiresAt)) saveMarker({id:session.sessionId,expiresAt:session.expiresAt});
  }, [session?.sessionId, session?.expiresAt, markerKey]);
  useEffect(() => {
    try { const raw=sessionStorage.getItem(markerKey); const value=raw ? JSON.parse(raw) : null; setMarker(value?.id && value?.expiresAt ? value : null); } catch { setMarker(null); }
  }, [markerKey]);
  useEffect(() => {
    const expiry = marker?.expiresAt ?? session?.expiresAt;
    if (!expiry) return;
    const delay = Math.max(0, new Date(expiry).getTime() - Date.now());
    const timeout = window.setTimeout(() => { setClock(Date.now()); void query.refetch(); }, Math.min(delay + 1000, 2147483647));
    return () => window.clearTimeout(timeout);
  }, [session?.sessionId, session?.expiresAt, marker?.id, marker?.expiresAt]);
  const locked = Boolean(marker && (new Date(marker.expiresAt).getTime() <= Math.max(clock, Date.now()) || query.isSuccess && query.data?.session === null));
  async function start(vehicleId: string, customerEnquiryId: string, customerSource:'customer'|'enquiry'|'test', testCustomer?:TestContact) {
    setBusy(true); setError('');
    try {
      const result = await customFetch<TestSession>('/api/sales-test/sessions', {method:'POST', body:JSON.stringify({vehicleId, customerEnquiryId, customerSource, ...(customerSource==='test'?{testCustomer}:{})}), headers:{'Content-Type':'application/json'}});
      saveMarker({id:result.sessionId,expiresAt:result.expiresAt});
      client.setQueryData(key, {session: result});
      channel.current?.postMessage('changed');
      return true;
    } catch (cause) {
      // A lost response may still have created a session; recover its state.
      const fresh = await query.refetch();
      if (fresh.data?.session) { channel.current?.postMessage('changed'); return true; }
      setError(cause instanceof Error ? cause.message : 'Could not start test mode.');
      return false;
    } finally { setBusy(false); }
  }
  async function end() {
    const sessionId = session?.sessionId ?? marker?.id;
    if (!sessionId || !window.confirm('End this test and remove its test records?')) return;
    setBusy(true); setError('');
    try {
      const result = await customFetch<{cleared: boolean}>(`/api/sales-test/sessions/${encodeURIComponent(sessionId)}`, {method:'DELETE'});
      if (!result.cleared) throw new Error('Test cleanup could not be confirmed.');
      clearTestCustomerShortlist(sessionId);
      clearCustomerTestStorage(sessionId);
      client.removeQueries({queryKey:['sales-test',sessionId]});
      saveMarker(null);
      client.setQueryData(key, {session:null});
      channel.current?.postMessage('changed');
    } catch (cause) {
      const fresh = await query.refetch();
      if (fresh.isSuccess && fresh.data?.session === null) { clearTestCustomerShortlist(sessionId); clearCustomerTestStorage(sessionId); client.removeQueries({queryKey:['sales-test',sessionId]}); saveMarker(null); channel.current?.postMessage('changed'); return; }
      setError(cause instanceof Error ? cause.message : 'Could not end test mode.');
    } finally { setBusy(false); }
  }
  return {session, guardSessionId:session?.sessionId ?? marker?.id ?? null, locked, start, end, busy, error, checking: enabled && query.isFetching, failed: enabled && query.isError, retry: () => query.refetch()};
}

export function TestModeMenu({active, busy, onStart, onEnd}: {active:boolean; busy:boolean; onStart:()=>void; onEnd:()=>void}) {
  return <div className="flex items-center gap-2">
    {active && <span className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900">Test mode</span>}
    <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="outline" size="icon" aria-label="More workspace options"><MoreHorizontal size={18}/></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end"><DropdownMenuItem disabled={busy} onSelect={active ? onEnd : onStart}>{active ? 'End test mode' : 'Start test mode'}</DropdownMenuItem></DropdownMenuContent>
    </DropdownMenu>
  </div>;
}

export function StartTestDialog({open, onOpenChange, onStart, busy, error, scope}: {open:boolean; onOpenChange:(open:boolean)=>void; onStart:(vehicleId:string,customerId:string,customerSource:'customer'|'enquiry'|'test',contact?:TestContact)=>Promise<boolean>; busy:boolean; error:string; scope:string}) {
  const [vehicleId,setVehicleId] = useState('');
  const [customerId,setCustomerId] = useState('');
  const [contact,setContact]=useState<TestContact>({name:'',phone:'',email:''});
  useEffect(() => { if (open) {setVehicleId(''); setCustomerId('');setContact({name:'',phone:'',email:''});} }, [open, scope]);
  const cars = useQuery({queryKey:['sales-test','available-vehicles',scope], queryFn:({signal}) => customFetch<{cars:TestCar[]}>('/api/sales-test/available-vehicles',{signal}), enabled:open, retry:false, gcTime:0});
  const customers = useQuery({queryKey:['sales-test','available-customers',scope], queryFn:({signal}) => customFetch<{customers:TestCustomer[]}>('/api/sales-test/available-customers',{signal}), enabled:open, retry:false, gcTime:0});
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent>
    <DialogHeader><DialogTitle>Start test mode</DialogTitle><DialogDescription>Choose a car and customer to copy into your test. Changes to the copies won’t change the originals.</DialogDescription></DialogHeader>
    <label className="grid gap-2 text-sm font-medium">Car<select className="w-full rounded border bg-background p-2" value={vehicleId} onChange={e=>setVehicleId(e.target.value)}><option value="">Choose a car</option>{cars.data?.cars.map(car=><option key={car.id} value={car.id}>{car.title}{car.registration ? ` · ${car.registration}` : ''}</option>)}</select></label>
    <label className="grid gap-2 text-sm font-medium">Customer<select className="w-full rounded border bg-background p-2" value={customerId} onChange={e=>setCustomerId(e.target.value)}><option value="">Choose a customer</option><option value="test:new">Enter a test customer</option>{customers.data?.customers.map(customer=><option key={`${customer.source}:${customer.id}`} value={`${customer.source}:${customer.id}`}>{customer.name}{customer.email ? ` · ${customer.email}` : ''}</option>)}</select></label>
    {customerId==='test:new' && <div className="grid gap-2"><label className="grid gap-1 text-sm">Test customer name<input className="rounded border bg-background p-2" maxLength={100} value={contact.name} onChange={e=>setContact({...contact,name:e.target.value})}/></label><label className="grid gap-1 text-sm">Email (optional)<input type="email" className="rounded border bg-background p-2" maxLength={254} value={contact.email} onChange={e=>setContact({...contact,email:e.target.value})}/></label><label className="grid gap-1 text-sm">Phone (optional)<input type="tel" className="rounded border bg-background p-2" maxLength={40} value={contact.phone} onChange={e=>setContact({...contact,phone:e.target.value})}/></label></div>}
    {(cars.isError || customers.isError) && <p role="alert">Could not load cars or customers. Close and retry.</p>}
    {cars.isSuccess && !cars.data.cars.length && <p>No available car was found.</p>}
    {error && <p role="alert">{error}</p>}
    <DialogFooter><Button type="button" variant="outline" onClick={()=>onOpenChange(false)}>Cancel</Button><Button type="button" disabled={!vehicleId || !customerId || busy || customerId==='test:new' && !contact.name.trim()} onClick={()=>{const [source,id]=customerId.split(':'); if ((source==='customer'||source==='enquiry'||source==='test') && id) void (source==='test'?onStart(vehicleId,id,source,contact):onStart(vehicleId,id,source)).then(ok=>{if(ok)onOpenChange(false);});}}>{busy?'Starting…':'Start test'}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
