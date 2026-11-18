/** The dealership's stock page, without tracking parameters or a fragment. */
export function autoTraderDealerLink(input: string) {
  const value = input.trim();
  if (value.length > 2048 || /[\\\s]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.port || url.username || url.password ||
        !['autotrader.co.uk', 'www.autotrader.co.uk'].includes(url.hostname)) return null;
    if (/^\/cars\/retailer\/stock\/?$/i.test(url.pathname)) {
      const ids = url.searchParams.getAll('retailerId');
      if (ids.length !== 1 || !/^\d{1,24}$/.test(ids[0])) return null;
      return { sourceUrl: `https://www.autotrader.co.uk/cars/retailer/stock?retailerId=${ids[0]}`, retailerId: ids[0] };
    }
    const match = /^\/dealers\/(?:[a-z0-9-]+\/)*[a-z0-9-]+-(\d{1,24})\/?$/i.exec(url.pathname);
    if (!match) return null;
    return { sourceUrl: `https://www.autotrader.co.uk${url.pathname.replace(/\/$/, '')}`, retailerId: match[1] };
  } catch {
    return null;
  }
}
