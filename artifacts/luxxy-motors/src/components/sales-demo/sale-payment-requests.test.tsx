import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { changeSaleWorkspace, createSaleWorkspace, requestSalePayment, saleWorkspaceTotals, type SaleWorkspaceRecord, type SalePaymentRequest } from '@workspace/vehicle-meta';
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

it('opens WhatsApp without a payment link, and marks sharing only after staff confirmation', async () => {
  const mutation=withRequest(), saved=structuredClone(mutation.sale), onSaved=vi.fn(), onRecordDeposit=vi.fn();
  saved.revision++; saved.paymentRequests![0].sharedAt=new Date().toISOString(); saved.paymentRequests![0].sharedBy='Staff';
  state.api.mockResolvedValue({sale:saved});
  const view=render(<SalePaymentRequests sale={mutation.sale} onSaved={onSaved} onRecordDeposit={onRecordDeposit}/>);
  const whatsapp=screen.getByRole('link',{name:'Open WhatsApp'});
  expect(whatsapp).toHaveAttribute('href',expect.stringContaining('wa.me/447700900123'));
  const message=new URL(whatsapp.getAttribute('href')!).searchParams.get('text');
  expect(message).toContain('vehicle price is £10,000.00');expect(message).toContain('request is £500.00');expect(message).not.toContain('payment-request/');
  fireEvent.click(whatsapp);expect(state.api).not.toHaveBeenCalled();
  expect(screen.getByText('Attach the downloaded PDF in WhatsApp.')).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:'Record deposit'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Mark WhatsApp as sent'}));
  const dialog=screen.getByRole('dialog',{name:'Have you sent the request?'});expect(state.api).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button',{name:'Yes, mark as sent'}));
  await waitFor(()=>expect(onSaved).toHaveBeenCalledWith(saved));
  expect(state.api.mock.calls[0][0]).toMatch(/\/mark-request-shared$/);
  expect(JSON.parse(state.api.mock.calls[0][1].body)).toMatchObject({paymentRequestId:mutation.request.id,channel:'whatsapp',acknowledge:true});
  view.rerender(<SalePaymentRequests sale={saved} onSaved={onSaved} onRecordDeposit={onRecordDeposit}/>);
  expect(screen.getByText('Has the deposit arrived?')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Record deposit'}));expect(onRecordDeposit).toHaveBeenCalledWith(saved.paymentRequests![0]);expect(state.api).toHaveBeenCalledOnce();
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
  fireEvent.click(screen.getByRole('button',{name:'Download PDF'}));const signal=state.api.mock.calls[0][1].signal as AbortSignal;view.unmount();
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

it('requires valid penny amounts and has no document preview or background calls',()=>{
  render(<SalePaymentRequests sale={fixture()} actionOnly onSaved={vi.fn()}/>);
  expect(screen.queryByText('View document')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Preview PDF'})).not.toBeInTheDocument();
  for(const value of ['0.001','1e3','90071992547409.92']) {fireEvent.change(screen.getByLabelText('Amount (£)'),{target:{value}});expect(screen.getByRole('button',{name:'Request payment'})).toBeDisabled();}
  fireEvent.change(screen.getByLabelText('Amount (£)'),{target:{value:'250.01'}});expect(screen.getByRole('button',{name:'Request £250.01'})).toBeEnabled();
  expect(state.api).not.toHaveBeenCalled();expect(state.pdf).not.toHaveBeenCalled();
});

it('only offers the deposit next step once email is confirmed sent',async()=>{
  const mutation=withRequest(),saved=structuredClone(mutation.sale),onSaved=vi.fn(),onRecordDeposit=vi.fn();saved.revision++;
  saved.emailDeliveries=[{id:'mail-1',documentId:mutation.request.documentId,to:saved.draft.email,status:'sent',attemptedAt:new Date().toISOString()}];
  state.api.mockResolvedValue({sale:saved});const view=render(<SalePaymentRequests sale={mutation.sale} onSaved={onSaved} onRecordDeposit={onRecordDeposit}/>);
  fireEvent.click(screen.getByRole('button',{name:'Email PDF'}));fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Send payment request email'}));
  await waitFor(()=>expect(onSaved).toHaveBeenCalledWith(saved));view.rerender(<SalePaymentRequests sale={saved} onSaved={onSaved} onRecordDeposit={onRecordDeposit}/>);
  expect(screen.getByText('Has the deposit arrived?')).toBeInTheDocument();expect(saved.payments).toHaveLength(0);
  fireEvent.click(screen.getByRole('button',{name:'Record deposit'}));expect(onRecordDeposit).toHaveBeenCalledWith(saved.paymentRequests![0]);
});

it.each(['prepared','failed'] as const)('does not advance after an email is %s and retries the same saved request',async(status)=>{
  const mutation=withRequest(),saved=structuredClone(mutation.sale),onSaved=vi.fn();saved.revision++;
  saved.emailDeliveries=[{id:'mail-1',documentId:mutation.request.documentId,to:saved.draft.email,status,attemptedAt:new Date().toISOString(),...(status==='failed'?{error:'Sending failed'}:{})}];
  state.api.mockResolvedValue({sale:saved});const view=render(<SalePaymentRequests sale={mutation.sale} onSaved={onSaved} onRecordDeposit={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button',{name:'Email PDF'}));fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Send payment request email'}));
  await waitFor(()=>expect(onSaved).toHaveBeenCalledWith(saved));view.rerender(<SalePaymentRequests sale={saved} onSaved={onSaved} onRecordDeposit={vi.fn()}/>);
  expect(screen.queryByRole('button',{name:'Record deposit'})).not.toBeInTheDocument();
  if(status==='failed')fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Go back'}));
  fireEvent.click(screen.getByRole('button',{name:status==='failed'?'Retry email':'Email PDF'}));fireEvent.click(within(screen.getByRole('dialog')).getByRole('button',{name:'Send payment request email'}));
  await waitFor(()=>expect(state.api).toHaveBeenCalledTimes(2));expect(state.api.mock.calls[1][0]).toBe(state.api.mock.calls[0][0]);expect(saved.paymentRequests).toHaveLength(1);
});

it.each(['sending','unknown'] as const)('blocks another email when its delivery is %s',status=>{
  const mutation=withRequest(),saved=structuredClone(mutation.sale);
  saved.emailDeliveries=[{id:'mail-1',documentId:mutation.request.documentId,to:saved.draft.email,status,attemptedAt:new Date().toISOString()}];
  render(<SalePaymentRequests sale={saved} onSaved={vi.fn()}/>);expect(screen.getByRole('button',{name:'Email PDF'})).toBeDisabled();expect(state.api).not.toHaveBeenCalled();
});

it('shows an accepted short deposit and keeps the shortfall in the balance',()=>{
  const mutation=withRequest(),sale=structuredClone(mutation.sale);
  Object.assign(sale.paymentRequests![0],{status:'accepted',acceptedAmountPence:40000,acceptedAt:new Date().toISOString(),acceptedBy:'Staff',acceptedPaymentId:'p1'});
  sale.payments.push({id:'p1',amount:'400',amountPence:40000,signedAmountPence:40000,kind:'deposit',status:'confirmed',method:'Bank transfer',date:'2026-11-04',reference:'',recordedAt:new Date().toISOString(),recordedBy:'Staff'});
  render(<SalePaymentRequests sale={sale} onSaved={vi.fn()} onRecordDeposit={vi.fn()}/>);
  expect(screen.getByText('£400.00 accepted as the deposit.')).toBeInTheDocument();expect(screen.getByText(/£100.00 less than requested/)).toHaveTextContent('still included in the balance');
  expect(screen.getByText('Left to pay').parentElement).toHaveTextContent('£9,600.00');expect(screen.queryByRole('button',{name:'Record deposit'})).not.toBeInTheDocument();
});

it('keeps an overdue request open and only offers reminder or cancel, never automatic release',()=>{
  const mutation=withRequest(),sale=structuredClone(mutation.sale);sale.paymentRequests![0].dueDate='2020-01-01';sale.paymentRequests![0].deliveryMode='document';
  render(<SalePaymentRequests sale={sale} onSaved={vi.fn()} onRecordDeposit={vi.fn()}/>);
  expect(screen.getByText(/will not be released automatically/)).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Email reminder'})).toBeEnabled();
  expect(screen.queryByRole('button',{name:'New request'})).not.toBeInTheDocument();expect(state.api).not.toHaveBeenCalled();
});

it('does not repeat the money summary when the sale workspace already shows it',()=>{
  render(<SalePaymentRequests sale={fixture()} onSaved={vi.fn()} actionOnly showMoneySummary={false}/>);
  expect(screen.queryByText('Vehicle price')).not.toBeInTheDocument();expect(screen.queryByText('Left to pay')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Amount (£)')).toBeInTheDocument();
});

it('keeps an accepted older deposit in history while a new balance request is active',()=>{
  const mutation=withRequest(),sale=structuredClone(mutation.sale);Object.assign(sale.paymentRequests![0],{status:'accepted',acceptedAmountPence:50000});
  const newer={...mutation.request,id:'next-request',reference:'PAY-next',kind:'balance' as const,amountPence:950000};sale.paymentRequests!.push(newer);
  render(<SalePaymentRequests sale={sale} onSaved={vi.fn()}/>);
  expect(screen.getByText('Previous requests (1)').closest('details')).not.toHaveAttribute('open');
  expect(screen.getByRole('article',{name:'Remaining balance request PAY-next'})).toBeInTheDocument();
  expect(screen.getByRole('article',{name:`Deposit request ${mutation.request.reference}`})).toHaveClass('sale-request-row-history');
});

it('defaults to requesting a balance on sold cars and does not offer a deposit', async () => {
  const sale = fixture();
  sale.lifecycle = { status: 'sold', vehicleId: sale.draft.vehicleId, changedAt: context().now };
  state.api.mockResolvedValue({ sale });
  render(<SalePaymentRequests sale={sale} actionOnly onSaved={vi.fn()}/>);
  expect(screen.getByLabelText('Request type')).toHaveValue('balance');
  expect(screen.queryByRole('option', { name: 'Deposit' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Amount (£)'), { target: { value: '500' } });
  fireEvent.click(screen.getByRole('button', { name: 'Request £500.00' }));
  await waitFor(() => expect(state.api).toHaveBeenCalledOnce());
  expect(JSON.parse(state.api.mock.calls[0][1].body)).toMatchObject({ kind: 'balance', amount: '500' });
});

it('retains the original document and record or cancel actions on a part-paid request', () => {
  const made = requestSalePayment(fixture(), { kind: 'other', amount: '500', dueDate: '2026-12-01', note: '' }, context());
  const paid = changeSaleWorkspace(made.sale, {
    action: 'invoice-payment',
    payment: { kind: 'part-payment', status: 'confirmed', method: 'Bank transfer', amount: '100', date: '2026-11-03', reference: '', paymentRequestId: made.request.id },
  }, { requestId: 'test-part-payment', expectedRevision: made.sale.revision }, context()).sale;
  const record = vi.fn();
  render(<SalePaymentRequests sale={paid} onSaved={vi.fn()} onRecordDeposit={record}/>);
  expect(screen.getByText('Still to pay:')).toHaveTextContent('£400.00');
  expect(screen.getByRole('button', { name: 'Download original PDF' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: /email pdf|email reminder/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Open WhatsApp' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Record payment' }));
  expect(record).toHaveBeenCalledWith(paid.paymentRequests![0]);
  fireEvent.click(screen.getByText('More options'));
  expect(screen.getByRole('button', { name: 'Cancel request' })).toBeEnabled();
  expect(state.api).not.toHaveBeenCalled();
});

it('suggests a dealership deposit and lets an authorised owner override amount and instructions', async () => {
  const sale = fixture(), mutation = withRequest(sale);
  state.api.mockResolvedValue({ sale: mutation.sale });
  render(<SalePaymentRequests sale={sale} actionOnly onSaved={vi.fn()} canEditPaymentInstructions defaults={{ paymentDefaults: { suggestedDepositPence: 35050, preferredShare: 'manual' }, paymentInstructions: 'Use your sale reference.' }}/>);
  expect(screen.getByLabelText('Amount (£)')).toHaveValue('350.50');
  fireEvent.change(screen.getByLabelText('Amount (£)'), { target: { value: '300' } });
  fireEvent.click(screen.getByText('Payment instructions'));
  expect(screen.getByLabelText('Instructions for this request')).toHaveValue('Use your sale reference.');
  fireEvent.change(screen.getByLabelText('Instructions for this request'), { target: { value: 'Use the agreed payment reference.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Request £300.00' }));
  await waitFor(() => expect(state.api).toHaveBeenCalledOnce());
  expect(JSON.parse(state.api.mock.calls[0][1].body)).toMatchObject({ kind: 'deposit', amount: '300', paymentInstructions: 'Use the agreed payment reference.' });
});

it('puts the preferred share first and only records a manual share after staff confirm', async () => {
  const mutation = withRequest(), saved = structuredClone(mutation.sale), onSaved = vi.fn();
  Object.assign(saved.paymentRequests![0], { sharedChannel: 'manual', sharedAt: context().now });
  state.api.mockResolvedValue({ sale: saved });
  const view = render(<SalePaymentRequests sale={mutation.sale} onSaved={onSaved} defaults={{ paymentDefaults: { suggestedDepositPence: null, preferredShare: 'manual' }, paymentInstructions: '' }}/>);
  expect(within(view.container.querySelector('.sale-request-actions') as HTMLElement).getAllByRole('button')[0]).toHaveTextContent('Download PDF');
  fireEvent.click(screen.getByText('More options'));
  fireEvent.click(screen.getByRole('button', { name: 'Mark as shared manually' }));
  expect(state.api).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Yes, mark as shared' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
  expect(JSON.parse(state.api.mock.calls[0][1].body)).toMatchObject({ channel: 'manual', acknowledge: true });
});
