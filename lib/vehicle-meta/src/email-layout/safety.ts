export const present = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
export const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
/** Break exceptionally long visual tokens without changing the plain-text alternative or URLs. */
export function displayText(value: string): string {
  return escapeHtml(value)
    .replace(/[^\s<&;]{25,}/g, (word) =>
      word.match(/.{1,24}/gu)!.join("&#8203;"),
    )
    .replace(/\r?\n/g, "<br>");
}
export function mailLink(value: string): string | undefined {
  // Conservative mailbox subset: no URI delimiters, encoded controls or header queries.
  return /^[A-Za-z0-9._+-]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/.test(
    value,
  )
    ? "mailto:" + value
    : undefined;
}
export function phoneLink(value: string): string | undefined {
  return /^\+?[\d ()-]{6,30}$/.test(value)
    ? "tel:" + value.replace(/[ ()-]/g, "")
    : undefined;
}
export function contrast(a: string, b: string): number {
  const luminance = (h: string) => {
    const rgb = [1, 3, 5]
      .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  };
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function palette(value: string | undefined) {
  const brand = value && /^#[\da-f]{6}$/i.test(value) ? value : "#172033";
  const buttonText =
    contrast(brand, "#FFFFFF") >= contrast(brand, "#000000")
      ? "#FFFFFF"
      : "#000000";
  const link = contrast(brand, "#FFFFFF") >= 4.5 ? brand : "#172033";
  return { brand, buttonText, link };
}
