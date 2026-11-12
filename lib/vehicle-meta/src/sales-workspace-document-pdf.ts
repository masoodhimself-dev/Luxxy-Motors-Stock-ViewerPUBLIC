import { jsPDF } from 'jspdf';
import { renderInvoice } from './classic-ledger/render-invoice.ts';
import { ledgerRegularFontBase64, ledgerBoldFontBase64 } from './classic-ledger/fonts.ts';
import type { ImageAsset } from './classic-ledger/types.ts';
import { registrationPlateFontBase64 } from './registration-plate-font.ts';
import { formatRegistrationPlate } from './registration.ts';
import { invoicePalette } from './invoice-palette.ts';
import { invoiceTextLimits, SaleWorkspaceError, type SaleWorkspaceDocument } from './sale-workspace.ts';
import { salesDocumentPresentation } from './sales-document-presentation.ts';

/** Embedded snapshot assets only. The saved SVG logo is rasterised before issue. */
function embeddedImage(value: unknown, limit: number): ImageAsset | undefined {
  if (typeof value !== 'string' || value.length > limit || !/^data:image\/(?:png|jpe?g);base64,[A-Za-z0-9+/=]+$/.test(value)) return;
  try {
    const properties = new jsPDF().getImageProperties(value);
    const format = properties.fileType === 'PNG' ? 'PNG' : properties.fileType === 'JPEG' ? 'JPEG' : undefined;
    if (!format || !(properties.width > 0 && properties.height > 0)) return;
    return { data: value.replace(/^data:image\/jpg;/, 'data:image/jpeg;'), format };
  } catch { return; }
}

/** Explicitly versioned stationery; historic unmarked archives never enter here. */
export function salesWorkspaceDocumentPdf(document: SaleWorkspaceDocument, options: { fileId?: string; draft?: boolean } = {}): Uint8Array {
  const data = salesDocumentPresentation(document);
  const { branding, vehicle } = document.snapshot;
  const design = branding.invoiceSettings;
  if (document.type === 'invoice') {
    // These are the compact invoice summaries. Full dealership terms have their
    // own versioned multipage renderer and must not be placed in this short band.
    const summaries = { footer: design?.footer ?? '', paymentInstructions: design?.paymentInstructions ?? '', saleTerms: document.content ?? '' };
    for (const [key, value] of Object.entries(summaries)) {
      const limit = invoiceTextLimits[key as keyof typeof invoiceTextLimits];
      if (value.length > limit) throw new SaleWorkspaceError(`Shorten ${key.replace(/([A-Z])/g, ' $1').toLowerCase()} to ${limit} characters in invoice settings before issuing this A4 invoice.`);
    }
  }
  if (!data.dealer.name) throw new SaleWorkspaceError('Add the dealership name before creating a sale document.');
  if (document.verification?.url && (!/^https?:\/\/[a-z0-9.:[\]-]+\/verify-invoice\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9]{64}$/i.test(document.verification.url) || document.verification.url.length > 700)) throw new SaleWorkspaceError('The invoice verification address is invalid.');
  data.draft = options.draft;
  data.showDraftVerificationNote = false;
  data.issueDateLabel = options.draft ? 'Prepared' : 'Issued';
  if (document.type === 'invoice' && vehicle?.invoicePhotoDataUrls !== undefined) {
    data.vehicle.photos = Array.isArray(vehicle.invoicePhotoDataUrls)
      ? vehicle.invoicePhotoDataUrls.slice(0, 3).flatMap(value => {
        const image = embeddedImage(value, 2_800_000);
        return image ? [image] : [];
      }) : [];
  } else {
    data.vehicle.photo = embeddedImage(vehicle?.photoDataUrl, 2_800_000);
  }
  const palette = invoicePalette(branding.presentation?.linkColour);
  const logoWidth = design?.logoSize === 'small' ? 28 : design?.logoSize === 'large' ? 49 : 38;
  const logoHeight = design?.logoSize === 'small' ? 9 : design?.logoSize === 'large' ? 13.07 : 12;
  try {
    const result = renderInvoice(data, {
      fonts: { regularTtf: ledgerRegularFontBase64, boldTtf: ledgerBoldFontBase64, plateTtf: registrationPlateFontBase64 },
      registrationFormatter: formatRegistrationPlate,
      branding: { logo: design?.showLogo !== false ? embeddedImage(branding.identity.logoAsset, 1_500_000) : undefined, logoWidth, logoHeight, accent: design?.style === 'understated' ? '#34414B' : palette.strong },
      monochrome: design?.inkSaving,
      creationDate: new Date(document.issuedAt),
      fileId: options.fileId ?? document.id.replace(/[^a-f0-9]/gi, '').padEnd(32, '0').slice(0, 32),
    });
    result.doc.setProperties({ title: `${data.type} ${document.number}`, author: data.dealer.name });
    return new Uint8Array(result.doc.output('arraybuffer'));
  } catch (error) {
    if (error instanceof SaleWorkspaceError) throw error;
    throw new SaleWorkspaceError(error instanceof Error ? error.message : 'Check the saved document details.');
  }
}
