import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FullSalesTermsSettings } from './full-sales-terms-settings';
import { SaleTermsDocuments } from './sale-terms-documents';
import { setAuthTokenGetter } from '@workspace/api-client-react';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); setAuthTokenGetter(null); });
const content = { title: 'Dealership terms', sections: [{ heading: 'Deposit', paragraphs: ['Keep this exact wording.'], condition: 'all' }] };
it('saves review wording without publication and requires an explicit saved version action', async () => {
  const writes: any[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => { if (init?.body) { writes.push({ method: init.method, body: JSON.parse(init.body) }); if (String(_url).endsWith('/publish')) return Response.json({ revision: 3, draft: content, published: { ...content, id: 'version-1', version: 1 } }); return Response.json({ revision: 2, draft: JSON.parse(init.body).content, published: null }); } return Response.json({ revision: 1, draft: content, published: null }); }));
  render(<FullSalesTermsSettings />);
  fireEvent.change(await screen.findByLabelText('Document title'), { target: { value: 'Updated title' } });
  expect(screen.getByRole('button', { name: 'Use on new sales' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save review draft' }));
  await screen.findByText('Review draft saved. The terms used on new sales have not changed.');
  expect(writes[0]).toEqual({ method: 'PUT', body: { expectedRevision: 1, content: { ...content, title: 'Updated title' } } });
  expect(writes).toHaveLength(1); expect(screen.getByRole('button', { name: 'Use on new sales' })).toBeDisabled();
  fireEvent.click(screen.getByLabelText('Use this saved wording for new sales')); fireEvent.click(screen.getByRole('button', { name: 'Use on new sales' }));
  await waitFor(() => expect(writes).toHaveLength(2)); expect(writes[1].body).toEqual({ expectedRevision: 2, confirm: true });
});
it('keeps full terms after a conflict and offers both print copy modes', async () => {
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => init?.method === 'PUT' ? Response.json({ error: 'Changed' }, { status: 409 }) : Response.json({ revision: 1, draft: content, published: null })));
  render(<FullSalesTermsSettings />);
  fireEvent.change(await screen.findByLabelText('Document title'), { target: { value: 'Keep unsaved words' } }); fireEvent.click(screen.getByRole('button', { name: 'Save review draft' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Your wording is kept'); expect(screen.getByLabelText('Document title')).toHaveValue('Keep unsaved words');
  expect(screen.getByLabelText('Print copies')).toHaveValue('dealer'); fireEvent.change(screen.getByLabelText('Print copies'), { target: { value: 'both' } }); expect(screen.getByLabelText('Print copies')).toHaveValue('both');
});
it('loads both archived print variants with the staff bearer token without sending messages or modifying the sale', async () => {
  const requests: Array<{ url: string; method: string; authorization: string | null }> = [];
  setAuthTokenGetter(async () => 'fictional-staff-token');
  const tab = { opener: null, location: { href: '' }, close: vi.fn() };
  vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
  URL.createObjectURL = vi.fn(() => 'blob:fictional-terms'); URL.revokeObjectURL = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    requests.push({ url: String(url), method: init?.method ?? 'GET', authorization: new Headers(init?.headers).get('authorization') });
    if (String(url).includes('/pdf?')) return new Response(new Blob(['fictional-pdf'], { type: 'application/pdf' }), { headers: { 'Content-Type': 'application/pdf' } });
    return Response.json(String(url).endsWith('/api/sales-terms') ? { revision: 2, draft: content, published: { id: 'version-1', version: 1 } } : { documents: [{ id: 'document-1', created_at: '2026-11-03', snapshot: { title: 'Terms', termsVersion: 1, registration: 'AB12 CDE' } }] });
  }));
  render(<SaleTermsDocuments saleId="sale-1" saleRevision={4} canIssue={false} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Dealer copy' }));
  await waitFor(() => expect(tab.location.href).toBe('blob:fictional-terms'));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Dealer and customer copies' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Dealer and customer copies' }));
  await waitFor(() => expect(requests.filter(r => r.url.includes('/pdf?'))).toHaveLength(2));
  expect(requests.filter(r => r.url.includes('/pdf?')).map(r => r.url)).toEqual(['/api/sales-terms/sales/sale-1/document-1/pdf?copies=dealer', '/api/sales-terms/sales/sale-1/document-1/pdf?copies=both']);
  expect(requests.every(r => r.method === 'GET' && r.authorization === 'Bearer fictional-staff-token')).toBe(true);
  expect(screen.queryByRole('button', { name: 'Issue terms for this sale' })).not.toBeInTheDocument();
});
it('notifies the saved deal when new terms change its review context', async () => {
  const onIssued = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (url, init) => init?.method === 'POST' ? Response.json({ id: 'new-document' }) : Response.json(String(url).endsWith('/api/sales-terms') ? { published: { id: 'v1', version: 1 } } : { documents: [] })));
  render(<SaleTermsDocuments saleId="sale-1" saleRevision={4} onIssued={onIssued}/>);
  fireEvent.click(await screen.findByRole('button', {name:'Issue terms for this sale'}));
  await waitFor(() => expect(onIssued).toHaveBeenCalledWith('sale-1'));
});
it('cannot attach a late terms result to a different open deal', async () => {
  let finish!: (response: Response) => void;
  const onIssued = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (url, init) => init?.method === 'POST' ? new Promise<Response>(resolve => { finish = resolve; }) : Response.json(String(url).endsWith('/api/sales-terms') ? { published: { id: 'v1', version: 1 } } : { documents: [] })));
  const view = render(<SaleTermsDocuments saleId="sale-1" saleRevision={4} onIssued={onIssued}/>);
  fireEvent.click(await screen.findByRole('button', {name:'Issue terms for this sale'}));
  await waitFor(() => expect(finish).toBeTypeOf('function'));
  view.rerender(<SaleTermsDocuments saleId="sale-2" saleRevision={2} onIssued={onIssued}/>);
  await screen.findByRole('button', {name:'Issue terms for this sale'});
  finish(Response.json({id:'old-document'}));
  await waitFor(() => expect(screen.getByRole('button', {name:'Issue terms for this sale'})).toBeEnabled());
  expect(onIssued).not.toHaveBeenCalled();
});
