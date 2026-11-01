import { publicDealershipOrigin } from './public-dealership-url';

/** Apply the stock-photo presentation to the resolved tenant, not its editable name. */
export function stockPhotoControlsEnabled(doc?: Pick<Document, 'querySelector' | 'location'>): boolean {
  const source = doc ?? (typeof document === 'undefined' ? undefined : document);
  if (!source) return true;
  try {
    const host = new URL(publicDealershipOrigin(source)).hostname.toLowerCase().replace(/\.$/, '');
    return !['multichoicemotors.co.uk', 'www.multichoicemotors.co.uk'].includes(host);
  } catch {
    return true;
  }
}
