import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { changeSaleWorkspace, createSaleWorkspace, type SaleWorkspaceRecord, type SaleWorkspaceCommand } from '@workspace/vehicle-meta';

const state = vi.hoisted(() => ({
  api: vi.fn(), pdf: vi.fn(), permissions: ['sales.manage', 'payments.record'], search: '',
  sale: null as SaleWorkspaceRecord | null,
  car: { id: 'car-1', title: 'Ford Focus', make: 'Ford', model: 'Focus', registration: 'AB20XYZ', price: 10000, inventoryStatus: 'available', images: [], heroImage: null },
}));
vi.mock('@workspace/api-client-react', () => ({ customFetch: (...args: unknown[]) => {
    const url = String(args[0]);
    if (url === '/api/sales-terms') return Promise.resolve({ published: null });
    if (url.startsWith('/api/sales-terms/sales/')) return Promise.resolve({ documents: [] });
    if (url.includes('/delivery-evidence')) return Promise.resolve({ jobs: [] });
    return state.api(...args);
  }, HttpApiError: class extends Error {}, getGetStockQueryKey: () => ['stock'] }));
vi.mock('@/lib/stock-context', () => ({ useStock: () => ({ stock: { cars: [state.car] }, isLoading: false, error: null }) }));
vi.mock('@/lib/dealer-settings-context', () => ({ useDealerSettings: () => ({ settings: { identity: { name: 'Fictional Motors' }, contact: {}, address: {}, legal: {} } }) }));
vi.mock('@/lib/dealer-features', () => ({ useDealerFeatures: () => ({ enabled: () => true, isLoading: false, isError: false }) }));
vi.mock('@/lib/enquiry-summary-query', () => ({ useEnquirySummaries: () => ({ data: [], isLoading: false, isError: false }) }));
vi.mock('@/components/portal/dealer-administration', () => ({ useStaffAccess: () => ({ data: { permissions: state.permissions } }) }));
vi.mock('@/components/portal/sale-handover', () => ({ SaleHandover: () => <section aria-label="Collection and delivery">Saved handover arrangements</section>, SaleHandoverFields: () => <p>Handover arrangements</p>, handoverDefaults: () => ({}) }));
vi.mock('@/components/portal/sold-vehicle-customer-review', () => ({ SoldVehicleCustomerReview: () => null }));
vi.mock('@/components/sales-demo/sales-document', () => ({ openSaleDocumentPdf: (...args: unknown[]) => state.pdf(...args) }));
vi.mock('wouter', () => ({ useLocation: () => ['/portal', vi.fn()], useSearch: () => state.search }));

import { SalesWorkspace } from '@/pages/sales-demo';
const branding = { identity: { name: 'Fictional Motors', logoText: 'TEST', logoAsset: '' }, contact: { phone: '', email: '' }, address: { street: '', city: '', region: '', postcode: '' }, legal: { companyName: '', companyNumber: '', vatNumber: '' } };
let serial = 0;
const context = () => ({ now: new Date().toISOString(), actor: 'Staff', nextId: () => `item-${++serial}`, nextNumber: () => `INV-${++serial}`, branding });
function savedSale() {
  return createSaleWorkspace({ requestId: 'create-fixture', draft: { vehicleId: 'car-1', vehicle: 'Ford Focus', registration: 'AB20XYZ', price: '10000', customer: 'Jamie Patel', email: 'jamie@example.test', phone: '07700900123', address: '10 Example Road' } }, context(), 'SALE-1').sale;
}
function mount(existing = true, quickActions?: React.ReactNode) {
  if (existing) { state.sale ??= savedSale(); state.search = `?section=sales&saleId=${state.sale.id}`; }
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SalesWorkspace embedded quickActions={quickActions} /></QueryClientProvider>);
}
const writes = () => state.api.mock.calls.filter(([, options]) => options?.method);
beforeEach(() => {
  serial = 0; state.sale = null; state.search = ''; state.permissions = ['sales.manage', 'payments.record']; state.pdf.mockReset();
  state.api.mockReset().mockImplementation(async (url: string, options?: { method?: string; body?: string }) => {
    if (!options?.method) {
      if (url === '/api/sales-terms') return { published: null };
      if (url.startsWith('/api/sales-terms/sales/')) return { documents: [] };
      if (url.includes('/delivery-evidence')) return { jobs: [] };
      if (url === '/api/sale-workspace') return { sales: state.sale ? [state.sale] : [], hasMore: false };
      if (/\/api\/sale-workspace\/[^/]+$/.test(url)) return { sale: state.sale };
      return { sales: [], hasMore: false };
    }
    const body = JSON.parse(options.body!);
    if (url === '/api/sale-workspace') { const result = createSaleWorkspace(body, context(), 'SALE-NEW'); state.sale = result.sale; return result; }
    const command = options.method === 'PUT' ? { action: 'update', draft: body.draft }
      : url.endsWith('/invoice-payments') ? { action: 'invoice-payment', payment: body.payment }
      : url.endsWith('/issue-invoice') ? { action: 'issue-invoice', kind: body.kind, acknowledge: body.acknowledge }
      : { action: 'lifecycle', status: body.status };
    const result = changeSaleWorkspace(state.sale!, command as SaleWorkspaceCommand, body, context()); state.sale = result.sale; return result;
  });
});

