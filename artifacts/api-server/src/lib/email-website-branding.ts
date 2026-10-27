import {
  defaultEmailAppearance,
  validateEmailAppearance,
  type EmailAppearance,
} from "@workspace/vehicle-meta";

export type EmailWebsiteBranding = { logoUrl: string; brandColour: string };
export type EmailWebsiteSettings = {
  identity?: {
    logoAsset?: string;
    brandColors?: { primaryHsl?: string; accentHsl?: string };
  };
};

/** Reuse published branding without copying website-only/data URLs into emails. */
export function emailWebsiteBranding(
  settings: EmailWebsiteSettings,
  origin: string,
): EmailWebsiteBranding {
  const hsl =
    settings.identity?.brandColors?.primaryHsl ??
    settings.identity?.brandColors?.accentHsl ??
    "";
  const values = hsl
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/);
  let brandColour = "#172033";
  if (
    values &&
    Number(values[1]) <= 360 &&
    Number(values[2]) <= 100 &&
    Number(values[3]) <= 100
  ) {
    const h = Number(values[1]),
      s = Number(values[2]) / 100,
      l = Number(values[3]) / 100,
      a = s * Math.min(l, 1 - l);
    const channel = (n: number) =>
      Math.round(
        255 *
          (l -
            a *
              Math.max(
                -1,
                Math.min(((n + h / 30) % 12) - 3, 9 - ((n + h / 30) % 12), 1),
              )),
      )
        .toString(16)
        .padStart(2, "0");
    brandColour = `#${channel(0)}${channel(8)}${channel(4)}`.toUpperCase();
  }
  let logoUrl = "";
  try {
    const asset = settings.identity?.logoAsset?.trim();
    if (asset) {
      const url = new URL(asset, origin);
      if (!url.username && !url.password)
        logoUrl = validateEmailAppearance({
          logoUrl: url.href,
          brandColour,
          heading: "",
          footer: "",
        }).logoUrl;
    }
  } catch {
    /* The dealership name still renders when no email-compatible logo is available. */
  }
  return { logoUrl, brandColour };
}

/** New emails always use the one published dealer brand and a fixed email layout.
 * Legacy private overrides stay encrypted in storage; they are never applied to new messages. */
export function publishedEmailAppearance(
  website?: EmailWebsiteBranding,
): EmailAppearance {
  return { ...defaultEmailAppearance, ...website };
}
