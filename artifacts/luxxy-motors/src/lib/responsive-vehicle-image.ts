/** Only resize the documented width segment on the recognised stock-photo CDN.
 * Other dealers' image hosts and signed URLs are left unchanged. */
export function responsiveVehicleImage(url: string, sizes: string) {
  try {
    const image = new URL(url);
    if (
      image.protocol !== "https:" ||
      image.hostname !== "m.atcdn.co.uk" ||
      image.search ||
      !/^\/a\/media\/w\d+\//.test(image.pathname)
    )
      return {};
    const sourceWidth = Number(image.pathname.match(/\/w(\d+)\//)?.[1]);
    const widths = [...new Set([340, 600, sourceWidth])]
      .filter((width) => width <= sourceWidth)
      .sort((a, b) => a - b);
    return {
      srcSet: widths
        .map((width) => `${url.replace(/\/w\d+\//, `/w${width}/`)} ${width}w`)
        .join(", "),
      sizes,
    };
  } catch {
    return {};
  }
}
/** Retry the exact supplied stock image before marking a responsive image unavailable. */
export function retryOriginalImage(image: HTMLImageElement) {
  if (!image.hasAttribute("srcset")) return false;
  image.removeAttribute("srcset");
  image.removeAttribute("sizes");
  return true;
}
