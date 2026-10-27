import { expect, it } from "vitest";
import {
  currentInvoiceBranding,
  invoiceBranding,
  defaultInvoiceSettings,
  saleWorkspaceBranding,
  saleWorkspaceNumber,
  createSaleWorkspace,
  changeSaleWorkspace,
} from "@workspace/vehicle-meta";
import { emptyDraft } from "@/components/sales-demo/model";
it("uses the current published logo and primary colour for new invoices with one layout", () => {
  const brand = saleWorkspaceBranding({
    identity: {
      name: "Multi-Choice Motors",
      logoAsset: "/api/website-assets/current-logo",
      brandColors: { primaryHsl: "210 50% 40%", accentHsl: "20 50% 50%" },
    },
    presentation: { linkColour: "#ff0000" },
  });
  const settings = {
    ...defaultInvoiceSettings,
    style: "understated" as const,
    useWebsiteColour: false,
    accent: "#ff00ff",
    showLogo: false,
    logoSize: "small" as const,
    inkSaving: true,
    referencePrefix: "MCM",
    startingSequence: 900,
    paymentInstructions: "Use the invoice reference",
  };
  const before = JSON.stringify({ brand, settings });
  const result = currentInvoiceBranding(brand, settings);
  expect(result.identity.logoAsset).toBe("/api/website-assets/current-logo");
  expect(result.presentation?.linkColour).toBe("#336699");
  expect(result.invoiceSettings).toMatchObject({
    style: "branded",
    useWebsiteColour: true,
    accent: "#336699",
    showLogo: true,
    logoSize: "medium",
    inkSaving: false,
    referencePrefix: "MCM",
    startingSequence: 900,
    paymentInstructions: "Use the invoice reference",
  });
  expect(JSON.stringify({ brand, settings })).toBe(before);
});
it("new branding does not alter issued snapshots, payments or monotonic numbering", () => {
  const originalBrand = invoiceBranding(
    saleWorkspaceBranding({
      identity: { name: "Original dealer", logoAsset: "/old-logo" },
    }),
    { ...defaultInvoiceSettings, useWebsiteColour: false, accent: "#552244" },
  );
  let id = 0;
  const numbers: Record<string, number> = {};
  const oldContext = {
    now: "2026-10-01T10:00:00Z",
    actor: "Staff",
    nextId: () => `id-${++id}`,
    nextNumber: (type: string) =>
      saleWorkspaceNumber(numbers, type, "2026-10-01T10:00:00Z"),
    branding: originalBrand,
    saleTerms: "Approved sale terms",
  };
  const created = createSaleWorkspace(
    {
      draft: {
        ...emptyDraft(),
        customer: "Sam",
        vehicle: "Ford Focus",
        registration: "AB12CDE",
        price: "4990",
      },
      requestId: "create-sale-request",
    },
    oldContext,
    "SALE-1",
  );
  const issued = changeSaleWorkspace(
    created.sale,
    { action: "document", type: "invoice" },
    { expectedRevision: created.sale.revision, requestId: "old-invoice" },
    oldContext,
  );
  const original = JSON.stringify(issued.document),
    payments = JSON.stringify(issued.sale.payments);
  const next = changeSaleWorkspace(
    issued.sale,
    { action: "document", type: "invoice" },
    { expectedRevision: issued.sale.revision, requestId: "new-invoice" },
    {
      ...oldContext,
      branding: currentInvoiceBranding(
        saleWorkspaceBranding({
          identity: {
            name: "New dealer",
            logoAsset: "/new-logo",
            brandColors: { primaryHsl: "210 50% 40%", accentHsl: "20 50% 50%" },
          },
        }),
        defaultInvoiceSettings,
      ),
    },
  );
  expect(next.document?.snapshot.branding.identity.logoAsset).toBe("/new-logo");
  expect(JSON.stringify(issued.document)).toBe(original);
  expect(JSON.stringify(next.sale.payments)).toBe(payments);
  expect(issued.document?.number).toBe("INV-2026-00001");
  expect(next.document?.number).toBe("INV-2026-00002");
});

it("normal sale edits preserve retired driver and tax-guide evidence without allowing new values", () => {
  let id = 0;
  const context = {
    now: "2026-10-01T10:00:00Z",
    actor: "Staff",
    nextId: () => `id-${++id}`,
    nextNumber: () => `INV-${id}`,
    branding: saleWorkspaceBranding({ identity: { name: "Dealer" } }),
  };
  const created = createSaleWorkspace(
    {
      draft: {
        ...emptyDraft(),
        customer: "Sam",
        vehicle: "Ford Focus",
        price: "4990",
        roadTaxGuide: true,
        fulfilment: {
          method: "delivery",
          viewed: "viewed",
          address: "Confirmed address",
          recipient: "Sam",
          phone: "07700900123",
          scheduledDate: "2026-10-02",
          timeWindow: "Afternoon",
          instructions: "Call on arrival",
          driver: "Untrusted new value",
        },
      },
      requestId: "create-legacy-check",
    },
    context,
    "SALE-LEGACY",
  ).sale;
  expect(created.draft.roadTaxGuide).toBeUndefined();
  expect(created.draft.fulfilment?.driver).toBeUndefined();
  created.draft.roadTaxGuide = true;
  created.draft.fulfilment!.driver = "Recorded original driver";
  const payment = {
    action: "payment" as const,
    payment: {
      amount: "100",
      kind: "deposit" as const,
      status: "confirmed" as const,
      method: "Bank transfer",
      date: "2026-10-01",
      reference: "Original",
    },
  };
  const paid = changeSaleWorkspace(
    created,
    payment,
    { expectedRevision: created.revision, requestId: "legacy-payment" },
    context,
  ).sale;
  const oldPayments = JSON.stringify(paid.payments),
    oldDocs = JSON.stringify(paid.documents);
  const edited = changeSaleWorkspace(
    paid,
    {
      action: "update",
      draft: {
        ...paid.draft,
        notes: "Internal note changed",
        roadTaxGuide: false,
        fulfilment: { ...paid.draft.fulfilment!, driver: "Replacement denied" },
      },
    },
    { expectedRevision: paid.revision, requestId: "legacy-note-update" },
    context,
  ).sale;
  expect(edited.draft.roadTaxGuide).toBe(true);
  expect(edited.draft.fulfilment?.driver).toBe("Recorded original driver");
  expect(JSON.stringify(edited.payments)).toBe(oldPayments);
  expect(JSON.stringify(edited.documents)).toBe(oldDocs);
  expect(paid.draft.notes).not.toBe(edited.draft.notes);
});
