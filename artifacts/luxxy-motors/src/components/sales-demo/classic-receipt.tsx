import type { SaleWorkspaceBranding, SaleWorkspaceDocument } from '@workspace/vehicle-meta';
import { formatPhoneDisplay } from '@/lib/utils';
import './classic-receipt.css';
const money = (pence: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(pence / 100);
export function ClassicReceipt({ document, branding, blank = false }: { document?: SaleWorkspaceDocument; branding: SaleWorkspaceBranding; blank?: boolean }) {
  const saved = document?.snapshot;
  const payment = saved?.payments.find(p => p.id === document?.paymentId && p.status === 'confirmed');
  const populated = !blank && document?.type === 'receipt' && payment;
  const field = (label: string, value?: string) => <div className="receipt-book-field"><dt>{label}</dt><dd>{populated ? value : ''}</dd></div>;
  const vehicle = saved?.vehicle;
  const facts = [vehicle?.year && String(vehicle.year), vehicle?.fuel, vehicle?.transmission, typeof vehicle?.mileage === 'number' && vehicle.mileage >= 0 ? `${vehicle.mileage.toLocaleString('en-GB')} miles` : '', vehicle?.colour].filter(Boolean);
  const refund = payment && ['refund','reversal'].includes(payment.kind);
  return <article className="sales-document receipt-book" aria-label={blank ? 'Blank classic receipt' : 'Classic payment receipt'}>
    <header><h2>{branding.identity.name || branding.identity.logoText}</h2><p>{[branding.address.street, branding.address.city, branding.address.postcode].filter(Boolean).join(', ')}</p><p>{[formatPhoneDisplay(branding.contact.phone),branding.contact.email].filter(Boolean).join(' · ')}</p></header>
    <h3>{blank ? 'VEHICLE PAYMENT RECEIPT' : document?.title || 'VEHICLE PAYMENT RECEIPT'}</h3>
    <dl>{field('Receipt no.',document?.number)}{field('Date',payment?.date ? new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'Europe/London'}).format(new Date(payment.date)) : '')}</dl>
    <dl className="receipt-book-party">{field(refund ? 'Paid to' : 'Received from',saved?.draft.customer)}{field('Address',saved?.draft.address)}{field('For vehicle',saved?.draft.vehicle)}{field('Registration',saved?.draft.registration)}{field('Sale reference',saved?.draft.id)}</dl>
    <h4>PAYMENT DETAILS</h4><div className="receipt-book-payment-grid"><dl>{field('Payment type',payment?.kind.replaceAll('-',' '))}{field('Payment method',payment?.method)}{field('Payment reference',payment?.reference)}</dl>{populated && facts.length > 0 && <aside className="receipt-book-scribble" aria-label="Handwritten vehicle details"><span>A few car details...</span>{facts.map((fact,index) => <p key={index}>{fact}</p>)}</aside>}</div>
    <table><thead><tr><th>Account at this payment</th><th>Amount (£)</th></tr></thead><tbody>
      <tr><th>Total due after allowances</th><td>{populated ? money(saved!.totals.totalDue) : ''}</td></tr>
      <tr><th>{refund ? 'Amount refunded / reversed' : payment?.kind === 'refund-correction' ? 'Refund correction restored' : 'Payment received today'}</th><td>{populated ? money(payment!.amountPence) : ''}</td></tr>
      <tr className="receipt-book-balance"><th>{document && document.balanceAtIssue < 0 ? 'Customer credit at issue' : 'Balance remaining at issue'}</th><td>{populated ? money(Math.abs(document!.balanceAtIssue)) : ''}</td></tr>
    </tbody></table>
    <dl>{field('Recorded by',document?.issuedBy === 'Local preview staff' ? 'Showroom staff' : document?.issuedBy)}</dl>
    {blank && <div className="receipt-book-signature">Received by / signature <span /> Date <span /></div>}
    <footer><p className="receipt-book-thanks">Thank you for choosing {branding.identity.name || 'our dealership'}.</p>
      <p>{blank ? 'Blank stationery - complete and record the payment in the sales system.' : 'Records the payment above. Pending payments do not reduce the balance.'}</p>
      {!blank && <p>Same saved receipt and reference; this print style does not record another payment.</p>}
      {(branding.legal.companyNumber || branding.legal.vatNumber) && <p>{[branding.legal.companyName,branding.legal.companyNumber && `Company no. ${branding.legal.companyNumber}`,branding.legal.vatNumber && `VAT registration ${branding.legal.vatNumber}`].filter(Boolean).join(' · ')}</p>}
      {!blank && !populated && <p>No confirmed receipt selected. This is not proof of payment.</p>}
    </footer>
  </article>;
}
