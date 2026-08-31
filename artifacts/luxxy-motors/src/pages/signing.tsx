import { useState, type FormEvent } from 'react';
import {
  CheckCircle2,
  CircleAlert,
  FileText,
  LoaderCircle,
  LockKeyhole,
  ShieldAlert,
  Signature,
} from 'lucide-react';
import { useParams } from 'wouter';
import {
  getGetSigningSessionQueryKey,
  useCompleteSigningSession,
  useGetSigningSession,
} from '@workspace/api-client-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatPrice } from '@/lib/utils';

type SigningView = {
  developmentOnly: boolean;
  warning: string;
  session: { status: string; expiresAt: string };
  sale: { agreedPricePence: number; depositPence: number; balancePence: number; currency: string };
  customer: { name: string; email: string | null } | null;
  revision: {
    revisionNumber: number;
    packHash: string;
    snapshot: Record<string, unknown>;
    documents: Array<{ id: string; title: string; content: string; contentHash: string; required: boolean }>;
    acknowledgements: Array<{ code: string; statement: string }>;
  };
};

function apiMessage(error: unknown) {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: { error?: string } }).data;
    if (data?.error) return data.error;
  }
  return 'This signing action could not be completed. Please ask the dealer for a new link.';
}

function snapshotText(snapshot: Record<string, unknown>, key: string, fallback: string) {
  const value = snapshot[key];
  return value && typeof value === 'object' ? value as Record<string, unknown> : { value: fallback };
}

function displayValue(value: unknown, fallback = 'Not recorded') {
  return typeof value === 'string' && value.trim() ? value : typeof value === 'number' ? String(value) : fallback;
}

