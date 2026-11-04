import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createSaleWorkspace, requestSalePayment, saleWorkspaceTotals, type SaleWorkspaceRecord, type SalePaymentRequest } from '@workspace/vehicle-meta';
import { SalePaymentRequests } from './sale-payment-requests';
import { dealerConfig } from '@/config/dealer';
const state = vi.hoisted(() => ({ api: vi.fn(), pdf: vi.fn(), emailEnabled: true }));
vi.mock('@workspace/api-client-react', () => ({ customFetch: (...args: unknown[]) => state.api(...args), HttpApiError: class extends Error {} }));
vi.mock('@/lib/dealer-features', () => ({ useDealerFeatures: () => ({ enabled: () => state.emailEnabled }) }));
vi.mock('@/lib/dealer-settings-context', () => ({ useDealerSettings: () => ({ settings: dealerConfig }) }));
vi.mock('@workspace/vehicle-meta/sale-document-pdf', () => ({ saleDocumentPdfBytes: (...args: unknown[]) => state.pdf(...args) }));
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({ default: '/assets/pdf.worker.mjs' }));
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn(() => ({ destroy:vi.fn(), promise:Promise.resolve({numPages:1,getPage:async()=>({getViewport:()=>({width:595,height:842}),render:()=>({promise:Promise.resolve(),cancel:vi.fn()})})}) })) }));
const branding = { identity: { name: 'Fictional Motors', logoText: 'TEST', logoAsset: '' }, contact: { phone: '', email: '' }, address: { street: '', city: '', region: '', postcode: '' }, legal: { companyName: '', companyNumber: '', vatNumber: '' } };
let serial = 0;
const context = () => ({ now: new Date().toISOString(), actor: 'Staff', nextId: () => `item-${++serial}`, nextNumber: () => `PAY-${++serial}`, branding });
function fixture() { return createSaleWorkspace({ requestId: 'create-sale', draft: { customer: 'Jamie Patel', email: 'jamie@example.test', phone: '07700900123', vehicle: 'Ford Focus', vehicleId: 'car-1', registration: 'AB20XYZ', price: '10000' } }, context(), 'SALE-1042').sale; }
function withRequest(sale = fixture()) {
  return requestSalePayment(sale, { kind: 'deposit', amount: '500', dueDate: '2026-12-01', note: '', tokenHash: 'hash', expiresAt: '2099-01-01T00:00:00Z' }, context());
}
beforeEach(() => { serial = 0; state.emailEnabled = true; state.api.mockReset(); state.pdf.mockReset().mockReturnValue(new TextEncoder().encode('%PDF-test')); vi.stubGlobal('Blob',NodeBlob); Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(()=>'blob:test-request')});Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()});vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({} as CanvasRenderingContext2D); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('creates the agreed request without sending email or recording received money', async () => {
  const sale = fixture(), mutation = withRequest(sale), onSaved = vi.fn();
  state.api.mockResolvedValue({ sale: mutation.sale, requestId: mutation.request.id, url: `https://dealer.example/payment-request/${'a'.repeat(64)}` });
  render(<SalePaymentRequests sale={sale} onSaved={onSaved}/>);
  fireEvent.click(screen.getByRole('button', { name: 'New request' }));
  fireEvent.change(screen.getByLabelText('Amount (£)'), { target: { value: '500' } });
  fireEvent.click(screen.getByRole('button', { name: 'Request £500.00' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(mutation.sale));
  expect(state.api).toHaveBeenCalledOnce();
  const [url, options] = state.api.mock.calls[0];
  expect(url).toBe(`/api/sale-operations/${sale.id}/request-payment`);
  expect(JSON.parse(options.body)).toMatchObject({ expectedRevision: sale.revision, kind: 'deposit', amount: '500', note: '' });
  expect(mutation.sale.payments).toHaveLength(0); expect(mutation.sale.lifecycle).toBeUndefined();
});

it('shows the remaining request amount after staff record a partial payment', () => {
  const mutation = withRequest(), sale = structuredClone(mutation.sale);
  sale.payments.push({ id: 'payment-1', amount: '200', amountPence: 20000, signedAmountPence: 20000, kind: 'part-payment', status: 'confirmed', method: 'Bank transfer', date: '2026-11-03', reference: '', recordedAt: new Date().toISOString(), recordedBy: 'Staff' });
  render(<SalePaymentRequests sale={sale} onSaved={vi.fn()}/>);
  expect(screen.getByText('Still to pay:').parentElement).toHaveTextContent('£300.00');
  expect(screen.queryByRole('button', { name: 'New request' })).not.toBeInTheDocument(); expect(state.api).not.toHaveBeenCalled();
});

it('requires confirmation before invalidating an existing private link', async () => {
  const mutation = withRequest(), onSaved = vi.fn();
  state.api.mockResolvedValue({ sale: mutation.sale, requestId: mutation.request.id, url: `https://dealer.example/payment-request/${'b'.repeat(64)}` });
  render(<SalePaymentRequests sale={mutation.sale} onSaved={onSaved}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Create new link' }));
  const dialog = screen.getByRole('dialog', { name: 'Create a new private link?' });
  expect(dialog).toHaveTextContent('previously shared link'); expect(state.api).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Create new link' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(JSON.parse(state.api.mock.calls[0][1].body)).toMatchObject({ paymentRequestId: mutation.request.id, expectedRevision: mutation.sale.revision });
  expect(screen.getByLabelText('Private customer link')).toHaveValue(`https://dealer.example/payment-request/${'b'.repeat(64)}`);
  expect(screen.getByRole('link', { name: 'Open WhatsApp' })).toHaveAttribute('href', expect.stringContaining('wa.me/447700900123'));
});

it('cancels a request only after confirmation without deleting its record', async () => {
  const mutation = withRequest(), saved = structuredClone(mutation.sale); saved.paymentRequests![0].status = 'cancelled';
  state.api.mockResolvedValue({ sale: saved }); const onSaved = vi.fn();
  render(<SalePaymentRequests sale={mutation.sale} onSaved={onSaved}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel request' })); expect(state.api).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel payment request' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
  expect(state.api.mock.calls[0][0]).toMatch(/\/cancel-request$/); expect(saved.paymentRequests).toHaveLength(1); expect(saved.payments).toHaveLength(0);
});

it('reviews the recipient before an email send and reports the server delivery state', async () => {
  const mutation = withRequest(), saved = structuredClone(mutation.sale);
  saved.emailDeliveries = [{ id: 'mail-1', documentId: mutation.request.documentId, to: saved.draft.email, status: 'prepared', attemptedAt: new Date().toISOString() }];
  state.api.mockResolvedValue({ sale: saved });
  render(<SalePaymentRequests sale={mutation.sale} onSaved={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Email PDF' }));
  const dialog = screen.getByRole('dialog', { name: 'Email this payment request?' }); expect(dialog).toHaveTextContent('jamie@example.test'); expect(state.api).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Send payment request email' }));
  expect(await screen.findByRole('status')).toHaveTextContent('prepared but has not been sent');
  expect(state.api.mock.calls[0][0]).toBe(`/api/sale-workspace/${saved.id}/documents/${mutation.request.documentId}/email`);
});

it('keeps email unavailable when platform sending is disabled', () => {
  state.emailEnabled = false; const mutation = withRequest();
  render(<SalePaymentRequests sale={mutation.sale} onSaved={vi.fn()}/>);
  expect(screen.getByRole('button', { name: 'Email PDF' })).toBeDisabled(); expect(state.api).not.toHaveBeenCalled();
});

it('retains the same request identity on an uncertain creation retry', async () => {
  const sale = fixture(); state.api.mockRejectedValue(new Error('Connection lost'));
  render(<SalePaymentRequests sale={sale} onSaved={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button', { name: 'New request' })); fireEvent.change(screen.getByLabelText('Amount (£)'), { target: { value: '500' } });
  fireEvent.click(screen.getByRole('button', { name: 'Request £500.00' })); await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Request £500.00' })); await waitFor(() => expect(state.api).toHaveBeenCalledTimes(2));
  expect(JSON.parse(state.api.mock.calls[0][1].body).requestId).toBe(JSON.parse(state.api.mock.calls[1][1].body).requestId);
});

it('reports unsaved edits and in-flight saves, then clears both when saved', async () => {
  const sale=fixture(),mutation=withRequest(sale),dirty=vi.fn(),busy=vi.fn();
  let resolve!: (value:unknown)=>void; state.api.mockImplementation(()=>new Promise(done=>{resolve=done;}));
  render(<SalePaymentRequests sale={sale} actionOnly onSaved={vi.fn()} onDirtyChange={dirty} onBusyChange={busy}/>);
  expect(dirty).toHaveBeenLastCalledWith(false);expect(busy).toHaveBeenLastCalledWith(false);
  fireEvent.change(screen.getByLabelText('Amount (£)'),{target:{value:'500'}});
  expect(dirty).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole('button',{name:'Request £500.00'}));
  expect(busy).toHaveBeenLastCalledWith(true);
  expect(state.pdf).not.toHaveBeenCalled(); expect(state.api).toHaveBeenCalledOnce();
  await act(async()=>{resolve({sale:mutation.sale});});
  expect(busy).toHaveBeenLastCalledWith(false);expect(dirty).toHaveBeenLastCalledWith(false);
});

it.each(['create','email'] as const)('discards a late %s response after switching deals',async(action)=>{
  const mutation=withRequest(),first=action==='email'?mutation.sale:fixture(),next=fixture();next.id='another-sale';next.draft.customer='Different buyer';
  const saved=vi.fn();let resolve!:(value:unknown)=>void;state.api.mockImplementation(()=>new Promise(done=>{resolve=done;}));
  const view=render(<SalePaymentRequests sale={first} actionOnly onSaved={saved}/>);
  if(action==='create') {fireEvent.change(screen.getByLabelText('Amount (£)'),{target:{value:'500'}});fireEvent.click(screen.getByRole('button',{name:'Request £500.00'}));}
  else {fireEvent.click(screen.getByRole('button',{name:'Email PDF'}));fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Send payment request email'}));}
  const signal=state.api.mock.calls[0][1].signal as AbortSignal;
  view.rerender(<SalePaymentRequests sale={next} actionOnly onSaved={saved}/>);
  expect(signal.aborted).toBe(true);
  await act(async()=>{resolve({sale:{...first,emailDeliveries:[{documentId:mutation.request.documentId,status:'sent',to:first.draft.email}]},url:`https://dealer.example/payment-request/${'c'.repeat(64)}`,requestId:mutation.request.id});});
  expect(saved).not.toHaveBeenCalled();expect(screen.getByLabelText('Amount (£)')).toHaveValue('');
  expect(screen.queryByText(/Payment request saved|Payment request emailed/)).not.toBeInTheDocument();expect(screen.queryByLabelText('Private customer link')).not.toBeInTheDocument();
});

it('aborts a saved PDF download on unmount without opening a late document',async()=>{
  const mutation=withRequest();let resolve!:(value:unknown)=>void;state.api.mockImplementation(()=>new Promise(done=>{resolve=done;}));
  const busy=vi.fn(),view=render(<SalePaymentRequests sale={mutation.sale} onSaved={vi.fn()} onBusyChange={busy}/>);
  fireEvent.click(screen.getByRole('button',{name:'PDF'}));const signal=state.api.mock.calls[0][1].signal as AbortSignal;view.unmount();
  expect(signal.aborted).toBe(true);expect(busy).toHaveBeenLastCalledWith(false);
  await act(async()=>{resolve(new NodeBlob(['%PDF-test'],{type:'application/pdf'}));});
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

it('returns to the new-request form after cancelling an action-only request',async()=>{
  const mutation=withRequest(),saved=structuredClone(mutation.sale);saved.revision++;saved.paymentRequests![0].status='cancelled';
  const onSaved=vi.fn();state.api.mockResolvedValue({sale:saved});
  const view=render(<SalePaymentRequests sale={mutation.sale} actionOnly onSaved={onSaved}/>);
  fireEvent.click(screen.getByRole('button',{name:'Cancel request'}));fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Cancel payment request'}));
  await waitFor(()=>expect(onSaved).toHaveBeenCalledWith(saved));view.rerender(<SalePaymentRequests sale={saved} actionOnly onSaved={onSaved}/>);
  expect(screen.getByLabelText('Amount (£)')).toHaveValue('');expect(screen.getByRole('button',{name:'Request payment'})).toBeDisabled();expect(screen.getByText('Cancelled')).toBeInTheDocument();
});

it('requires valid penny amounts and starts with the phone preview folded',()=>{
  const original=window.innerWidth;Object.defineProperty(window,'innerWidth',{configurable:true,value:390});
  const view=render(<SalePaymentRequests sale={fixture()} actionOnly onSaved={vi.fn()}/>);
  expect(screen.getByText('View document').closest('details')).not.toHaveAttribute('open');
  for(const value of ['0.001','1e3','90071992547409.92']) {fireEvent.change(screen.getByLabelText('Amount (£)'),{target:{value}});expect(screen.getByRole('button',{name:'Request payment'})).toBeDisabled();}
  fireEvent.change(screen.getByLabelText('Amount (£)'),{target:{value:'250.01'}});expect(screen.getByRole('button',{name:'Request £250.01'})).toBeEnabled();
  expect(state.api).not.toHaveBeenCalled();expect(state.pdf).not.toHaveBeenCalled();view.unmount();Object.defineProperty(window,'innerWidth',{configurable:true,value:original});
});

it('creates PDF and optional calculation checks only on Preview, clearing old advice when amounts change',async()=>{
  const sale=fixture();let current=sale;
  state.api.mockImplementation(async(url:string)=>{if(!url.endsWith('/calculation-check'))throw new Error('Unexpected request');return {status:'checked',message:'The total and balance add up.',financialKey:String(current.revision),totals:saleWorkspaceTotals(current.draft,current.payments),checkedAt:new Date().toISOString(),cached:false};});
  const view=render(<SalePaymentRequests sale={sale} actionOnly onSaved={vi.fn()}/>);
  fireEvent.change(screen.getByLabelText('Amount (£)'),{target:{value:'500'}});
  expect(state.api).not.toHaveBeenCalled();expect(state.pdf).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Preview PDF'}));
  await waitFor(()=>expect(state.pdf).toHaveBeenCalledOnce());await screen.findByText('The total and balance add up.');expect(state.api).toHaveBeenCalledOnce();
  await waitFor(()=>expect(screen.getByRole('button',{name:'Preview PDF'})).toBeEnabled());
  fireEvent.change(screen.getByLabelText('Amount (£)'),{target:{value:'250'}});
  expect(screen.queryByText('The total and balance add up.')).not.toBeInTheDocument();expect(state.pdf).toHaveBeenCalledOnce();expect(state.api).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button',{name:'Preview PDF'}));await waitFor(()=>expect(state.pdf).toHaveBeenCalledTimes(2));expect(state.api).toHaveBeenCalledOnce();
  current=structuredClone(sale);current.revision++;current.payments=[{id:'new-payment',amount:'100',amountPence:10000,signedAmountPence:10000,kind:'part-payment',status:'confirmed',method:'Cash',date:'2026-11-04',reference:'',recordedBy:'Staff',recordedAt:new Date().toISOString()}];
  view.rerender(<SalePaymentRequests sale={current} actionOnly onSaved={vi.fn()}/>);
  expect(screen.queryByText('The total and balance add up.')).not.toBeInTheDocument();expect(state.api).toHaveBeenCalledOnce();expect(state.pdf).toHaveBeenCalledTimes(2);
  await waitFor(()=>expect(screen.getByRole('button',{name:'Preview PDF'})).toBeEnabled());fireEvent.click(screen.getByRole('button',{name:'Preview PDF'}));
  await waitFor(()=>expect(state.pdf).toHaveBeenCalledTimes(3));expect(state.api).toHaveBeenCalledTimes(2);
  expect(state.pdf.mock.calls.at(-1)?.[0].snapshot.totals.balance).toBe(990000);
});
