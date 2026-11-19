import type { CustomerWebsiteTemplate } from './website-template';

export type StockView = 'cards' | 'compact';
export type StockCardLayout = 'card' | 'row' | 'compact';
export type StockFilterPresentation = 'sidebar' | 'toolbar';
export const LEGACY_STOCK_VIEW_KEY = 'luxxy.stock-view.v1';

const templates = {
  showroom: { cardLayout: 'card', filters: 'sidebar', imageSizes: '(max-width: 767px) 100vw, (max-width: 1100px) 50vw, 620px' },
  'grand-touring': { cardLayout: 'row', filters: 'toolbar', imageSizes: '(max-width: 767px) 100vw, (max-width: 1100px) 60vw, 800px' },
  forecourt: { cardLayout: 'compact', filters: 'sidebar', imageSizes: '(max-width: 700px) 39vw, (max-width: 1023px) 40vw, 360px' },
  panorama: { cardLayout: 'card', filters: 'toolbar', imageSizes: '(max-width: 767px) 100vw, (max-width: 1100px) 50vw, 720px' },
} as const;

/** Only presentation changes. Filtering, ordering and vehicle records stay shared. */
export function stockTemplatePresentation(template: CustomerWebsiteTemplate | null, view: StockView | null) {
  return {
    cardLayout: view === 'compact' ? 'compact' : view === 'cards' ? 'card' : template ? templates[template].cardLayout : 'card',
    filters: template ? templates[template].filters : 'sidebar',
    imageSizes: template ? view === 'compact' ? templates.forecourt.imageSizes : view === 'cards' ? templates.showroom.imageSizes : templates[template].imageSizes : undefined,
  } satisfies { cardLayout: StockCardLayout; filters: StockFilterPresentation; imageSizes?: string };
}

/** Private demo dealers can share an origin, so their stable dealer ID also
 * scopes the preference. Preview revisions do not reset a visitor's choice. */
export function stockViewStorageKey(template: CustomerWebsiteTemplate | null, origin: string, previewDealerId = '') {
  if (!template) return LEGACY_STOCK_VIEW_KEY;
  let canonical = origin;
  try { canonical = new URL(origin).origin; } catch { /* Preserve a stable caller scope. */ }
  return `dealeros.stock-view.v1:${encodeURIComponent(canonical)}:${encodeURIComponent(previewDealerId)}:${template}`;
}

export function readStockView(key: string): StockView | null {
  try { const value = window.localStorage.getItem(key); return value === 'cards' || value === 'compact' ? value : null; }
  catch { return null; }
}

export function writeStockView(key: string, view: StockView) {
  try { window.localStorage.setItem(key, view); } catch { /* In-memory choices remain usable. */ }
}

export function clearStockView(key: string) {
  try { window.localStorage.removeItem(key); } catch { /* Default still applies in memory. */ }
}
