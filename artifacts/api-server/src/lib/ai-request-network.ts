import { isIP } from "node:net";
type NetworkRequest = {
  ip?: string;
  get: (name: string) => string | undefined;
};
/** Render's public ingress passes through Cloudflare. Never trust arbitrary XFF chains. */
export function aiConnectionIdentity(
  req: NetworkRequest,
  sessionHash: string,
  onRender = process.env.RENDER === "true",
) {
  if (onRender) {
    const address = req.get("cf-connecting-ip")?.trim();
    if (address && isIP(address)) return address;
    // If edge metadata is missing, keep visitors separate instead of grouping the proxy.
    // The persisted session and global spend guards still apply.
    return `browser:${sessionHash}`;
  }
  return req.ip ?? `browser:${sessionHash}`;
}
export function aiCookieSecure(
  requestSecure: boolean,
  production = process.env.NODE_ENV === "production",
) {
  return requestSecure || production;
}
