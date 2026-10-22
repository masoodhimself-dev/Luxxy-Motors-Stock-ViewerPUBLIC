/** Keep staff deep links through sign-in without allowing a different website. */
export function staffReturnUrl(
  value: string | null | undefined,
  origin = window.location.origin,
  basePath = import.meta.env.BASE_URL.replace(/\/$/, ""),
) {
  const fallback = `${basePath}/portal`;
  if (!value || /[\\\u0000-\u0020\u007f]/.test(value)) return fallback;
  try {
    const url = new URL(value, origin);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.origin !== origin ||
      url.username || url.password ||
      (url.pathname !== fallback && url.pathname !== `${basePath}/join`)
    ) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export function staffAccessReturnUrl(search = window.location.search) {
  const query = new URLSearchParams(search);
  return staffReturnUrl(
    query.get("sign_in_force_redirect_url") ||
    query.get("sign_up_force_redirect_url") ||
    query.get("redirect_url"),
  );
}
