import { describe, expect, it } from 'vitest';
import { currentInvoiceSettings, customerSaleDocument, defaultInvoiceSettings, invoiceBranding, saleWorkspaceBranding, type SaleWorkspaceDocument } from '@workspace/vehicle-meta';

const legacySettings = () => {
  const { layoutVersion: _version, ...settings } = defaultInvoiceSettings;
  return { ...settings, footer: 'Original wording' };
};

function documentWith(settings: typeof defaultInvoiceSettings): SaleWorkspaceDocument {
  return {
    id: 'historic-document', number: 'INV-2026-00001', type: 'invoice', title: 'Sales invoice', invoiceKind: 'full',
    issuedAt: '2026-10-01T12:00:00Z', issuedBy: 'Staff', version: 1, balanceAtIssue: 100000,
    snapshot: {
      draft: { id: 'SALE-2026-00001', customer: 'Alex Buyer', email: 'alex@example.invalid', phone: '', address: '12 Station Road',
        vehicleId: 'car-one', vehicle: 'Ford Fiesta', registration: 'AB20 XYZ', price: '1000', partExchange: false,
        pxRegistration: '', pxDescription: '', pxValue: '', deposit: '', paymentMethod: '', notes: 'Private staff note',
        collection: '', preparation: false, documents: true, handover: false },
      payments: [], totals: { price: 100000, allowance: 0, adjustments: 0, totalDue: 100000, deposit: 0, confirmedPaid: 0, pending: 0, balance: 100000 },
      branding: { ...saleWorkspaceBranding({ identity: { name: 'Example Motors' } }), invoiceSettings: settings },
    },
  };
}

describe('invoice layout version boundaries', () => {
  it('leaves unmarked historic snapshots unmarked through customer PDF sanitizing', () => {
    const document = documentWith(legacySettings());
    const original = JSON.stringify(document);
    const customerCopy = customerSaleDocument(document);
    expect(customerCopy.snapshot.branding.invoiceSettings).not.toHaveProperty('layoutVersion');
    expect(customerCopy.snapshot.branding.invoiceSettings?.footer).toBe('Original wording');
    expect(customerCopy.snapshot.totals).toEqual(document.snapshot.totals);
    expect(JSON.stringify(document)).toBe(original);
  });

  it('marks future settings and invoice branding without rewriting the saved settings object', () => {
    const saved = legacySettings();
    const before = JSON.stringify(saved);
    const current = currentInvoiceSettings({ ...saved, layoutVersion: undefined, showLogo: false, inkSaving: true });
    expect(current).toMatchObject({ layoutVersion: 'classic-ledger-v1', showLogo: false, inkSaving: true, footer: 'Original wording' });
    expect(currentInvoiceSettings().layoutVersion).toBe('classic-ledger-v1');
    expect(defaultInvoiceSettings.layoutVersion).toBe('classic-ledger-v1');
    const nextInvoice = invoiceBranding(saleWorkspaceBranding({ identity: { name: 'Example Motors' } }), saved);
    expect(nextInvoice.invoiceSettings?.layoutVersion).toBe('classic-ledger-v1');
    expect(JSON.stringify(saved)).toBe(before);
  });

  it('retains the explicit layout marker in new frozen snapshots but rejects unknown layout markers', () => {
    const document = documentWith({ ...defaultInvoiceSettings });
    const copy = customerSaleDocument(document);
    expect(copy.snapshot.branding.invoiceSettings?.layoutVersion).toBe('classic-ledger-v1');
    const unknown = saleWorkspaceBranding({ identity: { name: 'Example Motors' }, invoiceSettings: { ...legacySettings(), layoutVersion: 'unrecognised' } });
    expect(unknown.invoiceSettings).not.toHaveProperty('layoutVersion');
  });
});
