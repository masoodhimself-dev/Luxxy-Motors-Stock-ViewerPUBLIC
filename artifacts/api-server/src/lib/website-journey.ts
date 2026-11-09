import { createHash, randomBytes } from 'node:crypto';

export const websiteJourneyStages = ['search', 'vehicle', 'enquiry', 'appointment_request'] as const;
export type WebsiteJourneyStage = typeof websiteJourneyStages[number];
export type WebsiteJourneyDatabase = { query(sql: string, values?: any[]): Promise<{ rows: any[] }> };
export class WebsiteJourneyError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
export const isWebsiteJourneyStage = (value: unknown): value is WebsiteJourneyStage =>
  typeof value === 'string' && websiteJourneyStages.includes(value as WebsiteJourneyStage);

/** Reject extra fields rather than accidentally accepting URLs or customer text. */
export function parseWebsiteJourney(value: unknown): WebsiteJourneyStage {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 ||
    !Object.hasOwn(value, 'stage') || !isWebsiteJourneyStage((value as { stage?: unknown }).stage))
    throw new WebsiteJourneyError('Choose one valid website event.');
  return (value as { stage: WebsiteJourneyStage }).stage;
}

/** Bounded, short-lived network buckets; only a process-salted hash lives in memory. */
export function createWebsiteJourneyLimiter(options: { now?: () => number; maximum?: number; lifetimeMs?: number; maxBuckets?: number } = {}) {
  const entries = new Map<string, { count: number; expires: number }>();
  const salt = randomBytes(24), now = options.now ?? Date.now;
  const maximum = options.maximum ?? 40, lifetime = options.lifetimeMs ?? 10 * 60_000, capacity = options.maxBuckets ?? 10_000;
  let nextSweep = 0;
  return (dealer: string, connection: string) => {
    const instant = now();
    if (instant >= nextSweep) {
      for (const [key, entry] of entries) if (entry.expires <= instant) entries.delete(key);
      nextSweep = instant + Math.min(60_000, lifetime);
    }
    const key = createHash('sha256').update(salt).update(dealer).update('\0').update(connection).digest('hex');
    if ((entries.get(key)?.expires ?? Infinity) <= instant) entries.delete(key);
    const existing = entries.get(key);
    if (!existing && entries.size >= capacity) return false;
    const entry = existing ?? { count: 0, expires: instant + lifetime };
    entry.count++; entries.set(key, entry);
    return entry.count <= maximum;
  };
}

/** The browser's successful stages increment one daily tenant counter atomically. */
export async function recordWebsiteJourney(database: WebsiteJourneyDatabase, dealer: string, stage: WebsiteJourneyStage, instant = new Date()) {
  if (!isWebsiteJourneyStage(stage)) throw new WebsiteJourneyError('Choose one valid website event.');
  await database.query(`INSERT INTO website_journey_daily(dealer_id,day,stage,event_count)
    VALUES($1,($2::timestamptz AT TIME ZONE 'Europe/London')::date,$3,1)
    ON CONFLICT(dealer_id,day,stage) DO UPDATE SET event_count=website_journey_daily.event_count+1`, [dealer, instant, stage]);
}

export function websiteJourneyRange(from: unknown, to: unknown) {
  const valid = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!valid(from) || !valid(to) || from > to || Date.parse(to) - Date.parse(from) > 365 * 86_400_000)
    throw new WebsiteJourneyError('Choose a valid reporting period of up to one year.');
  return { from, to };
}
const emptyCounts = () => ({ search: 0, vehicle: 0, enquiry: 0, appointmentRequest: 0 });
const reportKey = { search: 'search', vehicle: 'vehicle', enquiry: 'enquiry', appointment_request: 'appointmentRequest' } as const;

export async function websiteJourneyReport(database: WebsiteJourneyDatabase, dealer: string, from: string, to: string) {
  const range = websiteJourneyRange(from, to);
  const result = await database.query('SELECT day::text AS date,stage,event_count::text AS count FROM website_journey_daily WHERE dealer_id=$1 AND day>=$2::date AND day<=$3::date ORDER BY day,stage', [dealer, range.from, range.to]);
  const days = [];
  for (let at = Date.parse(from); at <= Date.parse(to); at += 86_400_000) days.push({ date: new Date(at).toISOString().slice(0, 10), ...emptyCounts() });
  const byDate = new Map(days.map(day => [day.date, day])), totals = emptyCounts();
  for (const row of result.rows) {
    const stage: unknown = row.stage;
    if (!isWebsiteJourneyStage(stage)) continue;
    const day = byDate.get(String(row.date)), count = Number(row.count), key = reportKey[stage];
    if (!day || !Number.isSafeInteger(count) || count < 0) throw new WebsiteJourneyError('Website event counts are unavailable.', 503);
    day[key] += count; totals[key] += count;
    if (!Number.isSafeInteger(totals[key])) throw new WebsiteJourneyError('Website event counts are unavailable.', 503);
  }
  return { ...range, days, totals };
}
