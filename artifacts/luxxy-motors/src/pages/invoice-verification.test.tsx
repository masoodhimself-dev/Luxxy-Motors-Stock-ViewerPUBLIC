import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import InvoiceVerification from './invoice-verification';

const fetchProof = vi.hoisted(() => vi.fn());
const route = vi.hoisted(() => ({ params: { saleId: 'sale-1', documentId: 'doc-1', token: 'private-proof' } as { saleId?: string; documentId?: string; token?: string } | null }));
vi.mock('@workspace/api-client-react', () => ({ customFetch: fetchProof }));
vi.mock('wouter', () => ({ useRoute: () => [Boolean(route.params), route.params], Link: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
const proof = { verified: true, number: 'INV-1', title: 'Sales invoice', issuedAt: '2026-10-17T12:00:00Z', dealer: 'Example Motors', vehicle: 'Ford Focus', registration: 'AB12 CDE', saleTotalPence: 700000, paymentsReceivedPence: 700000, balanceAtIssuePence: 0, paymentCount: 2, supersededBy: null };
const renderProof = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><InvoiceVerification /></QueryClientProvider>);
beforeEach(() => { fetchProof.mockReset(); route.params = { saleId: 'sale-1', documentId: 'doc-1', token: 'private-proof' }; });

describe('invoice proof recovery', () => {
  it.each([null, {}, { saleId: 'sale-1' }, { saleId: 'sale-1', documentId: 'doc-1' }])('explains a truncated verification route without fetching or showing a blank page (%j)', params => {
    route.params = params;
    renderProof();
    expect(screen.getByRole('heading', { name: 'This invoice link is unavailable' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Contact the dealership' })).toHaveAttribute('href', '/contact');
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(fetchProof).not.toHaveBeenCalled();
  });
  it('treats a service outage as temporary and allows a successful retry', async () => {
    fetchProof.mockRejectedValueOnce({ status: 503 }).mockResolvedValueOnce(proof);
    renderProof();
    expect(await screen.findByRole('heading', { name: 'We couldn’t check your invoice' })).toBeInTheDocument();
    expect(screen.queryByText('Invoice not verified')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Invoice record found' })).toBeInTheDocument();
    expect(screen.getByText('Document no.')).toBeInTheDocument();
    expect(screen.getByText('INV-1')).toBeInTheDocument();
    expect(screen.queryByText('Reference')).not.toBeInTheDocument();
    expect(fetchProof).toHaveBeenCalledTimes(2);
  });
  it('explains an unavailable link without offering a pointless retry', async () => {
    fetchProof.mockRejectedValueOnce({ status: 404 });
    renderProof();
    expect(await screen.findByRole('heading', { name: 'This invoice link is unavailable' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Contact the dealership' })).toHaveAttribute('href', '/contact');
  });
  it('offers recovery for a network failure instead of implying an invalid invoice', async () => {
    fetchProof.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    renderProof();
    expect(await screen.findByRole('heading', { name: 'We couldn’t check your invoice' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  });
});
