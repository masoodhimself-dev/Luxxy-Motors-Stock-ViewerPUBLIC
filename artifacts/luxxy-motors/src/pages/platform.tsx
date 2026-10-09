import { useEffect, useState } from 'react';
import { SignInButton, useAuth } from '@clerk/react';
import { customFetch } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
type Dealer = { id: string; name: string; status: string; canonicalOrigin: string; stockPlatform: string; retailerId: string };
const call = <T,>(path: string, method = 'GET', body?: unknown) => customFetch<T>('/api/platform' + path, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
export default function Platform() {
  const { isSignedIn } = useAuth(); const [dealers,setDealers] = useState<Dealer[]>([]), [error,setError] = useState(''), [notice,setNotice] = useState(''), [busy,setBusy] = useState(false);
  const [form,setForm] = useState({ id: '', name: '', canonicalOrigin: '', platform: 'autotrader', retailerId: '', sourceUrl: '', ownerAuthUserId: '' });
  async function load() { try { setDealers((await call<{ dealers: Dealer[] }>('/dealers')).dealers); setError(''); } catch { setError('Platform administrator access is required on the approved administration domain.'); } }
  useEffect(() => { if (isSignedIn) void load(); },[isSignedIn]);
  async function create() { setBusy(true); setError(''); try { const result = await call<{ dns: { name: string; value: string } }>('/dealers','POST',form); setNotice(`Dealership created as a draft. Add DNS TXT ${result.dns.name}: ${result.dns.value}. Then connect the domain to the shared Render service.`); await load(); } catch(cause) { setError(cause instanceof Error ? cause.message : 'Could not create dealership.'); } finally { setBusy(false); } }
  async function activate(d: Dealer) { setBusy(true); try { await call(`/dealers/${encodeURIComponent(d.id)}/verify-domain`,'POST',{hostname:new URL(d.canonicalOrigin).hostname}); await call(`/dealers/${encodeURIComponent(d.id)}/status`,'PUT',{status:'active'}); await load(); } catch(cause) { setError(cause instanceof Error ? cause.message : 'Verify the domain first.'); } finally { setBusy(false); } }
  return <main className="mx-auto max-w-6xl px-6 py-10"><p className="text-sm text-muted-foreground">Platform administration</p><h1 className="my-3 text-3xl font-semibold">Dealerships</h1><p className="mb-7 text-muted-foreground">Each dealership has its own domains, staff memberships and stock connection.</p>
    {!isSignedIn ? <SignInButton><Button>Sign in as platform administrator</Button></SignInButton> : <>
      {error && <p role="alert" className="mb-5 rounded-lg bg-destructive/10 p-4">{error}</p>}{notice && <p role="status" className="mb-5 whitespace-pre-wrap break-words rounded-lg bg-secondary p-4">{notice}</p>}
      {!error && <><section className="rounded-xl border bg-card p-6"><h2 className="mb-5 text-xl font-semibold">Add dealership</h2><div className="grid gap-4 sm:grid-cols-2">
        {([['id','Internal dealer ID'],['name','Dealership name'],['canonicalOrigin','Website origin (https://…)'],['retailerId','Grok retailer reference'],['sourceUrl','Authorised stock source URL'],['ownerAuthUserId','Owner Clerk user ID']] as const).map(([key,label]) => <label key={key} className="grid gap-2 text-sm">{label}<Input value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})} /></label>)}
        <label className="grid gap-2 text-sm">Marketplace<NativeSelect value={form.platform} onChange={e=>setForm({...form,platform:e.target.value})}><option value="autotrader">Auto Trader</option><option value="cazoo">Cazoo</option></NativeSelect></label>
      </div><Button className="mt-6" disabled={busy} onClick={()=>void create()}>Create draft dealership</Button></section>
      <div className="mt-6 grid gap-4">{dealers.map(d=><article key={d.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-5"><div><h2 className="font-semibold">{d.name}</h2><p className="text-sm text-muted-foreground">{d.canonicalOrigin} · {d.status} · {d.stockPlatform}</p><code className="text-xs">/api/stock/imports/{d.id}/grok</code></div><Button variant="outline" disabled={busy||d.status==='active'} onClick={()=>void activate(d)}>Verify DNS and activate</Button></article>)}</div>
      <p className="mt-5 text-sm text-muted-foreground">Domain verification does not configure Render DNS or TLS. Import credentials are issued once through the protected platform API and must go straight into the worker’s secure storage.</p></>}
    </>}
  </main>;
}
