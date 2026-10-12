import { Blob as NodeBlob } from 'node:buffer';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { customFetch } from '@workspace/api-client-react';
import { getDocument } from 'pdfjs-dist';
import { saleDocumentPdfBytes } from '@workspace/vehicle-meta/sale-document-pdf';
import { saleWorkspaceBranding, saleWorkspaceTotals, type SaleWorkspaceDocument, type SaleWorkspaceDraft } from '@workspace/vehicle-meta';
import { dealerConfig } from '@/config/dealer';
import { emptyDraft } from './model';
import { buildDraftSaleDocument, openSaleDocumentPdf, PdfSalesDocument } from './sales-document';

const { renderPage, pdfState } = vi.hoisted(() => ({ renderPage: vi.fn(), pdfState: { pages: 1 } }));

vi.mock('@workspace/api-client-react', () => ({ customFetch: vi.fn() }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/assets/pdf.worker.mjs' }));
vi.mock('@workspace/vehicle-meta/sale-document-pdf', () => ({ saleDocumentPdfBytes: vi.fn((document: SaleWorkspaceDocument) => new TextEncoder().encode(`%PDF-${document.snapshot.draft.customer}`)) }));
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: vi.fn(() => ({
    destroy: vi.fn(),
    promise: Promise.resolve({ numPages: pdfState.pages, getPage: async (number: number) => ({ getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale }), render: () => renderPage(number) }) }),
  })),
}));
const archiveUrl = '/api/sale-workspace/sale-one/documents/document-one/pdf';
const issued = (): SaleWorkspaceDocument => {
  const draft: SaleWorkspaceDraft = { ...emptyDraft(), payments: [], id: 'SALE-2026-00001', customer: 'Alex Buyer', vehicleId: 'car-1', vehicle: '2018 Estate', registration: 'AB18 XYZ', price: '12000' };
  return { id: 'document-one', number: 'INV-2026-00001', type: 'invoice', title: 'Sales invoice', issuedAt: '2026-10-11T10:00:00Z', issuedBy: 'Showroom staff', version: 1, balanceAtIssue: 1200000, snapshot: { draft, payments: [], totals: saleWorkspaceTotals(draft), branding: saleWorkspaceBranding(dealerConfig) } };
};