it('opens the four-section desk and keeps unsaved contact edits across sections', async () => {
  mount(); await screen.findByRole('heading', { name: 'Deal details' });
  expect(screen.getAllByRole('tab')).toHaveLength(4);
  expect(screen.queryByRole('navigation', { name: 'Invoice steps' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Telephone'), { target: { value: '07700900456' } });
  fireEvent.click(screen.getByRole('tab', { name: 'Collection & delivery' }));
  expect(screen.getByRole('heading', { name: 'Collection & delivery' })).toBeVisible();
  fireEvent.click(screen.getByRole('tab', { name: 'Deal' }));
  expect(screen.getByLabelText('Telephone')).toHaveValue('07700900456');
  expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes');
  expect(writes()).toHaveLength(0);
});

it('preserves an unsaved payment and blocks invoice creation until it is recorded or cleared', async () => {
  mount(); await screen.findByRole('heading', { name: 'Deal details' });
  fireEvent.click(screen.getByRole('tab', { name: 'Payments' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add received payment' }));
  fireEvent.change(screen.getByLabelText('Payment amount (£)'), { target: { value: '500' } });
  fireEvent.click(screen.getByRole('tab', { name: 'Invoices' }));
  expect(screen.getByRole('button', { name: 'Create & save invoice' })).toBeDisabled();
  expect(screen.getByText('Save or clear the payment entry in Payments before creating an invoice.')).toBeVisible();
  fireEvent.click(screen.getByRole('tab', { name: 'Payments' }));
  expect(screen.getByLabelText('Payment amount (£)')).toHaveValue('500');
  expect(writes()).toHaveLength(0);
});

it('requires received-money confirmation and updates the shared balance using exact pence', async () => {
  mount(); await screen.findByRole('heading', { name: 'Deal details' });
  fireEvent.click(screen.getByRole('tab', { name: 'Payments' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add received payment' }));
  fireEvent.change(screen.getByLabelText('Payment amount (£)'), { target: { value: '500.25' } });
  expect(screen.getByRole('button', { name: 'Save payment' })).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: /I have checked that this money/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Save payment' }));
  await waitFor(() => expect(state.sale!.payments).toHaveLength(1));
  const summary = screen.getByRole('complementary', { name: 'Deal summary' });
  await waitFor(() => expect(summary).toHaveTextContent('£9,499.75'));
  expect(state.sale!.payments[0].amountPence).toBe(50025);
  expect(writes()).toHaveLength(1);
});

it('opens saved paperwork without issuing a duplicate or rewriting the original snapshot', async () => {
  state.sale = savedSale();
  state.sale = changeSaleWorkspace(state.sale, { action: 'issue-invoice', kind: 'full', acknowledge: true }, { expectedRevision: state.sale.revision, requestId: 'issue-fixture' }, context()).sale;
  const frozen = structuredClone(state.sale.documents);
  mount(); await screen.findByRole('heading', { name: 'Deal details' });
  fireEvent.click(screen.getByRole('tab', { name: 'Invoices' }));
  fireEvent.click(screen.getByRole('button', { name: 'View & share' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open & print invoice' }));
  await waitFor(() => expect(state.pdf).toHaveBeenCalledOnce());
  expect(state.sale.documents).toEqual(frozen);
  expect(writes()).toHaveLength(0);
});

it('keeps Accounts payment access while protecting customer and vehicle edits', async () => {
  state.permissions = ['payments.record', 'payments.refund'];
  mount(); await screen.findByRole('heading', { name: 'Deal details' });
  expect(screen.getByLabelText('Customer’s full name')).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Save details' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: 'Payments' }));
  expect(screen.getByRole('button', { name: 'Add received payment' })).toBeEnabled();
  fireEvent.click(screen.getByRole('tab', { name: 'Invoices' }));
  expect(screen.getByRole('button', { name: 'Create invoice' })).toBeEnabled();
  expect(writes()).toHaveLength(0);
});

it('keeps quick actions available inside the full-screen sale without clearing the deal', async () => {
  const quick = vi.fn(); mount(true, <button onClick={quick}>Quick actions</button>);
  await screen.findByRole('heading', { name: 'Deal details' });
  fireEvent.change(screen.getByLabelText('Telephone'), { target: { value: '07700900789' } });
  fireEvent.click(screen.getByRole('button', { name: 'Quick actions' }));
  expect(quick).toHaveBeenCalledOnce();
  expect(screen.getByLabelText('Telephone')).toHaveValue('07700900789');
  expect(writes()).toHaveLength(0);
});

it('shows transferred credit separately from cash received and the delivery charge', async () => {
  state.sale = savedSale();
  state.sale.draft.deliveryCharge = '200';
  state.sale.draft.adjustments = [{ kind: 'fee', description: 'Agreed extra', amount: '50' }];
  state.sale.draft.creditEntries = [{ id: 'transfer-1', sourceSaleId: 'previous-sale', reference: 'SALE-OLD', signedAmountPence: 100000, at: '2026-11-03T10:00:00Z' }];
  mount(); await screen.findByRole('heading', { name: 'Deal details' });
  const summary = screen.getByRole('complementary', { name: 'Deal summary' });
  expect(within(summary).getByText('Received').parentElement).toHaveTextContent('£0.00');
  expect(within(summary).getByText('Credit transferred in').parentElement).toHaveTextContent('£1,000.00');
  expect(within(summary).getByText('Delivery').parentElement).toHaveTextContent('£200.00');
  expect(within(summary).getByText('Extras & discounts').parentElement).toHaveTextContent('£50.00');
  expect(within(summary).getByText('Balance due').parentElement).toHaveTextContent('£9,250.00');
  expect(writes()).toHaveLength(0);
});
