import { useEffect, useRef, useState } from 'react';
import { useRoute } from 'wouter';
import { CustomerDocumentTheme } from '@/components/multi-customer-theme';
import { UKNumberPlate } from '@/components/uk-number-plate';
import { Button } from '@/components/ui/button';
import { Car, CheckCircle2, Download, FileText, Mail, Phone, ShieldCheck, Wallet } from '@/components/icons';
import './payment-request.css';

export type PublicPaymentRequest = {
  reference: string; saleReference: string; kind: 'deposit' | 'balance' | 'other';
  amountPence: number; amountDuePence: number; balancePence: number; dueDate: string; note: string;
  customer: string; vehicle: string; registration: string;
  dealer: { name: string; phone: string; email: string };
  paymentInstructions: string; paymentReportedAt?: string; invoiceRequestedAt?: string; invoiceAvailable: boolean;
};
const money = (pence: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pence / 100);
function date(value: string) { const parsed = new Date(`${value}T12:00:00Z`); return Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : value; }
function validView(value: unknown): value is PublicPaymentRequest {
  const view = value as PublicPaymentRequest | undefined;
  return Boolean(view && typeof view.reference === 'string' && typeof view.vehicle === 'string' && typeof view.registration === 'string'
    && typeof view.customer === 'string' && view.dealer && typeof view.dealer.name === 'string' && Number.isSafeInteger(view.amountDuePence) && view.amountDuePence >= 0
    && Number.isSafeInteger(view.amountPence) && view.amountPence > 0 && Number.isSafeInteger(view.balancePence) && typeof view.paymentInstructions === 'string');
}