describe('authoritative sale PDF preview', () => {
  beforeEach(() => {
    vi.stubGlobal('Blob', NodeBlob);
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:archived-document') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.mocked(customFetch).mockReset();
    vi.mocked(saleDocumentPdfBytes).mockClear();
    vi.mocked(getDocument).mockClear();
    pdfState.pages = 1;
    renderPage.mockReset().mockImplementation(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('displays the fetched immutable PDF bytes and offers a full-page PDF link', async () => {
    vi.mocked(customFetch).mockResolvedValue(new NodeBlob(['%PDF-original-archive'], { type: 'application/pdf' }));
    render(<PdfSalesDocument issuedDocument={issued()} pdfUrl={archiveUrl} />);
    await waitFor(() => expect(screen.getByRole('img', { name: 'Sales invoice, page 1 of 1' })).toHaveAttribute('data-rendered', 'true'));
    expect(customFetch).toHaveBeenCalledWith(archiveUrl, expect.objectContaining({ responseType: 'blob', cache: 'no-store' }));
    const [blob] = vi.mocked(URL.createObjectURL).mock.calls[0];
    expect(await (blob as NodeBlob).text()).toBe('%PDF-original-archive');
    // Canvas pixels are published before the React commit exposes the archive link.
    // Wait for the staff-facing ready state, especially under a parallel full suite.
    expect(await screen.findByRole('link', { name: 'Open PDF' })).toHaveAttribute('href', 'blob:archived-document');
    await waitFor(() => expect(screen.getByRole('img', { name: 'Sales invoice, page 1 of 1' }).closest('[aria-busy]')).toHaveAttribute('aria-busy', 'false'));
    expect(screen.getByText('Alex Buyer')).toBeInTheDocument();
  });

  it('never silently replaces a failed archive with a regenerated invoice', async () => {
    vi.mocked(customFetch).mockRejectedValue(new Error('archive unavailable'));
    render(<PdfSalesDocument issuedDocument={issued()} pdfUrl={archiveUrl} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('PDF could not open'));
    expect(screen.queryByRole('img', { name: 'Sales invoice, page 1 of 1' })).not.toBeInTheDocument();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('offers the original native archive when its bytes fetch successfully but PDFjs cannot render them', async () => {
    vi.mocked(URL.createObjectURL).mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second');
    vi.mocked(customFetch).mockResolvedValueOnce(new NodeBlob(['%PDF-first-archive'])).mockResolvedValueOnce(new NodeBlob(['%PDF-second-archive']));
    const first = issued();
    const view = render(<PdfSalesDocument issuedDocument={first} pdfUrl={archiveUrl} />);
    await waitFor(() => expect(screen.getByRole('link', { name: 'Open PDF' })).toHaveAttribute('href', 'blob:first'));
    renderPage.mockImplementationOnce(() => ({ promise: Promise.reject(new Error('PDFjs page rendering unavailable')), cancel: vi.fn() }));
    view.rerender(<PdfSalesDocument issuedDocument={{ ...first, id: 'second-document', number: 'INV-2026-00002', snapshot: { ...first.snapshot, draft: { ...first.snapshot.draft, customer: 'Jordan Blake' } } }} pdfUrl="/api/sale-workspace/sale-one/documents/second-document/pdf" />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Use Open PDF'));
    expect(screen.getByRole('link', { name: 'Open PDF' })).toHaveAttribute('href', 'blob:second');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByText('Alex Buyer')).not.toBeInTheDocument();
    expect(screen.getByText('Jordan Blake')).toBeInTheDocument();
    expect(await (vi.mocked(URL.createObjectURL).mock.calls[1][0] as NodeBlob).text()).toBe('%PDF-second-archive');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first');
    expect(saleDocumentPdfBytes).not.toHaveBeenCalled();
  });

  it('clears older draft canvases and exposes only the latest native PDF if replacement rendering fails', async () => {
    vi.mocked(URL.createObjectURL).mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second');
    const draft = { ...emptyDraft(), customer: 'Alex Buyer', price: '12000' };
    const view = render(<PdfSalesDocument draft={draft} dealer={dealerConfig} documentType="Sales invoice" />);
    await waitFor(() => expect(screen.getByRole('link', { name: 'Open PDF' })).toHaveAttribute('href', 'blob:first'));
    renderPage.mockImplementationOnce(() => ({ promise: Promise.reject(new Error('PDFjs page rendering unavailable')), cancel: vi.fn() }));
    vi.useFakeTimers();
    view.rerender(<PdfSalesDocument draft={{ ...draft, customer: 'Jordan Blake' }} dealer={dealerConfig} documentType="Sales invoice" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Use Open PDF'));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open PDF' })).toHaveAttribute('href', 'blob:second');
    expect(screen.queryByText('Alex Buyer')).not.toBeInTheDocument();
    expect(screen.getByText('Jordan Blake')).toBeInTheDocument();
    expect(await (vi.mocked(URL.createObjectURL).mock.calls[1][0] as NodeBlob).text()).toBe('%PDF-Jordan Blake');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first');
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
  });

  it('refuses an issued preview without an archive URL and refuses external PDF hosts', async () => {
    const first = render(<PdfSalesDocument issuedDocument={issued()} />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument()); first.unmount();
    render(<PdfSalesDocument issuedDocument={issued()} pdfUrl="https://another-dealer.invalid/file.pdf" />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(customFetch).not.toHaveBeenCalled();
  });

  it('releases the customer PDF object URL when leaving the document', async () => {
    vi.mocked(customFetch).mockResolvedValue(new NodeBlob(['%PDF-original-archive']));
    const view = render(<PdfSalesDocument issuedDocument={issued()} pdfUrl={archiveUrl} />);
    await waitFor(() => expect(screen.getByRole('link', { name: 'Open PDF' })).toBeInTheDocument()); view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:archived-document');
  });

  it('keeps the displayed archive in place during equivalent polling renders', async () => {
    vi.mocked(customFetch).mockResolvedValue(new NodeBlob(['%PDF-original-archive']));
    const document = issued();
    const view = render(<PdfSalesDocument issuedDocument={document} pdfUrl={archiveUrl} />);
    await waitFor(() => expect(screen.getByRole('img', { name: 'Sales invoice, page 1 of 1' })).toBeInTheDocument());
    const canvas = screen.getByRole('img', { name: 'Sales invoice, page 1 of 1' });
    view.rerender(<PdfSalesDocument issuedDocument={JSON.parse(JSON.stringify(document))} pdfUrl={archiveUrl} />);
    expect(screen.getByRole('img', { name: 'Sales invoice, page 1 of 1' })).toBe(canvas);
    expect(customFetch).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('keeps the finished invoice in place while typing, then renders a single settled draft', async () => {
    const draft = { ...emptyDraft(), customer: 'Alex Buyer', price: '12000' };
    const view = render(<PdfSalesDocument draft={draft} dealer={dealerConfig} documentType="Sales invoice" />);
    await waitFor(() => expect(screen.getByRole('link', { name: 'Open PDF' })).toBeInTheDocument());
    const original = screen.getByRole('img', { name: 'Sales invoice, page 1 of 1' });
    expect(saleDocumentPdfBytes).toHaveBeenCalledTimes(1);
    vi.useFakeTimers();
    for (const customer of ['J', 'Jo', 'Jordan Blake']) {
      view.rerender(<PdfSalesDocument draft={{ ...draft, customer }} dealer={dealerConfig} documentType="Sales invoice" />);
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      expect(screen.getByRole('img', { name: 'Sales invoice, page 1 of 1' })).toBe(original);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(screen.getByText('Alex Buyer')).toBeInTheDocument();
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(399); });
    expect(saleDocumentPdfBytes).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByText('Jordan Blake')).toBeInTheDocument());
    expect(saleDocumentPdfBytes).toHaveBeenCalledTimes(2);
    expect(getDocument).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('img', { name: 'Sales invoice, page 1 of 1' })).not.toBe(original);
  });

  it('swaps all completed pages and the PDF link together rather than replacing a partially rendered page', async () => {
    vi.mocked(URL.createObjectURL).mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second');
    const draft = { ...emptyDraft(), customer: 'Alex Buyer', price: '12000' };
    const view = render(<PdfSalesDocument draft={draft} dealer={dealerConfig} documentType="Sales invoice" />);
    await waitFor(() => expect(screen.getByRole('link', { name: 'Open PDF' })).toHaveAttribute('href', 'blob:first'));
    const original = screen.getByRole('img', { name: 'Sales invoice, page 1 of 1' });
    let finishLastPage!: () => void;
    const lastPage = new Promise<void>(resolve => { finishLastPage = resolve; });
    pdfState.pages = 2;
    renderPage.mockImplementation(number => ({ promise: number === 2 ? lastPage : Promise.resolve(), cancel: vi.fn() }));
    vi.useFakeTimers();
    view.rerender(<PdfSalesDocument draft={{ ...draft, customer: 'Jordan Blake' }} dealer={dealerConfig} documentType="Sales invoice" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    vi.useRealTimers();
    await waitFor(() => expect(renderPage).toHaveBeenCalledWith(2));
    expect(screen.getByRole('img', { name: 'Sales invoice, page 1 of 1' })).toBe(original);
    expect(screen.getByRole('link', { name: 'Open PDF' })).toHaveAttribute('href', 'blob:first');
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    await act(async () => { finishLastPage(); await lastPage; });
    await waitFor(() => expect(screen.getByRole('link', { name: 'Open PDF' })).toHaveAttribute('href', 'blob:second'));
    expect(screen.getAllByRole('img')).toHaveLength(2);
    expect(screen.getByText('Jordan Blake')).toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first');
  });

  it('clears a previous issued document immediately when a different archive is selected, even if that fetch fails', async () => {
    vi.mocked(customFetch).mockResolvedValueOnce(new NodeBlob(['%PDF-original-archive']));
    const first = issued();
    const view = render(<PdfSalesDocument issuedDocument={first} pdfUrl={archiveUrl} />);
    await waitFor(() => expect(screen.getByRole('link', { name: 'Open PDF' })).toBeInTheDocument());
    vi.mocked(customFetch).mockRejectedValueOnce(new Error('second archive missing'));
    view.rerender(<PdfSalesDocument issuedDocument={{ ...first, id: 'another-document', number: 'INV-2026-00002' }} pdfUrl="/api/sale-workspace/sale-one/documents/another-document/pdf" />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open PDF' })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('PDF could not open'));
    expect(saleDocumentPdfBytes).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:archived-document');
  });

  it('downloads the latest entered draft immediately instead of the delayed on-screen preview', async () => {
    const draft = { ...emptyDraft(), customer: 'Alex Buyer', price: '12000' };
    const view = render(<PdfSalesDocument draft={draft} dealer={dealerConfig} documentType="Sales invoice" />);
    await waitFor(() => expect(screen.getByRole('link', { name: 'Open PDF' })).toBeInTheDocument());
    const latest = { ...draft, customer: 'Jordan Blake', price: '11000' };
    vi.useFakeTimers();
    view.rerender(<PdfSalesDocument draft={latest} dealer={dealerConfig} documentType="Sales invoice" />);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await act(async () => { await openSaleDocumentPdf({ draft: latest, dealer: dealerConfig, documentType: 'Sales invoice' }, 'download'); });
    expect(click).toHaveBeenCalledTimes(1);
    const generated = vi.mocked(saleDocumentPdfBytes).mock.calls.at(-1)?.[0];
    expect(generated?.snapshot.draft.customer).toBe('Jordan Blake');
    expect(generated?.snapshot.totals.price).toBe(1100000);
    expect(screen.getByText('Alex Buyer')).toBeInTheDocument();
    expect(screen.queryByText('Jordan Blake')).not.toBeInTheDocument();
  });

  it('draft totals credit only confirmed payments and preserve same-car issued facts if stock disappears', () => {
    const draft = { ...emptyDraft(), vehicleId: 'car-one', price: '12000', payments: [{ amount: '500', method: 'Bank transfer', date: '2026-10-11', reference: 'not-cleared', status: 'pending' as const }] };
    const savedVehicle = { id: 'car-one', year: 2018, mileage: 42000, colour: 'Blue' };
    const document = buildDraftSaleDocument({ draft, dealer: dealerConfig, documentType: 'Sales invoice', savedVehicle });
    expect(document.snapshot.totals.confirmedPaid).toBe(0);
    expect(document.balanceAtIssue).toBe(1200000);
    expect(document.snapshot.vehicle).toEqual(savedVehicle);
    const other = buildDraftSaleDocument({ draft, dealer: dealerConfig, documentType: 'Sales invoice', savedVehicle: { ...savedVehicle, id: 'other-car' } });
    expect(other.snapshot.vehicle).toBeUndefined();
  });
});
