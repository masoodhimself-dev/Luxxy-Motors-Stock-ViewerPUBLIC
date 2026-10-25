import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router } from 'wouter';
import { getGetDealerSettingsQueryKey, getGetStockQueryKey, type DealerSettings } from '@workspace/api-client-react';
import { CustomerPreviewContext } from '@/lib/customer-preview-context';
import { SavedCarsProvider } from '@/lib/saved-cars-context';
import { StockProvider, type StockData } from '@/lib/stock-context';
import type { DealerFeatures } from '@/lib/dealer-features';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Layout } from '@/components/layout';
import Home from '@/pages/home';
import Contact from '@/pages/contact';
import Warranty from '@/pages/warranty';
import CarDetail from '@/pages/car-detail';

export type PreviewPage = 'home' | 'stock' | 'vehicle' | 'contact' | 'warranty';
export type CustomerPagePreviewInput = {
  settings: DealerSettings;
  stock: StockData;
  features: DealerFeatures;
  page: PreviewPage;
  viewportWidth: number;
  vehicleId?: string;
};

/** Only public settings and stock enter this independent cache; no portal queries are copied. */
export function renderCustomerPagePreview(input: CustomerPagePreviewInput): string {
  const cache = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false, staleTime: Infinity, gcTime: Infinity } } });
  cache.setQueryData(getGetDealerSettingsQueryKey(), input.settings);
  cache.setQueryData(getGetStockQueryKey(), input.stock);
  cache.setQueryData(['dealer-features'], input.features);
  const path = input.page === 'home' ? '/' : input.page === 'vehicle' ? `/vehicle/${encodeURIComponent(input.vehicleId ?? '')}` : `/${input.page}`;
  const page = input.page === 'home' ? <Home /> : input.page === 'stock' ? <Home browseStock /> : input.page === 'contact' ? <Contact /> : input.page === 'warranty' ? <Warranty /> : <CarDetail />;
  try {
    // This is static React rendering, never a mounted customer app: effects, event handlers,
    // analytics, timers and query subscriptions cannot run in the snapshot.
    return renderToStaticMarkup(
      <CustomerPreviewContext.Provider value={{ viewportWidth: input.viewportWidth }}>
        <QueryClientProvider client={cache}>
          <Router hook={() => [path, () => {}]} searchHook={() => ''} ssrPath={path} ssrSearch="">
            <StockProvider><SavedCarsProvider><TooltipProvider><Layout>{page}</Layout></TooltipProvider></SavedCarsProvider></StockProvider>
          </Router>
        </QueryClientProvider>
      </CustomerPreviewContext.Provider>,
    );
  } finally {
    cache.clear();
  }
}

/** Copy loaded application CSS, not the portal DOM or any cached data. */
export function loadedPreviewStyles(document: Document): string {
  return Array.from(document.styleSheets).flatMap(sheet => {
    try { return Array.from(sheet.cssRules, rule => rule.cssText); }
    catch { return []; } // Cross-origin styles are not readable; local application CSS remains available.
  }).join('\n');
}

/** Defense in depth: snapshots have no scripts, links, submissions or embedded documents. */
export function customerPreviewDocument(markup: string, styles: string): string {
  const parsed = new DOMParser().parseFromString(markup, 'text/html');
  parsed.querySelectorAll('script,iframe,object,embed,link,meta,base,video,audio,source').forEach(node => node.remove());
  for (const element of Array.from(parsed.body.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      if (/^on/i.test(attribute.name) || ['href', 'target', 'download', 'action', 'formaction', 'srcdoc', 'autofocus', 'contenteditable', 'ping'].includes(attribute.name)) element.removeAttribute(attribute.name);
    }
    if (!element.matches('summary') && element.matches('a,button,input,select,textarea,[tabindex]')) {
      element.setAttribute('tabindex', '-1');
      if (element.matches('button,input,select,textarea')) element.setAttribute('disabled', '');
      element.setAttribute('aria-disabled', 'true');
    }
  }
  // Close-tag escaping prevents CSS or public copy from escaping the containing style element.
  const css = styles.replace(/<\/style/gi, '<\\/style');
  const csp = "default-src 'none'; script-src 'none'; connect-src 'none'; form-action 'none'; style-src 'unsafe-inline'; img-src https: http: data: blob:; font-src https: http: data:; frame-src 'none'; base-uri 'none'";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>Unpublished customer website preview</title><style>${css}\nhtml,body{margin:0;min-width:0}a,button,input,select,textarea{pointer-events:none!important}button:disabled,input:disabled,select:disabled,textarea:disabled{opacity:1!important}*{scroll-behavior:auto!important;animation-duration:0s!important;animation-delay:0s!important}</style></head><body>${parsed.body.innerHTML}</body></html>`;
}
