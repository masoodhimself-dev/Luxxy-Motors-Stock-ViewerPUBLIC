import { useEffect } from 'react';
import { applyPageMeta, resetPageMeta, type PageMeta } from '@/lib/page-meta';

/**
 * Writes a page's title, description and link-preview tags into `<head>`, and
 * puts the showroom defaults back when the page unmounts — so navigating from a
 * vehicle back to the showroom never leaves the car's title behind.
 *
 * Pass `null` while the page is still loading its data.
 */
export function usePageMeta(meta: PageMeta | null) {
  const title = meta?.title;
  const description = meta?.description;
  const image = meta?.image ?? null;
  const url = meta?.url ?? null;
  const type = meta?.type ?? 'website';

  useEffect(() => {
    if (!title || !description) return;
    applyPageMeta({ title, description, image, url, type });
    return () => resetPageMeta();
  }, [title, description, image, url, type]);
}
