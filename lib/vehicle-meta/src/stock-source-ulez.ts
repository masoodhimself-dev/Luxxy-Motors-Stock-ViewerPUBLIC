export type SourceUlezStatus = 'compliant' | 'not_compliant' | 'unknown';
type SourceUlez = { status: SourceUlezStatus; sourceText: string } | null;
type UlezSourceCar = { sourceExtras?: unknown; advertId?: string | null; advertUrl?: string | null };

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function suppliedText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

/** Source links are evidence for this advert only, never arbitrary external URLs. */
function cazooAdvertId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['cazoo.co.uk', 'www.cazoo.co.uk'].includes(url.hostname) ||
      url.username || url.password || url.port || url.search || url.hash) return null;
    return url.pathname.match(/^\/cars-for-sale\/(\d+)\/?$/)?.[1] ?? null;
  } catch { return null; }
}

function captureTime(value: unknown, now: number): value is string {
  if (typeof value !== 'string') return false;
  // Require an explicit timezone. Round-trip the date separately because Date.parse
  // normalises invalid dates such as 30 February rather than rejecting them.
  const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/);
  if (!parts) return false;
  const [, year, month, day, hour, minute, second, zone] = parts;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() + 1 !== Number(month) || date.getUTCDate() !== Number(day) ||
    Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return false;
  if (zone !== 'Z' && (Number(zone.slice(1, 3)) > 14 || Number(zone.slice(4)) > 59 || (Number(zone.slice(1, 3)) === 14 && Number(zone.slice(4)) !== 0))) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && Number.isFinite(now) && timestamp <= now + 5 * 60_000;
}

export function ulezReport(value: unknown): SourceUlez {
  const source = record(value);
  if (!source || !suppliedText(source.sourceText, 250)) return null;
  const text = source.sourceText.trim().replace(/\s+/g, ' ').toLowerCase();
  const expected: Record<SourceUlezStatus, RegExp> = {
    compliant: /^(?:yes|compliant|ulez compliant)$/,
    not_compliant: /^(?:no|not compliant|non[ -]compliant|ulez (?:not compliant|non[ -]compliant)|not ulez compliant)$/,
    unknown: /^(?:unknown|not (?:available|provided|recorded|confirmed)|unconfirmed)$/,
  };
  if (!(typeof source.status === 'string' && Object.hasOwn(expected, source.status)) ||
    !expected[source.status as SourceUlezStatus].test(text)) return null;
  return { status: source.status as SourceUlezStatus, sourceText: source.sourceText };
}

export function validatedCazooSourceReport(car: UlezSourceCar, now = Date.now()): (Record<string, unknown> & { capturedAt: string }) | null {
  const extras = record(car.sourceExtras);
  const source = record(extras?.sourceReport);
  if (extras?.sourcePlatform !== 'cazoo' || !source || source.version !== 1 || source.platform !== 'cazoo' ||
    typeof car.advertId !== 'string' || !/^\d+$/.test(car.advertId) ||
    cazooAdvertId(source.sourceUrl) !== car.advertId ||
    (car.advertUrl != null && cazooAdvertId(car.advertUrl) !== car.advertId) ||
    !captureTime(source.capturedAt, now)) return null;
  return { ...source, capturedAt: source.capturedAt };
}
