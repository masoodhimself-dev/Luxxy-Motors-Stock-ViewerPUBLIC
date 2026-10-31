import { isIP } from "node:net";

export type NetworkRequest = {
  ip?: string;
  get: (name: string) => string | undefined;
};

/** Render supplies Cloudflare's single client address. Never trust arbitrary XFF chains. */
export function requestClientAddress(
  req: NetworkRequest,
  onRender = process.env.RENDER === "true",
): string | undefined {
  if (!onRender) return req.ip;
  const address = req.get("cf-connecting-ip")?.trim();
  return address && isIP(address) ? address : undefined;
}

/** Public lookups keep their original connection bucket if edge metadata is absent. */
export function publicLookupConnection(req: NetworkRequest): string {
  return requestClientAddress(req) ?? req.ip ?? "unknown";
}
