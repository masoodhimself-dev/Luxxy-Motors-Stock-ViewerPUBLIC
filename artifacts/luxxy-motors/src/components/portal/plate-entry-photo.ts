export type PlateEntryPhoto = { url: string; caption: string | null };

function photoRank(caption: string | null) {
  const label = (caption || "").toLowerCase().replace(/[-_]/g, " ").trim();
  if (
    /interior|seat|wheel|tyre|tire|headlight|dashboard|passenger|driver|engine|grille/.test(
      label,
    )
  )
    return 3;
  if (
    /^(?:exterior\s+)?front(?:\s+(?:view|on|centre|center|straight|exterior))?$/.test(
      label,
    ) ||
    /front\s+on|head\s+on/.test(label)
  )
    return 0;
  return /\bfront\b/.test(label) ? 1 : 2;
}
export function isFrontPhoto(photo: PlateEntryPhoto) {
  return photoRank(photo.caption) < 2;
}
function safePhotoUrl(value: unknown): value is string {
  if (typeof value !== "string" || /[\s\u0000-\u001f\u007f\\]/.test(value))
    return false;
  if (/^\/(?!\/)/.test(value)) return true;
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
export function plateEntryPhotos(
  images: unknown,
  fallback?: string | null,
): PlateEntryPhoto[] {
  const rows = Array.isArray(images) ? images : [];
  const photos: PlateEntryPhoto[] = [];
  for (const row of [...rows, ...(fallback ? [fallback] : [])]) {
    const url = typeof row === "string" ? row : row?.url;
    if (!safePhotoUrl(url) || photos.some((photo) => photo.url === url))
      continue;
    photos.push({
      url,
      caption: typeof row?.caption === "string" ? row.caption : null,
    });
  }
  return photos.sort((a, b) => photoRank(a.caption) - photoRank(b.caption));
}
