import type { SaleWorkspaceRecord } from './sale-workspace.ts';

const blank = (value: unknown) => value == null || typeof value === 'string' && value.trim() === '';
const emptyArray = (value: unknown) => value == null || Array.isArray(value) && value.length === 0;
const emptyObject = (value: unknown) => value == null || typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0;

/** A car and asking price may be selected, but a customer or any sale activity must be retained. */
function emptyBuyerDraft(draft: unknown): boolean {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return false;
  const d = draft as Record<string, unknown>;
  if (['customer', 'email', 'phone', 'address', 'customerSource', 'sourceEnquiryId', 'sourceReservationId', 'notes', 'collection', 'deposit', 'pxRegistration', 'pxDescription', 'pxValue', 'vin'].some(key => !blank(d[key]))) return false;
  if (d.partExchange || d.preparation || d.documents || d.handover || d.roadTaxGuide || d.appointment) return false;
  if (!['payments', 'adjustments', 'exchanges'].every(key => emptyArray(d[key]))) return false;
  if (d.fulfilment) {
    const f = d.fulfilment as Record<string, unknown>;
    if (typeof f !== 'object' || Array.isArray(f) || f.method !== 'collection' || f.viewed !== 'not-yet-viewed') return false;
    if (Object.entries(f).some(([key, value]) => !['method', 'viewed'].includes(key) && !blank(value))) return false;
  }
  return true;
}

const labelledTestDraft = (draft: unknown): boolean => {
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return false;
  const d = draft as Record<string, unknown>;
  return typeof d.customer === 'string' && /^(?:\[TEST\]|TEST(?![\s-]*drive\b)(?:\s|[:–—-]))/i.test(d.customer.trim())
    && ['sourceEnquiryId', 'sourceReservationId', 'deposit'].every(key => blank(d[key]))
    && !d.appointment && !d.handover && emptyArray(d.payments);
};

/** Public records omit retry fingerprints; the server always calls this with the full stored record. */
export function canDeleteEmptySaleDraft(record: SaleWorkspaceRecord | null | undefined, requireSavedHistory = false): boolean {
  if (!record || !Number.isSafeInteger(record.revision) || record.revision < 1) return false;
  const eligibleDraft = labelledTestDraft(record.draft) ? labelledTestDraft : emptyBuyerDraft;
  if (!eligibleDraft(record.draft)) return false;
  if (!Array.isArray(record.payments) || record.payments.length || !Array.isArray(record.documents) || record.documents.length) return false;
  if (record.completedAt || record.lifecycle || record.customerAccess || record.customerLinkEmail || record.reviewReminder || record.checklists) return false;
  if (!emptyArray(record.packDocumentIds) || !emptyArray(record.emailDeliveries) || !emptyObject(record.documentArchives) || !emptyObject(record.providerPayments)) return false;
  if (!Array.isArray(record.events) || !record.events.length || record.events.some(event => !['sale-created', 'sale-updated'].includes(event.type))) return false;
  if (requireSavedHistory && (!record.requests || Object.keys(record.requests).length !== record.revision)) return false;
  if (record.requests) {
    for (const request of Object.values(record.requests)) {
      if (request.documentId || typeof request.fingerprint !== 'string') return false;
      try {
        const command = JSON.parse(request.fingerprint);
        if (!['create', 'update'].includes(command?.action) || !eligibleDraft(command.draft)) return false;
      } catch { return false; }
    }
  }
  return true;
}