export default function Signing() {
  const { token = '' } = useParams<{ token: string }>();
  const query = useGetSigningSession(token, { query: { queryKey: getGetSigningSessionQueryKey(token), retry: false } });
  const complete = useCompleteSigningSession();
  const [signerName, setSignerName] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [accepted, setAccepted] = useState<string[]>([]);
  const view = query.data as unknown as SigningView | undefined;

  const toggleAcknowledgement = (code: string) => {
    setAccepted((current) => current.includes(code) ? current.filter((item) => item !== code) : [...current, code]);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!view) return;
    complete.mutate({
      token,
      data: {
        signerName: signerName.trim() || view.customer?.name || '',
        signerEmail: signerEmail.trim() || view.customer?.email || null,
        acceptedCodes: accepted,
      },
    });
  };

  if (complete.isSuccess) {
    return (
      <div className="min-h-[70vh] bg-muted/20 px-4 py-12 sm:py-20">
        <div className="mx-auto max-w-2xl rounded-3xl border bg-card p-8 text-center shadow-sm sm:p-12">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100"><CheckCircle2 className="h-8 w-8 text-green-700" /></div>
          <Badge className="mt-6">Development signature recorded</Badge>
          <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">Thank you, {signerName || view?.customer?.name}</h1>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">The demo signature and acknowledgements are now bound to this exact document-pack revision. The dealer can run the final checks from the portal.</p>
          <p className="mt-6 text-xs font-bold uppercase tracking-widest text-amber-700">DEVELOPMENT ONLY · NOT A LEGAL SIGNATURE</p>
        </div>
      </div>
    );
  }

  if (query.isLoading) {
    return <div className="flex min-h-[70vh] items-center justify-center bg-muted/20 text-muted-foreground"><LoaderCircle className="mr-3 h-6 w-6 animate-spin text-primary" /> Loading secure signing session…</div>;
  }

  if (query.isError || !view) {
    return (
      <div className="min-h-[70vh] bg-muted/20 px-4 py-12 sm:py-20">
        <div className="mx-auto max-w-xl rounded-3xl border border-amber-200 bg-amber-50 p-8 text-center text-amber-950 sm:p-12">
          <CircleAlert className="mx-auto h-10 w-10 text-amber-700" />
          <h1 className="mt-5 text-2xl font-black">Signing link unavailable</h1>
          <p className="mt-3 text-sm text-amber-900/80">This link may have expired, been revoked, or already been used. Ask the dealer to prepare a new development session.</p>
        </div>
      </div>
    );
  }

  const vehicle = snapshotText(view.revision.snapshot, 'vehicle', 'Vehicle');
  const terms = snapshotText(view.revision.snapshot, 'terms', 'Sale terms');
  const isSigned = view.session.status === 'signed';
  const allAccepted = view.revision.acknowledgements.every((item) => accepted.includes(item.code));

  return (
    <div className="min-h-[70vh] bg-muted/20 px-4 py-8 sm:py-14">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
          <div><p className="font-black uppercase tracking-wide">Development-only signing flow</p><p className="mt-1 text-amber-900/80">{view.warning}</p></div>
        </div>

        <div className="rounded-3xl border bg-card p-6 shadow-sm sm:p-9">
          <div className="flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-primary"><LockKeyhole className="h-4 w-4" /> Secure review link</p>
              <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">Review your vehicle sale</h1>
              <p className="mt-2 text-muted-foreground">Revision {view.revision.revisionNumber} · Expires {new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' }).format(new Date(view.session.expiresAt))}</p>
            </div>
            <Badge variant={isSigned ? 'default' : 'outline'}>{isSigned ? 'Signed' : 'Awaiting review'}</Badge>
          </div>

          <div className="mt-7 grid gap-4 sm:grid-cols-3">
            <div className="rounded-2xl border bg-muted/30 p-4 sm:col-span-2">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Vehicle</p>
              <p className="mt-2 text-xl font-black">{displayValue(vehicle.title, 'Vehicle sale')}</p>
              <p className="mt-1 text-sm text-muted-foreground">{displayValue(vehicle.registration)}{vehicle.year ? ` · ${vehicle.year}` : ''}{vehicle.mileage ? ` · ${vehicle.mileage.toLocaleString()} miles` : ''}</p>
            </div>
            <div className="rounded-2xl border bg-primary/5 p-4">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Agreed total</p>
              <p className="mt-2 text-2xl font-black text-primary">{formatPrice((Number(terms.agreedPricePence) || view.sale.agreedPricePence) / 100, view.sale.currency)}</p>
              <p className="mt-1 text-sm text-muted-foreground">Balance {formatPrice(view.sale.balancePence / 100, view.sale.currency)}</p>
            </div>
          </div>

          <div className="mt-7 space-y-4">
            <div className="flex items-center gap-2"><FileText className="h-5 w-5 text-primary" /><h2 className="text-xl font-black">Document pack</h2></div>
            {view.revision.documents.map((document) => (
              <details key={document.id} className="rounded-xl border bg-background p-4">
                <summary className="cursor-pointer list-none font-bold">{document.title}<span className="float-right text-xs font-normal text-muted-foreground">Hash {document.contentHash.slice(0, 12)}…</span></summary>
                <pre className="mt-4 whitespace-pre-wrap border-t pt-4 font-sans text-sm leading-relaxed text-muted-foreground">{document.content}</pre>
              </details>
            ))}
          </div>

          {!isSigned && (
            <form onSubmit={submit} className="mt-8 border-t pt-7">
              <div className="flex items-center gap-2"><Signature className="h-5 w-5 text-primary" /><h2 className="text-xl font-black">Development acknowledgement</h2></div>
              <p className="mt-2 text-sm text-muted-foreground">Read the complete pack, tick every statement, then enter the name used for this development demonstration.</p>
              <div className="mt-5 space-y-3">
                {view.revision.acknowledgements.map((item) => (
                  <label key={item.code} className="flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition hover:border-primary/40">
                    <input type="checkbox" checked={accepted.includes(item.code)} onChange={() => toggleAcknowledgement(item.code)} className="mt-1 h-4 w-4 accent-[hsl(var(--primary))]" />
                    <span className="text-sm font-semibold leading-relaxed">{item.statement}</span>
                  </label>
                ))}
              </div>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <label className="space-y-2 text-sm font-semibold"><span>Your full name</span><Input required minLength={2} value={signerName} onChange={(event) => setSignerName(event.target.value)} placeholder={view.customer?.name || 'Jane Smith'} /></label>
                <label className="space-y-2 text-sm font-semibold"><span>Email (optional)</span><Input type="email" value={signerEmail} onChange={(event) => setSignerEmail(event.target.value)} placeholder={view.customer?.email || 'jane@example.com'} /></label>
              </div>
              {complete.isError && <p className="mt-4 flex items-center gap-2 text-sm text-destructive"><CircleAlert className="h-4 w-4" />{apiMessage(complete.error)}</p>}
              <Button type="submit" size="lg" className="mt-6 w-full font-bold sm:w-auto" disabled={complete.isPending || !allAccepted}><Signature className="mr-2 h-4 w-4" />{complete.isPending ? 'Recording demo signature…' : 'Sign development pack'}</Button>
               <p className="mt-4 text-xs text-muted-foreground">Your signature is bound to pack hash <span className="font-mono">{view.revision.packHash.slice(0, 18)}…</span>. The raw signing token is never stored in the database.</p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}