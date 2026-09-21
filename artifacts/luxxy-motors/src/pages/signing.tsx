import { useEffect, useState, type FormEvent } from 'react';
import {
  CheckCircle2,
  CircleAlert,
  FileText,
  LoaderCircle,
  LockKeyhole,
  ShieldAlert,
  Download,
  Printer,
} from 'lucide-react';
import { useParams } from 'wouter';
import {
  getGetSigningSessionQueryKey,
  useCompleteSigningSession,
  useGetSigningSession,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatPhoneDisplay, formatPrice } from '@/lib/utils';
import { useStock } from '@/lib/stock-context';
import { useDealerSettings } from '@/lib/dealer-settings-context';

const labelClass = 'field-label';

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
  const { stock } = useStock();
  const { settings } = useDealerSettings();
  const [failedPhoto, setFailedPhoto] = useState<string | null>(null);
  const { token = '' } = useParams<{ token: string }>();
  const query = useGetSigningSession(token, { query: { queryKey: getGetSigningSessionQueryKey(token), retry: false } });
  const complete = useCompleteSigningSession();
  const [signerName, setSignerName] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [accepted, setAccepted] = useState<string[]>([]);
  const view = query.data as unknown as SigningView | undefined;

  useEffect(() => {
    if (complete.isSuccess) {
      const receipt = document.getElementById('receipt-heading');
      receipt?.focus();
      receipt?.scrollIntoView({ block: 'start', behavior: 'auto' });
    }
  }, [complete.isSuccess]);

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

  if (query.isLoading) {
    return (
      <div className="luxxy-shell min-h-[70vh] bg-background px-4 py-12 sm:px-6 sm:py-20 lg:px-8">
        <div className="mx-auto flex min-h-64 max-w-xl items-center justify-center border border-border bg-card p-8 shadow-none" data-testid="loading-signing-session">
          <p className="font-display text-[14px] font-semibold tracking-normal flex items-center gap-3 text-primary">
            <LoaderCircle className="h-6 w-6 animate-spin text-accent" />
            Loading document pack…
          </p>
        </div>
      </div>
    );
  }

  if (query.isError || !view || view.session.status === 'completed' || view.session.status === 'expired') {
    return (
      <div className="luxxy-shell min-h-[70vh] px-4 py-12 sm:px-6 sm:py-20 lg:px-8 bg-background">
        <div className="mx-auto max-w-xl border border-destructive bg-destructive/5 px-8 py-12 text-center text-destructive shadow-none">
          <CircleAlert className="mx-auto h-10 w-10 text-destructive" />
          <h1 className="mt-6 font-display text-3xl font-semibold tracking-tight">Cannot open documents</h1>
          <p className="mx-auto mt-6 max-w-sm text-[13px] font-normal leading-relaxed text-destructive/80 border-l-2 border-destructive pl-4">{apiMessage(query.error)}</p>
        </div>
      </div>
    );
  }

  const { revision, warning, developmentOnly } = view;
  const vehicle = snapshotText(revision.snapshot, 'vehicle', 'Vehicle details unavailable');
  const details = snapshotText(revision.snapshot, revision.snapshot.customer ? 'customer' : 'details', 'Details unavailable');
  const vehicleName = displayValue(vehicle.title || vehicle.value, 'Vehicle details unavailable');
  const matchedCar = stock?.cars.find(car => car.id === vehicle.id);
  const photo = matchedCar?.heroImage;
  const signed = complete.isSuccess || view.session.status === 'signed';
  const contactPhone = settings.contact.phone;
  const contactEmail = settings.contact.email;
  const downloadPack = () => {
    const text = [`Document pack — revision ${revision.revisionNumber}`, signed ? 'Signature recorded for this revision. This is a copy of the supplied text, not a certified signed PDF.' : 'Review copy — not evidence of a signature.', ...revision.documents.map(doc => `${doc.title}\n\n${doc.content || 'Document content unavailable.'}`)].join('\n\n────────────────────\n\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `purchase-documents-revision-${revision.revisionNumber}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const contact = <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
    {contactPhone && <a className="text-link min-h-11 text-sm" href={`tel:${contactPhone.replace(/[^0-9+]/g, '')}`}>Call {formatPhoneDisplay(contactPhone)}</a>}
    {contactEmail && <a className="text-link min-h-11 break-all text-sm" href={`mailto:${contactEmail}`}>Email the team</a>}
    {!contactPhone && !contactEmail && <p className="text-sm">Contact the dealer using the details provided with your purchase.</p>}
  </div>;


  const allRequiredAccepted = revision.acknowledgements.every((ack) => accepted.includes(ack.code));
  const canSubmit = allRequiredAccepted && !complete.isPending;

  return (
    <div className="customer-purchase luxxy-shell min-h-[70vh] bg-background px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-8 flex items-start gap-4 border border-border bg-card px-6 py-6 shadow-none">
          <LockKeyhole className="mt-1 h-6 w-6 shrink-0 text-accent" />
          <div>
            <h1 className="section-heading">{signed ? "Your confirmation" : "Review your purchase"}</h1>
            <p className="mt-2 text-[13px] font-normal leading-relaxed text-primary/70">
              {signed ? 'Keep your document copy and contact the team about the next steps.' : 'Check the details, read your documents and confirm when you are ready.'}
            </p>
          </div>
        </div>

        <nav aria-label="Purchase review steps" className="purchase-actions mb-8 border-b border-border pb-4">
          <ol className="grid grid-cols-3 gap-3 text-sm font-medium">
            {[['purchase-heading', 'Review purchase'], ['pack-heading', 'Read documents'], [signed ? 'receipt-heading' : 'agreement-heading', signed ? 'Confirmed' : 'Confirm']].map(([id, label], index) => <li key={id}><a className="flex min-h-11 items-center gap-2" href={`#${id}`} onClick={() => document.getElementById(id)?.focus()}><span className="text-muted-foreground">{index + 1}.</span>{label}</a></li>)}
          </ol>
        </nav>
        {signed && <section role="status" className="mb-8 border-y border-border py-6" data-testid="signing-receipt"><CheckCircle2 className="mb-3 h-6 w-6 text-accent" /><h2 id="receipt-heading" tabIndex={-1} className="section-heading scroll-mt-28">{developmentOnly ? 'Development signature recorded' : 'Signature recorded'}</h2><p className="mt-3 text-sm leading-7">Thank you, {signerName || view.customer?.name}. Your confirmation relates to document pack revision {revision.revisionNumber}. The dealer still needs to complete the final sale checks.</p><p className="mt-2 text-sm text-muted-foreground">Keep a copy of your documents below. This confirmation is not a payment receipt or confirmation that the vehicle has been handed over.</p></section>}
        {developmentOnly && (
          <div className="mb-8 flex items-start gap-4 border border-accent bg-accent/5 px-6 py-6 text-accent shadow-none">
            <ShieldAlert className="mt-1 h-6 w-6 shrink-0" />
            <div>
              <p className="font-display text-[13px] font-semibold tracking-normal">Development mode</p>
              <p className="mt-2 text-[12px] font-normal leading-relaxed text-foreground">{warning}</p>
            </div>
          </div>
        )}

        <div className="space-y-8">
          <div className="flex flex-col gap-8">
            <div className="grid gap-6 md:grid-cols-2">
            <section className="border border-border bg-card shadow-none">
              <div className="border-b border-border px-5 sm:px-8 py-6">
                <h2 id="purchase-heading" tabIndex={-1} className="section-heading scroll-mt-28">Your purchase</h2>
              </div>
              <div className="px-5 py-6 sm:px-8">
                {photo && failedPhoto !== photo && <img src={photo} onError={() => setFailedPhoto(photo)} alt={vehicleName} className="mb-5 aspect-[4/3] w-full max-w-sm rounded-sm object-cover" />}
                <p className="font-display text-xl font-semibold tracking-tight text-primary">{vehicleName}</p>
                <div className="mt-6 flex flex-wrap gap-x-8 gap-y-4 font-normal text-[13px] text-primary/80">
                  {Boolean(vehicle.registration) && <p>Reg: <span className="text-primary">{String(vehicle.registration)}</span></p>}
                  {Boolean(vehicle.vin) && <p>VIN: <span className="text-primary">{String(vehicle.vin)}</span></p>}
                  {vehicle.mileage != null && <p>Mileage: <span className="text-primary">{typeof vehicle.mileage === 'number' ? `${vehicle.mileage.toLocaleString('en-GB')} miles` : String(vehicle.mileage)}</span></p>}
                </div>
              </div>
            </section>

            <section className="border border-border bg-card shadow-none">
              <div className="border-b border-border px-5 sm:px-8 py-6">
                <h2 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-primary">The deal</h2>
              </div>
              <dl className="px-5 py-6 sm:px-8 space-y-4">
                <div className="flex justify-between items-center py-2 border-b border-primary/10">
                  <dt className="font-display text-[11px] font-semibold tracking-normal text-muted-foreground">Agreed price</dt>
                  <dd className="font-display text-[18px] font-semibold tracking-tight text-primary">{formatPrice(view.sale.agreedPricePence / 100, view.sale.currency)}</dd>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-primary/10">
                  <dt className="font-display text-[11px] font-semibold tracking-normal text-muted-foreground">Agreed deposit</dt>
                  <dd className="font-display text-[18px] font-semibold tracking-tight text-primary">{formatPrice(view.sale.depositPence / 100, view.sale.currency)}</dd>
                </div>
                <div className="flex justify-between items-center py-2">
                  <dt className="font-display text-[11px] font-semibold tracking-normal text-muted-foreground">Balance after agreed deposit</dt>
                  <dd className="font-display text-[22px] font-semibold tracking-tight text-primary">{formatPrice(view.sale.balancePence / 100, view.sale.currency)}</dd>
                </div>
              </dl>
              <p className="px-5 pb-6 text-sm leading-6 text-muted-foreground sm:px-8">The deposit amount is part of the agreed terms. Payment receipt is not confirmed by this page; check with the team before making a payment.</p>
            </section>

            </div>
            <section className="border-b border-border pb-6">
              <div className="px-0 py-3 flex items-center justify-between gap-4">
                <h2 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-primary">Your details</h2>
                <a href="#corrections-heading" onClick={() => document.getElementById("corrections-heading")?.focus()} className="inline-flex min-h-11 items-center justify-center px-2 text-sm font-semibold text-accent">Request a correction</a>
              </div>
              <dl className="grid gap-x-8 gap-y-4 py-3 sm:grid-cols-3">
                <div>
                  <dt className="font-display text-[11px] font-semibold tracking-normal text-muted-foreground mb-1">Name</dt>
                  <dd className="break-words font-bold text-[13px] tracking-normal text-primary">{displayValue(details.name)}</dd>
                </div>
                <div>
                  <dt className="font-display text-[11px] font-semibold tracking-normal text-muted-foreground mb-1">Email</dt>
                  <dd className="break-words font-bold text-[13px] tracking-normal text-primary">{displayValue(details.email)}</dd>
                </div>
                <div>
                  <dt className="font-display text-[11px] font-semibold tracking-normal text-muted-foreground mb-1">Phone</dt>
                  <dd className="break-words font-bold text-[13px] tracking-normal text-primary">{displayValue(details.phone)}</dd>
                </div>
              </dl>
            </section>
            {Boolean(revision.snapshot.terms) && typeof revision.snapshot.terms === 'object' && Boolean((revision.snapshot.terms as Record<string, unknown>).disclosureNotes) && <section className="border-l-2 border-accent pl-5"><h2 className="text-lg font-semibold">Vehicle disclosures</h2><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7">{displayValue((revision.snapshot.terms as Record<string, unknown>).disclosureNotes)}</p></section>}
            <section className="border-y border-border py-6" aria-labelledby="corrections-heading"><h2 id="corrections-heading" tabIndex={-1} className="scroll-mt-28 text-lg font-semibold">Something incorrect?</h2><p className="mt-2 text-sm leading-7">For contact details, ask the team for a secure update link. Changes to the price, vehicle or purchase terms must be made by the dealer before you confirm. If the document pack changes, review the new revision.</p>{contact}</section>
            <section className="border-b border-border pb-6" aria-labelledby="next-heading"><h2 id="next-heading" className="text-lg font-semibold">Collection or delivery</h2><p className="mt-2 text-sm leading-7">Appointment, delivery address and handover arrangements are not supplied with this link. Please confirm these with the team before travelling or arranging delivery.</p><p className="mt-2 text-sm text-muted-foreground">After your confirmation, the dealer will review the sale and discuss the remaining payment and handover steps with you.</p></section>
            <section aria-labelledby="pack-heading" className="border border-border bg-card">
              <div className="border-b border-border px-5 py-5 sm:px-8">
                <h2 id="pack-heading" tabIndex={-1} className="section-heading scroll-mt-28">Your documents</h2>
                <p className="mt-2 text-sm text-muted-foreground">{signed ? 'Your document copy.' : 'Read the complete pack below before agreeing.'} Revision {revision.revisionNumber}.</p>
              </div>
              <div className="purchase-actions flex flex-wrap gap-3 border-b border-border px-5 py-4 sm:px-8"><Button type="button" variant="outline" onClick={downloadPack} disabled={!revision.documents.length}><Download className="mr-2 h-4 w-4" />Download document text</Button><Button type="button" variant="outline" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" />Print / save PDF</Button></div>
              {revision.documents.length ? revision.documents.map((document) => (
                <article key={document.id} className="border-b border-border px-5 py-6 last:border-0 sm:px-8">
                  <h3 className="flex items-start gap-2 text-base font-semibold"><FileText aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />{document.title}</h3>
                  {document.required && <p className="mt-1 text-xs text-muted-foreground">Part of your agreement</p>}
                  <div className="mt-4 max-w-prose whitespace-pre-wrap break-words text-sm leading-7" data-testid="signing-document-content">{document.content || 'Document content is unavailable. Contact the dealer before agreeing.'}</div>
                </article>
              )) : <p className="px-5 py-6 text-sm leading-6 sm:px-8">No documents were supplied with this pack. Contact the dealer before agreeing.</p>}
            </section>
          </div>

          {!signed && <form onSubmit={submit} className="purchase-agreement flex flex-col gap-6 border-t-2 border-primary bg-card shadow-none">
            <div className="border-b border-border px-5 sm:px-8 py-6">
              <h2 id="agreement-heading" tabIndex={-1} className="scroll-mt-28 font-display text-2xl font-semibold tracking-tight text-primary">Agreement</h2>
              <a href="#pack-heading" className="text-link mt-2 min-h-11 text-sm" onClick={() => document.getElementById('pack-heading')?.focus()}><FileText className="h-4 w-4" aria-hidden="true" />Read document pack</a>
              <p className="mt-2 text-[11px] font-normal leading-relaxed text-primary/70">
                Confirm your agreement below. You cannot sign until you check these boxes.
              </p>
            </div>
            <div className="px-5 sm:px-8 space-y-4">
              {revision.acknowledgements.map((ack) => {
                const isAccepted = accepted.includes(ack.code);
                return (
                  <label
                    key={ack.code}
                    className={`flex items-start gap-4 cursor-pointer border p-4 transition-colors ${
                      isAccepted ? 'border-primary bg-primary/5' : 'border-border bg-background hover:border-primary/50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      required
                      checked={isAccepted}
                      onChange={() => toggleAcknowledgement(ack.code)}
                      className="mt-1 h-5 w-5 shrink-0 accent-primary"
                    />
                    <span className="text-[12px] font-normal leading-relaxed text-primary/80 select-none">
                      {ack.statement}
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="px-5 sm:px-8 pb-8 space-y-6">
              <label className="block">
                <span className={labelClass}>Signer name</span>
                <Input
                  required
                  value={signerName}
                  onChange={(event) => setSignerName(event.target.value)}
                  placeholder={view.customer?.name || "Your full name"}
                />
              </label>
              <label className="block">
                <span className={labelClass}>Signer email</span>
                <Input
                  required
                  type="email"
                  value={signerEmail}
                  onChange={(event) => setSignerEmail(event.target.value)}
                  placeholder={view.customer?.email || "you@example.com"}
                />
              </label>
              {complete.isError && (
                <p role="alert" className="border border-destructive/50 bg-background p-4 text-[11px] font-normal text-destructive">
                  {apiMessage(complete.error)}
                </p>
              )}
              <Button type="submit" size="lg" className="w-full min-h-12 rounded-md font-display text-[13px] font-semibold tracking-normal shadow-none transition-all" disabled={!canSubmit}>
                {complete.isPending ? 'Signing…' : 'Sign and agree'}
              </Button>
            </div>
          </form>}
          {signed && <section id="agreement-heading" tabIndex={-1} className="scroll-mt-28 border-t border-border py-6"><h2 className="section-heading">Need a hand?</h2><p className="mt-2 text-sm">Contact the team about your documents or the next steps.</p>{contact}</section>}
        </div>
      </div>
    </div>
  );
}