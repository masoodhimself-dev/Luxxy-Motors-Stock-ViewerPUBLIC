import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CustomerSale from './customer-sale';

const fetchSale = vi.hoisted(() => vi.fn());
vi.mock('@workspace/api-client-react', () => ({ customFetch: fetchSale }));
vi.mock('@/components/sales-demo/sales-document', () => ({ PdfSalesDocument: () => <div>Saved document</div> }));
vi.mock('wouter', () => ({ useParams: () => ({ token: 'purchase-token' }), Link: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
const sale = {
  reference: 'SALE-1', customer: 'Alex Buyer', vehicle: 'Ford Focus', registration: 'AB12 CDE', status: 'sold',
  totals: { balance: 0, totalDue: 700000, confirmedPaid: 700000, pending: 0 },
  payments: [], documents: [], expiresAt: '2026-11-17T12:00:00Z',
  dealer: { identity: { name: 'Example Motors' }, contact: { phone: '', email: '' } },
};
const renderSale = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CustomerSale /></QueryClientProvider>);
beforeEach(() => { fetchSale.mockReset(); });

describe('private purchase summary', () => {
  it('marks zero balance paid in full and omits an empty collection panel', async () => {
    fetchSale.mockResolvedValue({ sale });
    renderSale();
    expect(await screen.findByText('Paid in full')).toBeInTheDocument();
    expect(screen.queryByText('Outstanding balance')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Collection' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your purchase, Alex Buyer' })).toBeInTheDocument();
    expect(screen.queryByText(/SALE-1/)).not.toBeInTheDocument();
  });
  it('chooses the newest invoice by issue date and offers a direct download', async () => {
    fetchSale.mockResolvedValueOnce({ sale: { ...sale, documents: [
      { id: 'new', type: 'invoice', number: 'INV-2', title: 'Full invoice', issuedAt: '2026-10-17T12:00:00Z' },
      { id: 'other', type: 'receipt', number: 'REC-3', title: 'Payment receipt', issuedAt: '2026-10-18T12:00:00Z' },
      { id: 'old', type: 'invoice', number: 'INV-1', title: 'Deposit invoice', issuedAt: '2026-10-16T12:00:00Z' },
    ] } }).mockRejectedValueOnce(new Error('Download failed'));
    renderSale();
    const latest = await screen.findByRole('region', { name: 'Latest invoice' });
    expect(within(latest).getByRole('heading', { name: 'Full invoice' })).toBeInTheDocument();
    expect(screen.getAllByText(/INV-2/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/SALE-1/)).not.toBeInTheDocument();
    fireEvent.click(within(latest).getByRole('button', { name: 'Download invoice' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The saved PDF could not be downloaded');
    expect(fetchSale).toHaveBeenLastCalledWith('/api/customer-sale/purchase-token/documents/new/pdf', { responseType: 'blob' });
  });
  it('retains an outstanding balance and genuine collection arrangements', async () => {
    fetchSale.mockResolvedValue({ sale: { ...sale, totals: { ...sale.totals, balance: 50000 }, fulfilment: { method: 'collection', scheduledDate: '2026-10-20', timeWindow: '10:00–11:00' } } });
    renderSale();
    expect(await screen.findByText('Outstanding balance')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Collection' })).toBeInTheDocument();
    expect(screen.getByText(/20 October 2026/)).toBeInTheDocument();
  });
});

it('does not present an unsuccessful delivery as an upcoming confirmed visit',async()=>{
 fetchSale.mockResolvedValue({sale:{...sale,fulfilment:{method:'delivery',stage:'unsuccessful',scheduledDate:'2026-10-20',timeWindow:'10:00–11:00',address:'Confirmed address'}}});renderSale();expect(await screen.findByText(/Delivery needs rearranging/)).toBeVisible();expect(screen.queryByText(/20 October 2026/)).not.toBeInTheDocument();
});
it('shows delivery in progress separately from the paid-in-full status',async()=>{
 fetchSale.mockResolvedValue({sale:{...sale,fulfilment:{method:'delivery',stage:'on_way',scheduledDate:'2026-10-20',address:'Confirmed address'}}});renderSale();expect(await screen.findByText(/Your car is on its way/)).toBeVisible();expect(screen.getByText('Paid in full')).toBeVisible();
});
