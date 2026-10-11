import { Blob as NodeBlob } from 'node:buffer';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { customFetch } from '@workspace/api-client-react';
import { saleWorkspaceBranding, saleWorkspaceTotals, type SaleWorkspaceDocument, type SaleWorkspaceDraft } from '@workspace/vehicle-meta';
import { dealerConfig } from '@/config/dealer';
import { emptyDraft } from './model';
import { buildDraftSaleDocument, PdfSalesDocument } from './sales-document';

vi.mock('@workspace/api-client-react', () => ({ customFetch: vi.fn() }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/assets/pdf.worker.mjs' }));
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: vi.fn(() => ({
    destroy: vi.fn(),
    promise: Promise.resolve({ numPages: 1, getPage: async () => ({ getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale }), render: () => ({ promise: Promise.resolve(), cancel: vi.fn() }) }) }),
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
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('displays the fetched immutable PDF bytes and offers a full-page PDF link', async () => {
    vi.mocked(customFetch).mockResolvedValue(new NodeBlob(['%PDF-original-archive'], { type: 'application/pdf' }));
    render(<PdfSalesDocument issuedDocument={issued()} pdfUrl={archiveUrl} />);
    await waitFor(() => expect(screen.getByRole('img', { name: 'Sales invoice, page 1 of 1' })).toHaveAttribute('data-rendered', 'true'));
    expect(customFetch).toHaveBeenCalledWith(archiveUrl, expect.objectContaining({ responseType: 'blob', cache: 'no-store' }));
    const [blob] = vi.mocked(URL.createObjectURL).mock.calls[0];
    expect(await (blob as NodeBlob).text()).toBe('%PDF-original-archive');
    expect(screen.getByRole('link', { name: 'Open PDF' })).toHaveAttribute('href', 'blob:archived-document');
    expect(screen.getByText('Alex Buyer')).toBeInTheDocument();
  });

  it('never silently replaces a failed archive with a regenerated invoice', async () => {
    vi.mocked(customFetch).mockRejectedValue(new Error('archive unavailable'));
    render(<PdfSalesDocument issuedDocument={issued()} pdfUrl={archiveUrl} />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('PDF could not open'));
    expect(screen.queryByRole('img', { name: 'Sales invoice, page 1 of 1' })).not.toBeInTheDocument();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
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
