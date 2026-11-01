/** Formatting and syntax only; postcode existence still needs a lookup. */
export function normalisePostcode(value: string): string {
  const compact = value.trim().toUpperCase().replace(/\s+/g, '');
  return compact.length > 3 ? `${compact.slice(0, -3)} ${compact.slice(-3)}` : compact;
}
export function validPostcodeSyntax(value: string): boolean {
  return /^(?:GIR 0AA|[A-PR-UWYZ][A-HK-Y]?\d[A-Z\d]? \d[ABD-HJLNP-UW-Z]{2})$/.test(normalisePostcode(value));
}
