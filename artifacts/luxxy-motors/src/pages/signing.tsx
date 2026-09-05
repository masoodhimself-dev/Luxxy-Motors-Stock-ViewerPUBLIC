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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatPrice } from '@/lib/utils';

const labelClass = 'luxxy-label mb-2 block text-muted-foreground';

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
      <div className="luxxy-shell min-h-[70vh] px-4 py-12 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto max-w-2xl border border-border/70 bg-card">
          <div className="flex items-center gap-3 border-b border-border/70 px-6 py-4">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-accent" />
            <p className="luxxy-label text-muted-foreground">Development signature recorded</p>
          </div>
          <div className="px-6 py-10 text-center sm:px-10 sm:py-12">
            <h1 className="font-display text-[2rem] font-semibold leading-[1.04] tracking-[-.03em] text-primary sm:text-[2.4rem]">
              Thank you, {signerName || view?.customer?.name}
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-sm leading-7 text-muted-foreground">
              The demo signature and acknowledgements are now bound to this exact document-pack revision. The dealer can run the final checks from the portal.
            </p>
            <p className="luxxy-label mt-8 inline-block border border-[#d4bd83] bg-[#f7f0dd] px-3 py-2 text-[#80611f]">
              Development only · Not a legal signature
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div className="luxxy-shell flex min-h-[70vh] items-center justify-center px-4">
        <p className="luxxy-label flex items-center gap-3 text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin text-accent" />
          Loading secure signing session…
        </p>
      </div>
    );
  }

  if (query.isError || !view) {
    return (
      <div className="luxxy-shell min-h-[70vh] px-4 py-12 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto max-w-xl border border-[#d4bd83] bg-[#f7f0dd] px-6 py-10 text-center text-[#80611f] sm:px-10 sm:py-12">
          <CircleAlert className="mx-auto h-8 w-8" />
          <h1 className="mt-6 font-display text-[1.75rem] font-semibold leading-[1.06] tracking-[-.03em]">Signing link unavailable</h1>
          <p className="mx-auto mt-4 max-w-sm text-sm leading-7">
            This link may have expired, been revoked, or already been used. Ask the dealer to prepare a new development session.
          </p>
        </div>
      </div>
    );
  }

  const vehicle = snapshotText(view.revision.snapshot, 'vehicle', 'Vehicle');
  const terms = snapshotText(view.revision.snapshot, 'terms', 'Sale terms');
  const isSigned = view.session.status === 'signed';
  const allAccepted = view.revision.acknowledgements.every((item) => accepted.includes(item.code));

  return (
    <div className="luxxy-shell min-h-[70vh] px-4 py-8 sm:px-6 sm:py-14 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-5 flex items-start gap-3 border border-[#d4bd83] bg-[#f7f0dd] px-4 py-4 text-[#80611f]">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="luxxy-label">Development-only signing flow</p>
            <p className="mt-2 text-[13px] leading-6">{view.warning}</p>
          </div>
        </div>

        <div className="border border-border/70 bg-card">
          <div className="flex flex-col gap-5 border-b border-border/70 px-6 py-6 sm:flex-row sm:items-start sm:justify-between sm:px-8">
            <div>
              <p className="luxxy-label flex items-center gap-2 text-accent">
                <LockKeyhole className="h-3.5 w-3.5" /> Secure review link
              </p>
              <h1 className="mt-4 font-display text-[2rem] font-semibold leading-[1.04] tracking-[-.03em] text-primary sm:text-[2.4rem]">
                Review your vehicle sale
              </h1>
              <p className="mt-3 font-mono text-[13px] font-bold text-muted-foreground">
                Revision {view.revision.revisionNumber} · Expires {new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' }).format(new Date(view.session.expiresAt))}
              </p>
            </div>
            <span className={`luxxy-label shrink-0 border px-3 py-2 ${isSigned ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground'}`}>
              {isSigned ? 'Signed' : 'Awaiting review'}
            </span>
          </div>

          <div className="grid gap-4 px-6 py-7 sm:grid-cols-3 sm:px-8">
            <div className="border border-border/70 bg-background p-5 sm:col-span-2">
              <p className="luxxy-label text-muted-foreground">Vehicle</p>
              <p className="mt-3 font-display text-xl font-semibold leading-tight tracking-[-.02em] text-primary">{displayValue(vehicle.title, 'Vehicle sale')}</p>
              <p className="mt-2 font-mono text-[13px] font-bold text-muted-foreground">
                {displayValue(vehicle.registration)}{vehicle.year ? ` · ${vehicle.year}` : ''}{vehicle.mileage ? ` · ${vehicle.mileage.toLocaleString()} miles` : ''}
              </p>
            </div>
            <div className="border border-border/70 bg-secondary/40 p-5">
              <p className="luxxy-label text-muted-foreground">Agreed total</p>
              <p className="luxxy-price mt-3 text-[1.75rem] leading-none text-primary">
                {formatPrice((Number(terms.agreedPricePence) || view.sale.agreedPricePence) / 100, view.sale.currency)}
              </p>
              <p className="mt-2 text-[13px] font-semibold text-muted-foreground">Balance <span className="luxxy-price-inline text-foreground">{formatPrice(view.sale.balancePence / 100, view.sale.currency)}</span></p>
            </div>
          </div>

          <div className="border-t border-border/70 px-6 py-7 sm:px-8">
            <div className="flex items-center gap-3">
              <FileText className="h-4 w-4 shrink-0 text-accent" />
              <h2 className="luxxy-label text-primary">Document pack</h2>
            </div>
            <div className="mt-5 space-y-3">
              {view.revision.documents.map((document) => (
                <details key={document.id} className="border border-border/70 bg-background p-4">
                  <summary className="flex cursor-pointer list-none items-baseline justify-between gap-4 text-sm font-bold text-primary">
                    {document.title}
                    <span className="shrink-0 font-mono text-[11px] font-bold text-muted-foreground">Hash {document.contentHash.slice(0, 12)}…</span>
                  </summary>
                  <pre className="mt-4 whitespace-pre-wrap border-t border-border/70 pt-4 font-sans text-sm leading-7 text-muted-foreground">{document.content}</pre>
                </details>
              ))}
            </div>
          </div>

          {!isSigned && (
            <form onSubmit={submit} className="border-t border-border/70 px-6 py-7 sm:px-8">
              <div className="flex items-center gap-3">
                <Signature className="h-4 w-4 shrink-0 text-accent" />
                <h2 className="luxxy-label text-primary">Development acknowledgement</h2>
              </div>
              <p className="mt-4 text-sm leading-7 text-muted-foreground">
                Read the complete pack, tick every statement, then enter the name used for this development demonstration.
              </p>
              <div className="mt-5 space-y-3">
                {view.revision.acknowledgements.map((item) => (
                  <label key={item.code} className="flex cursor-pointer items-start gap-3 border border-border/70 bg-background p-4 transition-colors hover:border-accent">
                    <input type="checkbox" checked={accepted.includes(item.code)} onChange={() => toggleAcknowledgement(item.code)} className="mt-1 h-4 w-4 shrink-0 rounded-none accent-[hsl(var(--primary))]" />
                    <span className="text-[13px] font-semibold leading-6 text-foreground">{item.statement}</span>
                  </label>
                ))}
              </div>
              <div className="mt-6 grid gap-5 sm:grid-cols-2">
                <label className="block">
                  <span className={labelClass}>Your full name</span>
                  <Input required minLength={2} value={signerName} onChange={(event) => setSignerName(event.target.value)} placeholder={view.customer?.name || 'Jane Smith'} className="h-11" />
                </label>
                <label className="block">
                  <span className={labelClass}>Email (optional)</span>
                  <Input type="email" value={signerEmail} onChange={(event) => setSignerEmail(event.target.value)} placeholder={view.customer?.email || 'jane@example.com'} className="h-11" />
                </label>
              </div>
              {complete.isError && (
                <p role="alert" className="mt-5 flex items-start gap-2.5 border border-[#c9a49c] bg-[#f7ece9] p-3 text-[13px] leading-6 text-[#8d3e34]">
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  {apiMessage(complete.error)}
                </p>
              )}
              <Button type="submit" size="lg" className="mt-7 h-12 w-full rounded-none text-sm font-bold shadow-none sm:w-auto sm:px-8" disabled={complete.isPending || !allAccepted}>
                <Signature className="mr-2 h-4 w-4" />
                {complete.isPending ? 'Recording demo signature…' : 'Sign development pack'}
              </Button>
              <p className="mt-5 text-[13px] leading-6 text-muted-foreground">
                Your signature is bound to pack hash <span className="font-mono font-bold text-primary">{view.revision.packHash.slice(0, 18)}…</span>. The raw signing token is never stored in the database.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
