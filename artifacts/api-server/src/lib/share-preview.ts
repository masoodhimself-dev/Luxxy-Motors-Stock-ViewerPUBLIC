import {
  buildShowroomMeta,
  buildVehicleMeta,
  toAbsoluteUrl,
  type DealerIdentity,
  type VehicleMetaSource,
} from "@workspace/vehicle-meta";

/**
 * The showroom is a client-rendered SPA, so the link crawlers behind WhatsApp,
 * Facebook, Slack and iMessage never run the JavaScript that sets a vehicle's
 * tags in the browser. This module renders a tiny server-side HTML document
 * carrying those tags, which is what a forwarded share link points at; humans
 * who open it are sent straight on to the real vehicle page.
 */
export interface SharePreview {
  title: string;
  description: string;
  imageUrl: string | null;
  /** Absolute URL of the vehicle page in the SPA — canonical and redirect target. */
  targetUrl: string;
  siteName: string;
  status: 200 | 404;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeScriptString(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function buildVehicleSharePreview(options: {
  vehicle: VehicleMetaSource;
  vehicleId: string;
  dealer: DealerIdentity;
  origin: string;
}): SharePreview {
  const { vehicle, vehicleId, dealer, origin } = options;
  const meta = buildVehicleMeta(vehicle, dealer);

  return {
    title: meta.title,
    description: meta.description,
    imageUrl: toAbsoluteUrl(meta.image, origin),
    targetUrl: `${origin}/vehicle/${encodeURIComponent(vehicleId)}`,
    siteName: dealer.name?.trim() || "Used car showroom",
    status: 200,
  };
}

/** Shown when the id is unknown or the vehicle has since sold. */
export function buildMissingVehicleSharePreview(options: {
  vehicleId: string;
  dealer: DealerIdentity;
  origin: string;
}): SharePreview {
  const { vehicleId, dealer, origin } = options;
  const showroom = buildShowroomMeta(dealer);
  const dealerName = dealer.name?.trim() || "Used car showroom";

  return {
    title: `This vehicle is no longer available | ${dealerName}`,
    description: showroom.description,
    imageUrl: null,
    targetUrl: `${origin}/vehicle/${encodeURIComponent(vehicleId)}`,
    siteName: dealerName,
    status: 404,
  };
}

export function renderSharePreviewHtml(preview: SharePreview): string {
  const { title, description, imageUrl, targetUrl, siteName } = preview;
  const imageTags = imageUrl
    ? [
        `<meta property="og:image" content="${escapeHtml(imageUrl)}" />`,
        `<meta property="og:image:alt" content="${escapeHtml(title)}" />`,
        `<meta name="twitter:image" content="${escapeHtml(imageUrl)}" />`,
      ]
    : [];

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <!-- Crawlers should index the vehicle page itself, not this preview shim. -->
    <meta name="robots" content="noindex, follow" />
    <link rel="canonical" href="${escapeHtml(targetUrl)}" />
    <meta property="og:site_name" content="${escapeHtml(siteName)}" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(targetUrl)}" />
    <meta name="twitter:card" content="${imageUrl ? "summary_large_image" : "summary"}" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    ${imageTags.join("\n    ")}
    <meta http-equiv="refresh" content="0; url=${escapeHtml(targetUrl)}" />
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #09101f; color: #f8fafc;
             font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
      main { padding: 2rem; text-align: center; }
      p { margin: 0 0 1rem; font-size: 0.95rem; letter-spacing: 0.01em; }
      a { color: #f5b642; font-weight: 700; }
    </style>
  </head>
  <body>
    <main>
      <p>Opening ${escapeHtml(title)}…</p>
      <a href="${escapeHtml(targetUrl)}">Continue to the vehicle</a>
    </main>
    <script>window.location.replace(${escapeScriptString(targetUrl)});</script>
  </body>
</html>
`;
}