/** Private token page, deliberately outside the public site shell and staff sign-in. */
export default function PaymentRequestPage() {
  return <CustomerDocumentTheme><PaymentRequestContent /></CustomerDocumentTheme>;
}
export function PaymentRequestContent() {
  const [, params] = useRoute<{ token: string }>('/payment-request/:token');
  const token = params?.token ?? '';
  const [view, setView] = useState<PublicPaymentRequest>();
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [confirmPayment, setConfirmPayment] = useState(false), [attempt, setAttempt] = useState(0);
  const currentToken = useRef(token), inFlight = useRef(false); currentToken.current = token;
  useEffect(() => {
    const previousTitle = document.title; document.title = 'Your payment request';
    const robot = document.createElement('meta'); robot.name = 'robots'; robot.content = 'noindex, nofollow'; document.head.appendChild(robot);
    const referrer = document.createElement('meta'); referrer.name = 'referrer'; referrer.content = 'no-referrer'; document.head.appendChild(referrer);
    return () => { document.title = previousTitle; robot.remove(); referrer.remove(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setView(undefined); setLoading(true); setError(''); setActionError(''); setNotice(''); setConfirmPayment(false); setBusy(false); inFlight.current = false;
    if (!/^[a-f0-9]{64}$/.test(token)) { setError('This link is incomplete. Ask the dealership for a new payment link.'); setLoading(false); return () => controller.abort(); }
    void fetch(`/api/payment-requests/${encodeURIComponent(token)}`, { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'This payment link is unavailable. Contact the dealership for a new one.'); if (!validView(data)) throw new Error('The payment details could not be confirmed. Contact the dealership before paying.'); return data; })
      .then(data => { if (!controller.signal.aborted) setView(data); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'The payment request could not be loaded.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, attempt]);
  async function action(kind: 'report-payment' | 'request-invoice') {
    if (inFlight.current || !view) return;
    const forToken = token; inFlight.current = true; setBusy(true); setActionError(''); setNotice('');
    try {
      const response = await fetch(`/api/payment-requests/${encodeURIComponent(token)}/${kind}`, { method: 'POST', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true }) });
      const result = await response.json();
      if (!response.ok || result.recorded !== true) throw new Error(result.error || 'The dealership could not confirm your update. Please try again or contact them.');
      if (currentToken.current !== forToken) return;
      setView(current => current ? { ...current, [kind === 'report-payment' ? 'paymentReportedAt' : 'invoiceRequestedAt']: new Date().toISOString() } : current);
      setConfirmPayment(false);
      setNotice(kind === 'report-payment' ? 'The dealership has your update. They will check the payment before confirming receipt.' : 'Your invoice request has been saved for the dealership.');
    } catch (cause) { if (currentToken.current === forToken) setActionError(cause instanceof Error ? cause.message : 'Your update could not be saved.'); }
    finally { if (currentToken.current === forToken) { inFlight.current = false; setBusy(false); } }
  }
  return <main className="customer-payment-page">
    <div className="customer-payment-shell">
      {loading ? <section className="customer-payment-card"><Wallet size={28}/><h1>Opening your payment request</h1><p role="status">Checking the saved details…</p></section> : !view ? <section className="customer-payment-card"><ShieldCheck size={28}/><h1>This payment link is unavailable</h1><p role="alert">{error}</p><Button onClick={() => setAttempt(attempt + 1)}>Try again</Button><a className="customer-payment-home" href="/contact">Contact the dealership</a></section> : <>
        <header className="customer-payment-header"><strong>{view.dealer.name}</strong><span><ShieldCheck size={15}/>Private payment request</span></header>
        <section className="customer-payment-card customer-payment-intro"><div className="customer-payment-kind"><Wallet size={20}/>{view.kind === 'deposit' ? 'Deposit request' : view.kind === 'balance' ? 'Remaining balance' : 'Payment request'}</div><h1>{view.amountDuePence === 0 ? 'This request is settled' : `${money(view.amountDuePence)} to pay`}</h1><p>{view.amountDuePence === 0 ? 'The dealership has recorded enough payment to cover this request.' : `Hi ${view.customer}, please arrange payment by ${date(view.dueDate)}.`}</p>
          <div className="customer-payment-car"><Car size={25}/><div><strong>{view.vehicle}</strong>{view.registration && <UKNumberPlate value={view.registration} size="sm" variant="front"/>}</div></div>
          <dl className="customer-payment-totals"><div><dt>Request reference</dt><dd>{view.reference}</dd></div><div><dt>Originally requested</dt><dd>{money(view.amountPence)}</dd></div><div><dt>Remaining on this request</dt><dd>{money(view.amountDuePence)}</dd></div></dl>
          {view.note && <p className="customer-payment-note">{view.note}</p>}
        </section>
        {notice && <p className="customer-payment-notice" role="status"><CheckCircle2 size={19}/>{notice}</p>}
        {actionError && <p className="customer-payment-error" role="alert">{actionError}</p>}
        {view.amountDuePence > 0 && <section className="customer-payment-card"><h2>How to pay</h2>{view.paymentInstructions.trim() ? <p className="customer-payment-instructions">{view.paymentInstructions}</p> : <p>Contact {view.dealer.name} for their payment details before sending any money.</p>}<p className="customer-payment-reference">Use payment reference <strong>{view.saleReference}</strong></p>
          {view.paymentReportedAt ? <p className="customer-payment-pending"><CheckCircle2 size={18}/>You have told the dealership you paid. They still need to check the funds.</p> : confirmPayment ? <div className="customer-payment-confirm"><h3>Have you already sent the payment?</h3><p>This tells the dealership to check for it. It does not make a payment or confirm a receipt.</p><div><Button disabled={busy} onClick={() => void action('report-payment')}>{busy ? 'Saving your update…' : 'Yes, tell the dealership'}</Button><Button variant="outline" disabled={busy} onClick={() => setConfirmPayment(false)}>Go back</Button></div></div> : <Button disabled={busy} onClick={() => { setConfirmPayment(true); setActionError(''); }}>I have sent the payment</Button>}
        </section>}
        <section className="customer-payment-card"><h2><FileText size={20}/>Your documents</h2><div className="customer-payment-documents"><Button asChild variant="outline"><a href={`/api/payment-requests/${encodeURIComponent(token)}/pdf`} referrerPolicy="no-referrer" download><Download size={16}/>Download payment request</a></Button>{view.invoiceAvailable ? <Button asChild variant="outline"><a href={`/api/payment-requests/${encodeURIComponent(token)}/invoice`} referrerPolicy="no-referrer" download><Download size={16}/>Download invoice</a></Button> : view.invoiceRequestedAt ? <p>Your invoice request is with the dealership.</p> : <Button variant="outline" disabled={busy} onClick={() => void action('request-invoice')}>{busy ? 'Saving…' : 'Request my invoice'}</Button>}</div><p className="customer-payment-small">A payment request is not a receipt or a sales invoice.</p></section>
        <footer className="customer-payment-contact"><strong>Need a hand?</strong><span>Contact {view.dealer.name}</span><div>{view.dealer.phone && <a href={`tel:${view.dealer.phone}`}><Phone size={16}/>{view.dealer.phone}</a>}{view.dealer.email && <a href={`mailto:${view.dealer.email}`}><Mail size={16}/>{view.dealer.email}</a>}</div></footer>
      </>}
    </div>
  </main>;
}
