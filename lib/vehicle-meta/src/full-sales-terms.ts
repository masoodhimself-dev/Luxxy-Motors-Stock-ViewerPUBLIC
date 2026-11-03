import type { SaleWorkspaceBranding } from './sale-workspace.ts';

export const fullSalesTermsLimits = { title: 100, heading: 160, paragraph: 6000, sections: 40, paragraphs: 20, total: 60000 } as const;
export type SalesTermsCondition = 'all' | 'category-s';
export type SalesTermsSection = { heading: string; paragraphs: string[]; condition: SalesTermsCondition };
export type FullSalesTermsContent = { title: string; sections: SalesTermsSection[] };
export type FullSalesTermsVersion = FullSalesTermsContent & { id: string; version: number; status: 'review-draft' | 'published'; createdAt: string; createdBy: string };
export type FullSalesTermsSettings = { revision: number; draft: FullSalesTermsContent; published: FullSalesTermsVersion | null; updatedAt?: string; suppliedDraft?: boolean };
export type SalesTermsCopies = 'dealer' | 'both';
export type SalesTermsSnapshot = {
  rendererVersion: 'classic-ledger-terms-v1'; dealerId: string; saleId: string; saleRevision: number; saleReference: string;
  termsVersionId: string; termsVersion: number; title: string; sections: SalesTermsSection[]; issuedAt: string; issuedBy: string;
  customer: string; customerAddress: string; vehicle: string; registration: string; category: string;
  branding: SaleWorkspaceBranding; draft?: boolean;
};
export function normaliseFullSalesTerms(value: unknown): FullSalesTermsContent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Enter the dealership terms.');
  const raw = value as Record<string, unknown>;
  if (typeof raw.title !== 'string' || !raw.title.trim() || raw.title.trim().length > fullSalesTermsLimits.title) throw new Error('Use a terms title of 1 to 100 characters.');
  if (!Array.isArray(raw.sections) || !raw.sections.length || raw.sections.length > fullSalesTermsLimits.sections) throw new Error('Add between 1 and 40 terms sections.');
  let count = raw.title.length;
  const supported = (text: string) => { if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new Error('Remove unsupported control characters from the terms.'); };
  supported(raw.title);
  const sections = raw.sections.map((entry: unknown): SalesTermsSection => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Check each terms section.');
    const section = entry as Record<string, unknown>;
    if (typeof section.heading !== 'string' || !section.heading.trim() || section.heading.trim().length > fullSalesTermsLimits.heading) throw new Error('Each section needs a heading of 1 to 160 characters.');
    supported(section.heading);
    if (section.condition !== 'all' && section.condition !== 'category-s') throw new Error('Choose when each terms section applies.');
    if (!Array.isArray(section.paragraphs) || !section.paragraphs.length || section.paragraphs.length > fullSalesTermsLimits.paragraphs) throw new Error('Each section needs between 1 and 20 paragraphs.');
    const paragraphs = section.paragraphs.map((p: unknown) => {
      if (typeof p !== 'string' || !p.trim() || p.trim().length > fullSalesTermsLimits.paragraph) throw new Error('Each paragraph must contain 1 to 6,000 characters.');
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(p)) throw new Error('Remove unsupported control characters from the terms.');
      count += p.length; return p.trim();
    });
    count += section.heading.length;
    return { heading: section.heading.trim(), paragraphs, condition: section.condition };
  });
  if (count > fullSalesTermsLimits.total) throw new Error('Keep the full terms below 60,000 characters.');
  return { title: raw.title.trim(), sections };
}
/** Only an explicit category field can activate Category S clauses; never infer from an advert. */
export function isConfirmedCategoryS(category: unknown): boolean {
  return typeof category === 'string' && /^(?:CAT(?:EGORY)?\s*[-:]?\s*)?S$/i.test(category.trim());
}
export function applicableSalesTerms(content: FullSalesTermsContent, category: unknown): SalesTermsSection[] {
  return content.sections.filter(s => s.condition === 'all' || isConfirmedCategoryS(category)).map(s => ({ ...s, paragraphs: [...s.paragraphs] }));
}
/** Advisory review points do not silently edit the dealership's wording. */
export function salesTermsReviewPoints(content: FullSalesTermsContent, warrantyDescription = ''): string[] {
  const text = content.sections.flatMap(s => s.paragraphs).join('\n'), points: string[] = [];
  if (/seventy\s*percent|70\s*%/i.test(text)) points.push('The supplied deposit wording includes a 70% deduction. Review this before using the terms.');
  if (/as\s+is|hold\s+the\s+seller\s+harmless|indemnify/i.test(text)) points.push('Review the condition and liability wording before using the terms.');
  if (/15\s*month/i.test(text)) points.push('Confirm the stated 15-month Handler Protect warranty and its actual cover.');
  const mentioned = /\b(\d+)\s*[- ]?months?\s+warranty/i.exec(text)?.[1];
  const configured = /\b(\d+)\s*[- ]?months?/i.exec(warrantyDescription)?.[1];
  if (mentioned && configured && mentioned !== configured) points.push(`The terms mention ${mentioned} months, while the dealership warranty settings mention ${configured} months.`);
  return points;
}
